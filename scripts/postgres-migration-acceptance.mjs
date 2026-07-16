import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { closeSharedPostgresPools } from "../server/storage/index.mjs";
import {
  POSTGRES_MIGRATION_VERSION,
  createPostgresStore,
} from "../server/storage/postgres.mjs";

const connectionString = process.env["TEST_DATABASE_URL"] || "postgresql:///prooflet_test?host=%2Fvar%2Frun%2Fpostgresql";
if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required for Postgres migration acceptance.");
}
const schema = `prooflet_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString, max: 2, application_name: "prooflet-migration-acceptance" });

try {
  const [first, second] = await Promise.all([
    createPostgresStore({ env: { DATABASE_URL: connectionString, PGPOOL_MAX: "2" }, schema, sharePool: false }),
    createPostgresStore({ env: { DATABASE_URL: connectionString, PGPOOL_MAX: "2" }, schema, sharePool: false }),
  ]);
  try {
    const firstHealth = await first.health();
    const secondHealth = await second.health();
    assert.deepEqual(firstHealth, { connected: true, migrationVersion: POSTGRES_MIGRATION_VERSION, foreignKeys: true });
    assert.deepEqual(secondHealth, firstHealth);
    assert.equal(first.dialect, "postgres");
    assert.equal("native" in first, false);

    const migrationRows = await first.query("SELECT version,name FROM schema_migrations ORDER BY version");
    assert.deepEqual(migrationRows.rows, [
      { version: 13, name: "postgres_v13_compatibility_baseline" },
      { version: 14, name: "wallet_auth_nonces_v14" },
    ]);

    const tables = await admin.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 ORDER BY table_name",
      [schema],
    );
    const tableNames = new Set(tables.rows.map((row) => row.table_name));
    for (const required of [
      "issuers", "agents", "api_keys", "jobs", "job_claims", "proofs",
      "job_access_payments", "reputation_events", "agent_reputation_summary",
      "adjudicators", "adjudicator_api_keys", "adjudication_decisions",
      "genlayer_adjudication_requests", "genlayer_adjudication_decisions",
      "issuer_uploads", "issuer_upload_rows", "compound_jobs",
      "settlement_batches", "settlement_transactions", "settlement_failures",
      "wallet_auth_nonces",
      "schema_migrations",
    ]) assert.equal(tableNames.has(required), true, `Missing Postgres table ${required}`);

    await first.query(
      "INSERT INTO api_keys (owner_type,owner_id,key_hash,key_prefix,active,created_at) VALUES ($1,$2,$3,$4,1,$5)",
      ["issuer", "revoked_probe", "ac5aa45be82d1f55f17cdb2cade05fc317495b7e5b3d9fb679a9a9035ceba16d", "uwp_issuer_test", new Date().toISOString()],
    );
    await first.close();
    const reopened = await createPostgresStore({ env: { DATABASE_URL: connectionString, PGPOOL_MAX: "2" }, schema, sharePool: false });
    try {
      const remaining = await reopened.query(
        "SELECT 1 FROM api_keys WHERE key_hash=$1",
        ["ac5aa45be82d1f55f17cdb2cade05fc317495b7e5b3d9fb679a9a9035ceba16d"],
      );
      assert.equal(remaining.rowCount, 0, "known source-visible development key hashes must be revoked on open");

      const committed = await reopened.transaction(async (repositories) => {
        const result = await repositories.query(
          "INSERT INTO issuers (issuer_id,name,status,created_at) VALUES ($1,$2,$3,$4) RETURNING issuer_id",
          ["pg_commit", "Postgres Commit", "active", new Date().toISOString()],
        );
        return result.rows[0].issuer_id;
      });
      assert.equal(committed, "pg_commit");

      await assert.rejects(
        () => reopened.transaction(async (repositories) => {
          await repositories.query(
            "INSERT INTO issuers (issuer_id,name,status,created_at) VALUES ($1,$2,$3,$4)",
            ["pg_rollback", "Postgres Rollback", "active", new Date().toISOString()],
          );
          throw new Error("postgres migration rollback probe");
        }),
        /rollback probe/,
      );
      assert.equal((await reopened.query("SELECT 1 FROM issuers WHERE issuer_id=$1", ["pg_rollback"])).rowCount, 0);

      const duplicateError = await reopened.query(
        "INSERT INTO issuers (issuer_id,name,status,created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        ["pg_commit", "Duplicate", "active", new Date().toISOString()],
      );
      assert.equal(duplicateError.rowCount, 0);
    } finally {
      await reopened.close();
    }
  } finally {
    await Promise.all([first.close().catch(() => {}), second.close().catch(() => {})]);
  }
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  await closeSharedPostgresPools();
}

console.log(JSON.stringify({
  ok: true,
  checks: [
    "two concurrent Postgres initializers serialize one v13 baseline migration",
    "the compatibility schema contains every current protocol table",
    "known source-visible development credentials are revoked on Postgres open",
    "Postgres health exposes only connectivity, migration version, and foreign-key semantics",
    "transaction commit and rollback stay isolated on one client",
  ],
}, null, 2));
