import { createRequire } from "node:module";
import { openDatabase } from "../db.mjs";
import { createIdentityRepository } from "./repositories/identity.mjs";
import { createJobsRepository } from "./repositories/jobs.mjs";

const nodeRequire = createRequire(import.meta.url);
const DEFAULT_POOL_MAX = 3;
const processPostgresPools = new Map();

export function resolveDialect(env = process.env) {
  const explicit = String(env["DB_DIALECT"] || "").trim().toLowerCase();
  const hasDatabaseUrl = Boolean(env["DATABASE_URL"]);
  const production = String(env["NODE_ENV"] || "").toLowerCase() === "production";

  if (explicit && explicit !== "sqlite" && explicit !== "postgres") {
    throw new Error("DB_DIALECT must be either sqlite or postgres.");
  }

  if (explicit === "postgres") {
    if (!hasDatabaseUrl) throw new Error("DATABASE_URL is required when DB_DIALECT=postgres.");
    return "postgres";
  }

  if (explicit === "sqlite") {
    if (production && hasDatabaseUrl) {
      throw new Error("Production cannot select DB_DIALECT=sqlite while DATABASE_URL is configured.");
    }
    return "sqlite";
  }

  if (hasDatabaseUrl) return "postgres";
  if (production) {
    throw new Error("Production storage requires DATABASE_URL (Postgres) or an explicit local-only DB_DIALECT=sqlite override.");
  }
  return "sqlite";
}

export function postgresPoolConfig(env = process.env) {
  const connectionString = env["DATABASE_URL"];
  if (!connectionString) throw new Error("DATABASE_URL is required for the Postgres pool.");
  return {
    connectionString,
    max: boundedPositiveInteger(env["PGPOOL_MAX"], DEFAULT_POOL_MAX, 10),
    min: 0,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    maxLifetimeSeconds: 300,
    query_timeout: 15_000,
    application_name: "prooflet-api",
  };
}

export async function createStore({ env = process.env, sqlite = {}, schema, pool, sharePool } = {}) {
  const dialect = resolveDialect(env);
  if (dialect === "postgres") {
    const { createPostgresStore } = await import("./postgres.mjs");
    return createPostgresStore({ env, schema, pool, sharePool });
  }
  return createSqliteStore({ env, ...sqlite });
}

export function createSqliteStore({ env = process.env, path, reset = false } = {}) {
  const db = openDatabase({ env, path, reset });
  return createSqliteStoreFromDatabase(db, { ownsConnection: true });
}

export function createSqliteStoreFromDatabase(db, { ownsConnection = false } = {}) {
  let queue = Promise.resolve();
  let closed = false;
  let closing = false;
  const store = {
    dialect: "sqlite",
    native: db,
    async health() {
      if (closed || closing) return { connected: false, migrationVersion: null, foreignKeys: false };
      const migrationVersion = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version;
      const foreignKeys = db.prepare("PRAGMA foreign_keys").get().foreign_keys === 1;
      return { connected: true, migrationVersion, foreignKeys };
    },
    transaction(operation) {
      if (closed || closing) return Promise.reject(new Error("Store is closed."));
      const execute = async () => {
        // Work accepted before close began must still drain; only reject after full close.
        if (closed) throw new Error("Store is closed.");
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = await operation(store);
          db.exec("COMMIT");
          return result;
        } catch (error) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // Preserve the original operation error.
          }
          throw error;
        }
      };
      const result = queue.then(execute, execute);
      queue = result.catch(() => {});
      return result;
    },
    async close() {
      if (closed || closing) return;
      closing = true;
      try {
        await queue;
        if (!closed && ownsConnection) db.close();
      } finally {
        closed = true;
        closing = false;
      }
    },
  };
  return attachRepositories(store);
}

export async function withPostgresTransaction(pool, operation) {
  const client = await pool.connect();
  let began = false;
  let releaseError = null;
  try {
    await client.query("BEGIN");
    began = true;
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        releaseError = rollbackError;
      }
    } else {
      releaseError = error;
    }
    throw error;
  } finally {
    client.release(releaseError || undefined);
  }
}

export function getSharedPostgresPool(env = process.env, { schema = "public", poolKey = "default" } = {}) {
  const key = `${poolKey}::${schema}`;
  if (processPostgresPools.has(key)) return processPostgresPools.get(key);
  const { Pool } = nodeRequire("pg");
  const config = postgresPoolConfig(env);
  if (schema !== "public") config.options = `-c search_path=${schema},public`;
  const pool = new Pool(config);
  pool.on("error", (error) => {
    console.error("[prooflet:postgres] idle pool client error", { code: error?.code || "UNKNOWN" });
  });
  processPostgresPools.set(key, pool);
  return pool;
}

export async function closeSharedPostgresPools() {
  const pools = [...processPostgresPools.values()];
  processPostgresPools.clear();
  await Promise.all(pools.map((pool) => pool.end().catch(() => {})));
}

export function sanitizeStorageError(error) {
  const message = String(error?.message || "Storage operation failed.");
  const containsSecret = /postgresql:\/\/|postgres:\/\/|DATABASE_URL/i.test(message);
  const safe = new Error(containsSecret ? "Storage operation failed." : message);
  safe.code = error?.code || "STORAGE_ERROR";
  safe.name = "StorageError";
  return safe;
}

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function attachRepositories(store) {
  store.identity = createIdentityRepository(store);
  store.jobs = createJobsRepository(store);
  return store;
}