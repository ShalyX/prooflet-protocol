import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  closeSharedPostgresPools,
  createStore,
  postgresPoolConfig,
  resolveDialect,
  sanitizeStorageError,
  withPostgresTransaction,
} from "../server/storage/index.mjs";

assert.equal(resolveDialect({}), "sqlite");
assert.equal(resolveDialect({ DB_DIALECT: "sqlite" }), "sqlite");
assert.equal(resolveDialect({ DATABASE_URL: "postgresql://example.invalid/db" }), "postgres");
assert.equal(resolveDialect({ DB_DIALECT: "postgres", DATABASE_URL: "postgresql://example.invalid/db" }), "postgres");
assert.equal(resolveDialect({ NODE_ENV: "production", DATABASE_URL: "postgresql://example.invalid/db" }), "postgres");
assert.equal(resolveDialect({ NODE_ENV: "production", DB_DIALECT: "sqlite" }), "sqlite");
assert.throws(() => resolveDialect({ NODE_ENV: "production" }), /DATABASE_URL|DB_DIALECT/i);
assert.throws(
  () => resolveDialect({ NODE_ENV: "production", DB_DIALECT: "sqlite", DATABASE_URL: "postgresql://example.invalid/db" }),
  /cannot select DB_DIALECT=sqlite/i,
);
assert.throws(
  () => resolveDialect({ NODE_ENV: "production", DB_DIALECT: "postgres" }),
  /DATABASE_URL/i,
);
assert.throws(() => resolveDialect({ DB_DIALECT: "mysql" }), /DB_DIALECT/i);

const poolConfig = postgresPoolConfig({
  DATABASE_URL: "postgresql://user:secret@example.invalid/prooflet?sslmode=require",
  PGPOOL_MAX: "3",
});
assert.equal(poolConfig.connectionString.includes("secret"), true);
assert.equal(poolConfig.max, 3);
assert.equal(poolConfig.min, 0);
assert.equal(poolConfig.connectionTimeoutMillis, 10_000);
assert.equal(poolConfig.idleTimeoutMillis, 10_000);
assert.equal(poolConfig.maxLifetimeSeconds, 300);
assert.equal(poolConfig.query_timeout, 15_000);
assert.equal(poolConfig.application_name, "prooflet-api");
assert.equal("ssl" in poolConfig, false);
assert.equal(postgresPoolConfig({ DATABASE_URL: "postgresql://example.invalid/db", PGPOOL_MAX: "999" }).max, 10);
assert.equal(postgresPoolConfig({ DATABASE_URL: "postgresql://example.invalid/db", PGPOOL_MAX: "0" }).max, 3);

const redacted = sanitizeStorageError(new Error("connect ECONNREFUSED postgresql://user:secret@host/db"));
assert.equal(redacted.message, "Storage operation failed.");
assert.equal(redacted.name, "StorageError");

const sqlitePath = resolve("data/storage-contract.sqlite");
const store = await createStore({
  env: { DB_DIALECT: "sqlite", NODE_ENV: "test" },
  sqlite: { path: sqlitePath, reset: true },
});
try {
  assert.equal(store.dialect, "sqlite");
  assert.ok(store.native);
  const health = await store.health();
  assert.deepEqual(health, { connected: true, migrationVersion: 14, foreignKeys: true });

  await store.transaction(async (transactionStore) => {
    transactionStore.native.prepare("INSERT INTO issuers (issuer_id,name,status,created_at) VALUES (?,?,?,?)")
      .run("storage_commit", "Storage Commit", "active", new Date().toISOString());
    await Promise.resolve();
  });
  assert.equal(store.native.prepare("SELECT name FROM issuers WHERE issuer_id=?").get("storage_commit").name, "Storage Commit");

  await assert.rejects(
    () => store.transaction(async (transactionStore) => {
      transactionStore.native.prepare("INSERT INTO issuers (issuer_id,name,status,created_at) VALUES (?,?,?,?)")
        .run("storage_rollback", "Storage Rollback", "active", new Date().toISOString());
      await Promise.resolve();
      throw new Error("rollback probe");
    }),
    /rollback probe/,
  );
  assert.equal(store.native.prepare("SELECT 1 FROM issuers WHERE issuer_id=?").get("storage_rollback"), undefined);

  let secondTransactionError = null;
  const first = store.transaction(async () => {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    return "first";
  });
  const closePromise = store.close();
  const second = store.transaction(async () => "second").catch((error) => {
    secondTransactionError = error;
  });
  await assert.equal(await first, "first");
  await closePromise;
  await second;
  assert.match(String(secondTransactionError?.message || ""), /Store is closed/);
} finally {
  await store.close().catch(() => {});
  const { cleanupDatabase } = await import("./test-helpers.mjs");
  cleanupDatabase(sqlitePath);
}

const events = [];
let releaseArg = "unset";
const fakeClient = {
  async query(sql) {
    events.push(sql);
    if (sql === "ROLLBACK") throw new Error("rollback failed");
  },
  release(arg) {
    releaseArg = arg === undefined ? null : arg;
    events.push("RELEASE");
  },
};
const fakePool = { async connect() { events.push("CONNECT"); return fakeClient; } };

const transactionResult = await withPostgresTransaction({
  async connect() {
    events.push("CONNECT");
    return {
      async query(sql) { events.push(sql); },
      release(arg) {
        releaseArg = arg === undefined ? null : arg;
        events.push("RELEASE");
      },
    };
  },
}, async (client) => {
  assert.ok(client);
  events.push("OPERATION");
  return "committed";
});
assert.equal(transactionResult, "committed");
assert.deepEqual(events, ["CONNECT", "BEGIN", "OPERATION", "COMMIT", "RELEASE"]);
assert.equal(releaseArg, null);

events.length = 0;
releaseArg = "unset";
await assert.rejects(
  () => withPostgresTransaction(fakePool, async () => {
    events.push("OPERATION");
    throw new Error("postgres rollback probe");
  }),
  /postgres rollback probe/,
);
assert.deepEqual(events, ["CONNECT", "BEGIN", "OPERATION", "ROLLBACK", "RELEASE"]);
assert.equal(releaseArg?.message, "rollback failed");

await closeSharedPostgresPools();

console.log(JSON.stringify({
  ok: true,
  checks: [
    "backend selection fails closed for invalid or unconfigured Postgres",
    "production auto-selects Postgres from DATABASE_URL and rejects silent SQLite fallback",
    "Neon pool configuration is bounded and keeps TLS configuration in the URL",
    "SQLite store exposes async health, commit, rollback, close, and close-race rejection",
    "Postgres transactions stay pinned to one client and discard broken clients after rollback failure",
    "storage errors containing connection strings are sanitized",
  ],
}, null, 2));
