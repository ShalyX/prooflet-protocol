import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  attachRepositories,
  getSharedPostgresPool,
  postgresPoolConfig,
  sanitizeStorageError,
  withPostgresTransaction,
} from "./index.mjs";

export const POSTGRES_MIGRATION_VERSION = 13;
const MIGRATION_NAME = "postgres_v13_compatibility_baseline";
const BASELINE_SQL_URL = new URL("./postgres/migrations/013_v13_compatibility_baseline.sql", import.meta.url);
const SAFE_SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
const REVOKED_API_KEY_HASHES = [
  "ac5aa45be82d1f55f17cdb2cade05fc317495b7e5b3d9fb679a9a9035ceba16d",
  "eea7abc62e1cfd4b0da6dd0a41ca99a0588936ad910a63ab85802d80bedf1b4b",
  "5eed4695680fa06342e5545cc42c39739d4ae9ee110245dd1319d4ffbe193521",
  "703a41c46698349beb125a2450651411125511aa1ed6ae725d0d136c1346d241",
  "cf88528fbf5a409e76facc2ad8f45b86b8b20cf6a290e354edbfc5c58d1be76e",
];
const REVOKED_ADJUDICATOR_KEY_HASHES = [
  "249f1c791fbf7933f06e8ac353fbc91ce3b21c8a266f17fa7b050df607cc095c",
  "874171490aeb3bb4e80a89444c875fa94e63f1d36626157af01e4c24efcfe105",
];

export async function createPostgresStore({
  env = process.env,
  schema = "public",
  pool: suppliedPool,
  sharePool = true,
} = {}) {
  assertSafeSchema(schema);
  let ownsPool = false;
  let pool = suppliedPool;
  let shared = false;

  try {
    if (!pool) {
      if (sharePool) {
        pool = getSharedPostgresPool(env, { schema });
        shared = true;
      } else {
        const config = postgresPoolConfig(env);
        if (schema !== "public") config.options = `-c search_path=${schema},public`;
        pool = new Pool(config);
        pool.on("error", (error) => {
          console.error("[prooflet:postgres] idle pool client error", { code: error?.code || "UNKNOWN" });
        });
        ownsPool = true;
      }
    } else if (schema !== "public") {
      throw new Error("Custom Postgres schemas require an owned or shared pool configured with the matching search_path.");
    }

    await runPostgresMigrations(pool, { schema });
  } catch (error) {
    if (ownsPool) await pool.end().catch(() => {});
    throw sanitizeStorageError(error);
  }

  let closed = false;
  const store = {
    dialect: "postgres",
    async query(text, values = []) {
      if (closed) throw new Error("Store is closed.");
      try {
        return await pool.query(text, values);
      } catch (error) {
        throw sanitizeStorageError(error);
      }
    },
    async health() {
      if (closed) return { connected: false, migrationVersion: null, foreignKeys: true };
      try {
        const result = await pool.query("SELECT COALESCE(MAX(version), 0)::int AS version FROM schema_migrations");
        return { connected: true, migrationVersion: result.rows[0].version, foreignKeys: true };
      } catch {
        return { connected: false, migrationVersion: null, foreignKeys: true };
      }
    },
    transaction(operation) {
      if (closed) return Promise.reject(new Error("Store is closed."));
      return withPostgresTransaction(pool, async (client) => {
        const transactionStore = attachRepositories({
          dialect: "postgres",
          query: async (text, values = []) => {
            try {
              return await client.query(text, values);
            } catch (error) {
              throw sanitizeStorageError(error);
            }
          },
        });
        return operation(transactionStore);
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      if (ownsPool) await pool.end();
      // Shared process pools remain open for other stores until process shutdown.
      void shared;
    },
  };
  return attachRepositories(store);
}

export async function runPostgresMigrations(pool, { schema = "public" } = {}) {
  assertSafeSchema(schema);
  const client = await pool.connect();
  const quotedSchema = quoteIdentifier(schema);
  let began = false;
  let releaseError = null;
  try {
    await client.query("BEGIN");
    began = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`prooflet:migrations:${schema}`]);
    if (schema !== "public") await client.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
    await client.query(`SET LOCAL search_path TO ${quotedSchema}, public`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    const applied = await client.query(
      "SELECT version, name FROM schema_migrations WHERE version=$1",
      [POSTGRES_MIGRATION_VERSION],
    );
    if (applied.rowCount === 0) {
      const sql = await readFile(BASELINE_SQL_URL, "utf8");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version,name,applied_at) VALUES ($1,$2,$3)",
        [POSTGRES_MIGRATION_VERSION, MIGRATION_NAME, new Date().toISOString()],
      );
    } else if (applied.rows[0].name !== MIGRATION_NAME) {
      throw new Error(`Unexpected Postgres migration name for version ${POSTGRES_MIGRATION_VERSION}: ${applied.rows[0].name}`);
    }
    await revokeSourceVisibleDevelopmentCredentials(client);
    await client.query("COMMIT");
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
    throw sanitizeStorageError(error);
  } finally {
    client.release(releaseError || undefined);
  }
}

async function revokeSourceVisibleDevelopmentCredentials(client) {
  await client.query("DELETE FROM api_keys WHERE key_hash = ANY($1::text[])", [REVOKED_API_KEY_HASHES]);
  await client.query("DELETE FROM adjudicator_api_keys WHERE key_hash = ANY($1::text[])", [REVOKED_ADJUDICATOR_KEY_HASHES]);
}

function assertSafeSchema(schema) {
  if (!SAFE_SCHEMA.test(schema)) throw new Error("Postgres schema name is invalid.");
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
