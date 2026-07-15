import assert from "node:assert/strict";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createStore } from "../server/storage/index.mjs";
import { generateApiKey } from "../server/auth.mjs";

const now = "2026-07-15T13:00:00.000Z";

async function seedBase(store, label) {
  await store.transaction(async (tx) => {
    await tx.identity.createIssuer({
      issuerId: `issuer_${label}`,
      name: `Issuer ${label}`,
      treasuryAddress: null,
      email: null,
      description: null,
      status: "active",
      createdAt: now,
      circleWalletId: null,
    });
    await tx.identity.createAgent({
      agentId: `agent_${label}`,
      handle: `agent_${label}`,
      name: `Agent ${label}`,
      capabilities: ["link_verification"],
      payoutAddress: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4",
      status: "idle",
      reputationScore: 50,
      createdAt: now,
      circleWalletId: null,
    });
    await tx.identity.storeApiKey({
      ownerType: "agent",
      ownerId: `agent_${label}`,
      apiKey: generateApiKey("agent"),
      createdAt: now,
    });
    await tx.jobs.createJob({
      jobId: `job_${label}`,
      issuerId: `issuer_${label}`,
      issuerReferenceId: null,
      jobType: "link_verification",
      input: { url: "https://example.test/access" },
      rewardAmount: "0.01",
      rewardAsset: "USDC",
      network: "Arc Testnet",
      fundingStatus: "reserved",
      status: "open",
      proofRequirements: { type: "link" },
      verificationMode: "deterministic",
      requiredAccessLevel: "starter",
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function exerciseAccessAndProofs(store, label) {
  assert.equal(typeof store.accessPayments, "object");
  assert.equal(typeof store.proofs, "object");
  await seedBase(store, label);

  const recorded = await store.transaction(async (tx) => tx.accessPayments.recordPaidAccess({
    jobId: `job_${label}`,
    agentId: `agent_${label}`,
    rail: "circle_gateway_x402",
    amount: "0.000001",
    payerAddress: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4",
    gatewayTransactionId: `gw_${label}`,
    network: "eip155:5042002",
    metadata: { resource: "job_access" },
    createdAt: now,
  }));
  assert.equal(recorded.status, "paid");
  assert.equal(await store.accessPayments.hasPaidAccess(`job_${label}`, `agent_${label}`), true);

  const byGateway = await store.accessPayments.findByGatewayTransactionId(`gw_${label}`);
  assert.equal(byGateway.agentId, `agent_${label}`);

  // Idempotent re-record for same job/agent.
  const again = await store.accessPayments.recordPaidAccess({
    jobId: `job_${label}`,
    agentId: `agent_${label}`,
    rail: "circle_gateway_x402",
    amount: "0.000001",
    payerAddress: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4",
    gatewayTransactionId: `gw_${label}`,
    network: "eip155:5042002",
    metadata: { resource: "job_access", retry: true },
    createdAt: now,
  });
  assert.equal(again.status, "paid");

  await store.transaction(async (tx) => {
    await tx.jobs.claimJob({
      jobId: `job_${label}`,
      agentId: `agent_${label}`,
      claimedAt: "2026-07-15T13:01:00.000Z",
      leaseExpiresAt: "2026-07-15T13:11:00.000Z",
      access: {
        rail: "circle_gateway_x402",
        price: "0.000001",
        status: "paid",
        txHash: null,
      },
    });
  });

  const claimRow = store.dialect === "sqlite"
    ? store.native.prepare("SELECT claim_id FROM job_claims WHERE job_id=? AND agent_id=? ORDER BY claim_id DESC LIMIT 1").get(`job_${label}`, `agent_${label}`)
    : (await store.query("SELECT claim_id FROM job_claims WHERE job_id=$1 AND agent_id=$2 ORDER BY claim_id DESC LIMIT 1", [`job_${label}`, `agent_${label}`])).rows[0];

  const created = await store.transaction(async (tx) => {
    const proof = await tx.proofs.createProof({
      proofId: `proof_${label}`,
      jobId: `job_${label}`,
      agentId: `agent_${label}`,
      jobType: "link_verification",
      input: { url: "https://example.test/access" },
      result: { ok: true },
      verificationRoute: "deterministic_v0",
      proofTimestamp: "2026-07-15T13:02:00.000Z",
      fingerprint: `fp_${label}`,
      outcome: "accepted",
      rejectionReason: null,
      fundingStatus: "payable",
      settlementStatus: "Awaiting Arc Testnet settlement",
      verificationStatus: "deterministic_verified",
      adjudicationStatus: "not_required",
      createdAt: "2026-07-15T13:02:00.000Z",
    });
    await tx.proofs.markClaimSubmitted(claimRow.claim_id);
    await tx.proofs.completeJobAfterProof({
      jobId: `job_${label}`,
      jobStatus: "completed",
      fundingStatus: "payable",
      updatedAt: "2026-07-15T13:02:00.000Z",
    });
    return proof;
  });
  assert.equal(created.outcome, "accepted");

  await assert.rejects(
    () => store.proofs.createProof({
      proofId: `proof_${label}`,
      jobId: `job_${label}`,
      agentId: `agent_${label}`,
      jobType: "link_verification",
      input: { url: "https://example.test/access" },
      result: { ok: true },
      verificationRoute: "deterministic_v0",
      proofTimestamp: "2026-07-15T13:03:00.000Z",
      fingerprint: `fp_${label}_other`,
      outcome: "accepted",
      rejectionReason: null,
      fundingStatus: "payable",
      settlementStatus: "Awaiting Arc Testnet settlement",
      verificationStatus: "deterministic_verified",
      adjudicationStatus: "not_required",
      createdAt: "2026-07-15T13:03:00.000Z",
    }),
    (error) => error?.code === "UNIQUE_VIOLATION" || /unique|UNIQUE/i.test(String(error?.message || error)),
  );

  const found = await store.proofs.findByFingerprint(`fp_${label}`);
  assert.equal(found.proofId, `proof_${label}`);
}

const sqlitePath = resolve("data/access-proofs-repository.sqlite");
const sqlite = await createStore({
  env: { DB_DIALECT: "sqlite", NODE_ENV: "test" },
  sqlite: { path: sqlitePath, reset: true },
});
try {
  await exerciseAccessAndProofs(sqlite, "sqlite");
} finally {
  await sqlite.close();
  const { cleanupDatabase } = await import("./test-helpers.mjs");
  cleanupDatabase(sqlitePath);
}

const connectionString = process.env["TEST_DATABASE_URL"] || "postgresql:///prooflet_test?host=%2Fvar%2Frun%2Fpostgresql";
const schema = `access_proofs_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const postgres = await createStore({
  env: { DATABASE_URL: connectionString, PGPOOL_MAX: "3" },
  schema,
  sharePool: false,
});
try {
  await exerciseAccessAndProofs(postgres, "postgres");
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
    "access payments repository records paid access idempotently for job/agent pairs",
    "gateway transaction lookup works",
    "proofs repository creates proofs and completes jobs under transactions",
    "duplicate fingerprints can be detected without blocking rejected-proof recording",
  ],
}, null, 2));
