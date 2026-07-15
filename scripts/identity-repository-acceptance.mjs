import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createStore } from "../server/storage/index.mjs";
import { generateApiKey } from "../server/auth.mjs";

const now = "2026-07-15T12:00:00.000Z";
const sqlitePath = resolve("data/identity-repository.sqlite");

async function exerciseIdentity(store, label) {
  assert.equal(typeof store.identity, "object", `${label}: store.identity must exist`);

  const issuer = {
    issuerId: `issuer_${label}`,
    name: `Issuer ${label}`,
    treasuryAddress: "0x709F18F797347FbB8D53Fb60567892751dd14B11",
    email: `${label}@example.test`,
    description: "identity repository acceptance",
    status: "active",
    createdAt: now,
    circleWalletId: null,
  };

  await store.transaction(async (tx) => {
    await tx.identity.createIssuer(issuer);
    const apiKey = generateApiKey("issuer");
    await tx.identity.storeApiKey({
      ownerType: "issuer",
      ownerId: issuer.issuerId,
      apiKey,
      createdAt: now,
    });
    const loaded = await tx.identity.getIssuer(issuer.issuerId);
    assert.equal(loaded.issuerId, issuer.issuerId);
    assert.equal(loaded.name, issuer.name);
    assert.equal(await tx.identity.authenticateApiKey({
      ownerType: "issuer",
      ownerId: issuer.issuerId,
      apiKey,
    }), true);
    assert.equal(await tx.identity.authenticateApiKey({
      ownerType: "issuer",
      ownerId: issuer.issuerId,
      apiKey: "uwp_issuer_wrong",
    }), false);
  });

  await assert.rejects(
    () => store.transaction(async (tx) => tx.identity.createIssuer(issuer)),
    (error) => error?.code === "UNIQUE_VIOLATION" || /unique|UNIQUE/i.test(String(error?.message || error)),
  );

  const agent = {
    agentId: `agent_${label}`,
    handle: `handle_${label}`,
    name: `Agent ${label}`,
    capabilities: ["link_verification"],
    payoutAddress: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4",
    status: "idle",
    reputationScore: 50,
    createdAt: now,
    circleWalletId: null,
  };

  await store.transaction(async (tx) => {
    await tx.identity.createAgent(agent);
    const apiKey = generateApiKey("agent");
    await tx.identity.storeApiKey({
      ownerType: "agent",
      ownerId: agent.agentId,
      apiKey,
      createdAt: now,
    });
    const loaded = await tx.identity.getAgent(agent.agentId);
    assert.equal(loaded.agentId, agent.agentId);
    assert.deepEqual(loaded.capabilities, ["link_verification"]);
    assert.equal(await tx.identity.authenticateApiKey({
      ownerType: "agent",
      ownerId: agent.agentId,
      apiKey,
    }), true);
  });
}

const sqlite = await createStore({
  env: { DB_DIALECT: "sqlite", NODE_ENV: "test" },
  sqlite: { path: sqlitePath, reset: true },
});
try {
  await exerciseIdentity(sqlite, "sqlite");
} finally {
  await sqlite.close();
  const { cleanupDatabase } = await import("./test-helpers.mjs");
  cleanupDatabase(sqlitePath);
}

const connectionString = process.env["TEST_DATABASE_URL"] || "postgresql:///prooflet_test?host=%2Fvar%2Frun%2Fpostgresql";
const { randomUUID } = await import("node:crypto");
const schema = `identity_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const postgres = await createStore({
  env: { DATABASE_URL: connectionString, PGPOOL_MAX: "2" },
  schema,
  sharePool: false,
});
try {
  await exerciseIdentity(postgres, "postgres");
} finally {
  await postgres.close();
  const { Pool } = await import("pg");
  const admin = new Pool({ connectionString, max: 1 });
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  const { closeSharedPostgresPools } = await import("../server/storage/index.mjs");
  await closeSharedPostgresPools();
}

console.log(JSON.stringify({
  ok: true,
  checks: [
    "identity repository registers issuers and agents under transactions",
    "API key storage authenticates only matching active owners",
    "duplicate issuer creation fails closed with a unique violation signal",
    "sqlite and postgres adapters share the same identity repository contract",
  ],
}, null, 2));
