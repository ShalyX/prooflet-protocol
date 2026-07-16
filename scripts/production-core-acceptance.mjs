import assert from "node:assert/strict";
import { resolve } from "node:path";
import { appendFileSync, copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { assertDurableProductionStorage, openDatabase } from "../server/db.mjs";
import { backupDatabase, restoreDatabase } from "../server/database-backup.mjs";
import { createApp } from "../server/api.mjs";
import { seedDatabase } from "../server/seed.mjs";
import { migrations } from "../server/migrations/index.mjs";
import { startTestApi } from "./test-helpers.mjs";

const test = await startTestApi("production-core-health");
try {
  const response = await fetch(`${test.baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/i);
  assert.deepEqual(Object.keys(body).sort(), ["database", "ok", "protocol", "requestId", "storage", "version"].sort());
  assert.deepEqual(body.database, { connected: true, migrationVersion: 14, foreignKeys: true });
  assert.equal(body.storage.configured, true);
  assert.equal(body.storage.durable, false);
  assert.equal(body.storage.mode, "local");
  assert.equal(body.requestId, response.headers.get("x-request-id"));
  assert.ok(!JSON.stringify(body).includes(test.path));

  process.env["PROOFLET_ALLOWED_ORIGINS"] = "https://prooflet.xyz,https://www.prooflet.xyz";
  const untrustedOriginResponse = await fetch(`${test.baseUrl}/health`, { headers: { origin: "https://evil.example" } });
  assert.equal(untrustedOriginResponse.headers.get("access-control-allow-origin"), null);
  const trustedOriginResponse = await fetch(`${test.baseUrl}/health`, { headers: { origin: "https://prooflet.xyz" } });
  assert.equal(trustedOriginResponse.headers.get("access-control-allow-origin"), "https://prooflet.xyz");
  delete process.env["PROOFLET_ALLOWED_ORIGINS"];
  const invalidRequestIdResponse = await fetch(`${test.baseUrl}/health`, { headers: { "x-request-id": "caller-controlled-log-value" } });
  assert.match(invalidRequestIdResponse.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/i);
  assert.notEqual(invalidRequestIdResponse.headers.get("x-request-id"), "caller-controlled-log-value");
  const clientRequestId = "d9428888-122b-4a74-9f3f-5f6f0b8c9d10";
  const validClientRequestIdResponse = await fetch(`${test.baseUrl}/health`, { headers: { "x-request-id": clientRequestId } });
  assert.notEqual(validClientRequestIdResponse.headers.get("x-request-id"), clientRequestId);

  console.log(JSON.stringify({ ok: true, checks: [
    "health reports database connectivity and migration version",
    "health omits database paths and secrets",
    "mutable health state is not cached",
    "security headers and request correlation are present",
    "server request IDs remain authoritative even when callers supply valid UUIDs",
    "CORS allows configured frontend origins without reflecting untrusted origins"
  ] }, null, 2));
} finally {
  await test.close();
}

assert.throws(
  () => assertDurableProductionStorage("/tmp/prooflet.sqlite", {
    NODE_ENV: "production",
    PROOFLET_DURABLE_STORAGE_REQUIRED: "true",
    PROOFLET_STORAGE_DURABILITY: "local",
  }),
  /durable storage/i,
);
assert.doesNotThrow(() => assertDurableProductionStorage("/var/data/prooflet.sqlite", {
  NODE_ENV: "production",
  PROOFLET_DURABLE_STORAGE_REQUIRED: "true",
  PROOFLET_STORAGE_DURABILITY: "persistent-disk",
  PROOFLET_PERSISTENT_MOUNT_PATH: "/var/data",
}));

const renderSource = readFileSync(resolve("render.yaml"), "utf8");
const renderEnvironment = parseRenderEnvironment(renderSource);
assert.match(renderSource, /^\s*plan:\s*free\s*$/m);
assert.doesNotMatch(renderSource, /^\s*(disk|disks):/m);
assert.equal(renderEnvironment.UWP_DB_PATH, "/tmp/prooflet.sqlite");
assert.notEqual(renderEnvironment.PROOFLET_SEED_DEMO_DATA, "true");
assert.doesNotThrow(() => assertDurableProductionStorage(renderEnvironment.UWP_DB_PATH, {
  NODE_ENV: renderEnvironment.NODE_ENV,
  PROOFLET_DURABLE_STORAGE_REQUIRED: renderEnvironment.PROOFLET_DURABLE_STORAGE_REQUIRED,
  PROOFLET_STORAGE_DURABILITY: renderEnvironment.PROOFLET_STORAGE_DURABILITY,
  PROOFLET_PERSISTENT_MOUNT_PATH: renderEnvironment.PROOFLET_PERSISTENT_MOUNT_PATH,
}));
assert.throws(() => assertDurableProductionStorage("/root/prooflet.sqlite", {
  NODE_ENV: "production",
  PROOFLET_DURABLE_STORAGE_REQUIRED: "true",
  PROOFLET_STORAGE_DURABILITY: "persistent-disk",
  PROOFLET_PERSISTENT_MOUNT_PATH: "/var/data",
}), /persistent disk path/);

const restartPath = resolve("data/production-core-restart.sqlite");
let restartDb = openDatabase({ path: restartPath, reset: true });
restartDb.prepare("INSERT INTO issuers (issuer_id,name,status,created_at) VALUES (?,?,?,?)")
  .run("restart_probe", "Restart Probe", "active", new Date().toISOString());
restartDb.close();
restartDb = openDatabase({ path: restartPath });
try {
  assert.equal(restartDb.prepare("SELECT name FROM issuers WHERE issuer_id=?").get("restart_probe").name, "Restart Probe");
} finally {
  restartDb.close();
  const { cleanupDatabase } = await import("./test-helpers.mjs");
  cleanupDatabase(restartPath);
}

console.log(JSON.stringify({ ok: true, checks: [
  "production rejects ephemeral storage when durability is required",
  "free Render profile remains explicitly ephemeral without a paid disk",
  "persistent-disk configuration passes only when the database is inside the configured mount",
  "protocol state survives database close and reopen"
] }, null, 2));

const backupSourcePath = resolve("data/production-core-backup-source.sqlite");
const backupPath = resolve("data/backups/production-core-backup.sqlite");
const untrustedBackupPath = resolve("data/backups/production-core-untrusted.sqlite");
const tamperedBackupPath = resolve("data/backups/production-core-tampered.sqlite");
let backupDb = openDatabase({ path: backupSourcePath, reset: true });
backupDb.prepare("INSERT INTO issuers (issuer_id,name,status,created_at) VALUES (?,?,?,?)")
  .run("backup_probe", "Backup Probe", "active", new Date().toISOString());
await backupDatabase(backupDb, backupPath);
await assert.rejects(() => backupDatabase(backupDb, backupPath), /already exists/i);
copyFileSync(backupPath, untrustedBackupPath);
assert.throws(
  () => restoreDatabase({ sourcePath: untrustedBackupPath, destinationPath: backupSourcePath }),
  /manifest is missing/i,
);
copyFileSync(backupPath, tamperedBackupPath);
copyFileSync(`${backupPath}.manifest.json`, `${tamperedBackupPath}.manifest.json`);
appendFileSync(tamperedBackupPath, "tampered");
assert.throws(
  () => restoreDatabase({ sourcePath: tamperedBackupPath, destinationPath: backupSourcePath }),
  /checksum does not match/i,
);
assert.equal(backupDb.prepare("SELECT name FROM issuers WHERE issuer_id=?").get("backup_probe").name, "Backup Probe");
backupDb.close();

backupDb = openDatabase({ path: backupSourcePath });
backupDb.prepare("DELETE FROM issuers WHERE issuer_id=?").run("backup_probe");
backupDb.prepare("INSERT INTO issuers (issuer_id,name,status,created_at) VALUES (?,?,?,?)")
  .run("post_backup_mutation", "Post-backup Mutation", "active", new Date().toISOString());
backupDb.close();
restoreDatabase({ sourcePath: backupPath, destinationPath: backupSourcePath });
backupDb = openDatabase({ path: backupSourcePath });
try {
  assert.equal(backupDb.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(backupDb.prepare("SELECT name FROM issuers WHERE issuer_id=?").get("backup_probe").name, "Backup Probe");
  assert.equal(backupDb.prepare("SELECT 1 FROM issuers WHERE issuer_id=?").get("post_backup_mutation"), undefined);
} finally {
  backupDb.close();
}

assert.equal(existsSync(`${backupPath}-wal`), false);
assert.equal(existsSync(`${backupPath}-shm`), false);
restoreDatabase({ sourcePath: backupPath, destinationPath: backupSourcePath });
backupDb = openDatabase({ path: backupSourcePath });
try {
  assert.equal(backupDb.prepare("SELECT name FROM issuers WHERE issuer_id=?").get("backup_probe").name, "Backup Probe");
} finally {
  backupDb.close();
  const { cleanupDatabase } = await import("./test-helpers.mjs");
  cleanupDatabase(backupSourcePath);
  cleanupDatabase(backupPath);
  cleanupDatabase(untrustedBackupPath);
  cleanupDatabase(tamperedBackupPath);
  rmSync(`${backupPath}.manifest.json`, { force: true });
  rmSync(`${tamperedBackupPath}.manifest.json`, { force: true });
}

console.log(JSON.stringify({ ok: true, checks: [
  "online backup captures committed protocol state",
  "restore validates integrity and recovers the backup snapshot",
  "one immutable backup artifact can be restored repeatedly without sidecars",
  "backup refuses to overwrite an existing artifact",
  "restore rejects raw or checksum-tampered artifacts without altering the destination"
] }, null, 2));

const emptyProductionPath = resolve("data/production-core-empty.sqlite");
const emptyProductionDb = openDatabase({ path: emptyProductionPath, reset: true });
const safeWalletService = {
  createAgentWallet: async () => null,
  createIssuerWallet: async () => null,
  getCircleStatus: () => ({ configured: false }),
  isCircleConfigured: () => false,
  getWalletBalance: async () => null,
  sendUsdc: async () => null,
  getWalletDetails: async () => null,
};
const passThroughGateway = { require: () => (_request, _response, next) => next() };
const emptyProductionApp = createApp({ db: emptyProductionDb, walletService: safeWalletService, gatewayMiddleware: passThroughGateway, seedDemoData: false }).app;
const emptyProductionServer = emptyProductionApp.listen(0, "127.0.0.1");
await new Promise((resolveListening) => emptyProductionServer.once("listening", resolveListening));
try {
  const dashboardResponse = await fetch(`http://127.0.0.1:${emptyProductionServer.address().port}/dashboard`);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboardResponse.status, 200);
  assert.equal(dashboard.issuer, null);
  assert.deepEqual(dashboard.agents, []);
  assert.deepEqual(dashboard.jobs, []);
  assert.deepEqual(dashboard.proofs, []);
} finally {
  await new Promise((resolveClose) => emptyProductionServer.close(resolveClose));
  emptyProductionDb.close();
  const { cleanupDatabase } = await import("./test-helpers.mjs");
  cleanupDatabase(emptyProductionPath);
}

console.log(JSON.stringify({ ok: true, checks: [
  "production can start without silently inserting demo identities or settlement evidence",
  "an empty production ledger returns an explicit empty dashboard state"
] }, null, 2));

const credentialRevocationPath = resolve("data/production-core-credential-revocation.sqlite");
let credentialRevocationDb = openDatabase({ path: credentialRevocationPath, reset: true });
try {
  assert.throws(() => seedDatabase(credentialRevocationDb, { env: { NODE_ENV: "production" } }), /disabled in production/i);
  seedDatabase(credentialRevocationDb, { env: { NODE_ENV: "test" } });
  assert.ok(credentialRevocationDb.prepare("SELECT COUNT(*) AS count FROM api_keys").get().count > 0);
  assert.ok(credentialRevocationDb.prepare("SELECT COUNT(*) AS count FROM adjudicator_api_keys").get().count > 0);
  migrations.find((migration) => migration.version === 13).up(credentialRevocationDb);
  assert.equal(credentialRevocationDb.prepare("SELECT COUNT(*) AS count FROM api_keys").get().count, 0);
  assert.equal(credentialRevocationDb.prepare("SELECT COUNT(*) AS count FROM adjudicator_api_keys").get().count, 0);

  seedDatabase(credentialRevocationDb, { env: { NODE_ENV: "test" } });
  credentialRevocationDb.close();
  credentialRevocationDb = null;
  credentialRevocationDb = openDatabase({ path: credentialRevocationPath, env: { NODE_ENV: "production" } });
  assert.equal(credentialRevocationDb.prepare("SELECT COUNT(*) AS count FROM api_keys").get().count, 0);
  assert.equal(credentialRevocationDb.prepare("SELECT COUNT(*) AS count FROM adjudicator_api_keys").get().count, 0);
} finally {
  credentialRevocationDb?.close();
  const { cleanupDatabase } = await import("./test-helpers.mjs");
  cleanupDatabase(credentialRevocationPath);
}

console.log(JSON.stringify({ ok: true, checks: [
  "demo seeding fails closed in production",
  "known source-visible development credentials are revoked by migration and on every production open"
] }, null, 2));

const errorPath = resolve("data/production-core-error.sqlite");
const errorDb = openDatabase({ path: errorPath, reset: true });
const walletService = {
  createAgentWallet: async () => null,
  createIssuerWallet: async () => null,
  getCircleStatus() { const error = new Error("sensitive-upstream-detail"); error.code = "ECONNRESET"; throw error; },
  isCircleConfigured: () => false,
  getWalletBalance: async () => null,
  sendUsdc: async () => null,
  getWalletDetails: async () => null,
};
const gatewayMiddleware = { require: () => (_request, _response, next) => next() };
const errorApp = createApp({ db: errorDb, walletService, gatewayMiddleware }).app;
const errorServer = errorApp.listen(0, "127.0.0.1");
await new Promise((resolveListening) => errorServer.once("listening", resolveListening));
const originalConsoleError = console.error;
try {
  console.error = () => {};
  const errorResponse = await fetch(`http://127.0.0.1:${errorServer.address().port}/circle/status`);
  const errorBody = await errorResponse.json();
  assert.equal(errorResponse.status, 500);
  assert.equal(errorBody.error, "Internal server error.");
  assert.equal(errorBody.code, "internal_error");
  assert.equal(errorBody.requestId, errorResponse.headers.get("x-request-id"));
  assert.ok(!JSON.stringify(errorBody).includes("sensitive-upstream-detail"));
} finally {
  console.error = originalConsoleError;
  await new Promise((resolveClose) => errorServer.close(resolveClose));
  errorDb.close();
  const { cleanupDatabase } = await import("./test-helpers.mjs");
  cleanupDatabase(errorPath);
}

console.log(JSON.stringify({ ok: true, checks: [
  "unexpected server errors return a stable code and request ID",
  "unexpected server errors do not expose raw exception details"
] }, null, 2));

function parseRenderEnvironment(source) {
  const environment = {};
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const key = lines[index].match(/^\s+- key: ([A-Z0-9_]+)\s*$/)?.[1];
    if (!key) continue;
    const value = lines[index + 1]?.match(/^\s+value:\s*["']?([^"']*)["']?\s*$/)?.[1];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}
