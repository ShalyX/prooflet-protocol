import assert from "node:assert/strict";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createStore } from "../server/storage/index.mjs";
import { generateApiKey } from "../server/auth.mjs";

const now = "2026-07-15T14:00:00.000Z";

async function seedPayable(store, label) {
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
      input: { url: "https://example.test/settle" },
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
    await tx.jobs.claimJob({
      jobId: `job_${label}`,
      agentId: `agent_${label}`,
      claimedAt: now,
      leaseExpiresAt: "2026-07-15T14:10:00.000Z",
      access: { rail: "circle_gateway_x402", price: "0.000001", status: "paid", txHash: null },
    });
    const claim = store.dialect === "sqlite"
      ? store.native.prepare("SELECT claim_id FROM job_claims WHERE job_id=? ORDER BY claim_id DESC LIMIT 1").get(`job_${label}`)
      : (await tx.query("SELECT claim_id FROM job_claims WHERE job_id=$1 ORDER BY claim_id DESC LIMIT 1", [`job_${label}`])).rows[0];
    await tx.proofs.createProof({
      proofId: `proof_${label}`,
      jobId: `job_${label}`,
      agentId: `agent_${label}`,
      jobType: "link_verification",
      input: { url: "https://example.test/settle" },
      result: { ok: true },
      verificationRoute: "deterministic_v0",
      proofTimestamp: now,
      fingerprint: `fp_settle_${label}`,
      outcome: "accepted",
      rejectionReason: null,
      fundingStatus: "payable",
      settlementStatus: "Awaiting Arc Testnet settlement",
      verificationStatus: "deterministic_verified",
      adjudicationStatus: "not_required",
      createdAt: now,
    });
    await tx.proofs.markClaimSubmitted(claim.claim_id);
    await tx.proofs.completeJobAfterProof({
      jobId: `job_${label}`,
      jobStatus: "completed",
      fundingStatus: "payable",
      updatedAt: now,
    });
  });
}

async function exerciseSettlement(store, label) {
  assert.equal(typeof store.settlement, "object");
  await seedPayable(store, label);
  const batchId = `batch_${label}`;
  const txHash = `0x${"ab".repeat(32)}`;

  await store.transaction(async (tx) => {
    await tx.settlement.createPreparingBatch({
      batchId,
      issuerId: `issuer_${label}`,
      network: "Arc Testnet",
      chainId: 5042002,
      asset: "USDC",
      totalPayout: "0.01",
      createdAt: now,
    });
    await tx.settlement.lockProofToBatch({ batchId, proofId: `proof_${label}` });
    await tx.settlement.markBatchPrepared(batchId);
  });

  const prepared = await store.settlement.getBatch(batchId);
  assert.equal(prepared.status, "prepared");

  await store.transaction(async (tx) => {
    await tx.settlement.markBatchSettled({ batchId, settledAt: "2026-07-15T14:05:00.000Z" });
    await tx.settlement.markProofPaid({
      proofId: `proof_${label}`,
      batchId,
      txHash,
      explorerUrl: `https://testnet.arcscan.io/tx/${txHash}`,
    });
    await tx.settlement.insertSettlementTransaction({
      batchId,
      proofId: `proof_${label}`,
      agentId: `agent_${label}`,
      recipientAddress: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4",
      amount: "0.01",
      txHash,
      explorerUrl: `https://testnet.arcscan.io/tx/${txHash}`,
      blockNumber: "1",
      status: "success",
      createdAt: "2026-07-15T14:05:00.000Z",
    });
  });

  assert.equal(await store.settlement.hasSettlementTxHash(txHash), true);
  await assert.rejects(
    () => store.settlement.insertSettlementTransaction({
      batchId,
      proofId: `proof_${label}`,
      agentId: `agent_${label}`,
      recipientAddress: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4",
      amount: "0.01",
      txHash,
      explorerUrl: `https://testnet.arcscan.io/tx/${txHash}`,
      blockNumber: "1",
      status: "success",
      createdAt: "2026-07-15T14:06:00.000Z",
    }),
    (error) => error?.code === "UNIQUE_VIOLATION" || /unique|UNIQUE/i.test(String(error?.message || error)),
  );
}

const sqlitePath = resolve("data/settlement-repository.sqlite");
const sqlite = await createStore({
  env: { DB_DIALECT: "sqlite", NODE_ENV: "test" },
  sqlite: { path: sqlitePath, reset: true },
});
try {
  await exerciseSettlement(sqlite, "sqlite");
} finally {
  await sqlite.close();
  const { cleanupDatabase } = await import("./test-helpers.mjs");
  cleanupDatabase(sqlitePath);
}

const connectionString = process.env["TEST_DATABASE_URL"] || "postgresql:///prooflet_test?host=%2Fvar%2Frun%2Fpostgresql";
const schema = `settlement_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const postgres = await createStore({
  env: { DATABASE_URL: connectionString, PGPOOL_MAX: "3" },
  schema,
  sharePool: false,
});
try {
  await exerciseSettlement(postgres, "postgres");
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
    "settlement repository prepares batches and locks payable proofs",
    "settlement marks proofs paid under transaction",
    "duplicate settlement transaction hashes fail closed",
  ],
}, null, 2));
