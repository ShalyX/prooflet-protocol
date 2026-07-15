import assert from "node:assert/strict";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createStore } from "../server/storage/index.mjs";
import { generateApiKey } from "../server/auth.mjs";

const now = "2026-07-15T12:30:00.000Z";

async function seedIssuerAndAgents(store, label) {
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
    await tx.identity.storeApiKey({
      ownerType: "issuer",
      ownerId: `issuer_${label}`,
      apiKey: generateApiKey("issuer"),
      createdAt: now,
    });
    for (const agentId of [`agent_a_${label}`, `agent_b_${label}`]) {
      await tx.identity.createAgent({
        agentId,
        handle: agentId,
        name: agentId,
        capabilities: ["link_verification"],
        payoutAddress: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4",
        status: "idle",
        reputationScore: 50,
        createdAt: now,
        circleWalletId: null,
      });
    }
  });
}

async function exerciseJobs(store, label) {
  assert.equal(typeof store.jobs, "object", `${label}: store.jobs must exist`);
  await seedIssuerAndAgents(store, label);

  const jobId = `job_${label}`;
  const created = await store.transaction(async (tx) => tx.jobs.createJob({
    jobId,
    issuerId: `issuer_${label}`,
    issuerReferenceId: null,
    jobType: "link_verification",
    input: { url: "https://example.test/page" },
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
  }));
  assert.equal(created.jobId, jobId);
  assert.equal(created.status, "open");

  const first = await store.transaction(async (tx) => tx.jobs.claimJob({
    jobId,
    agentId: `agent_a_${label}`,
    claimedAt: "2026-07-15T12:31:00.000Z",
    leaseExpiresAt: "2026-07-15T12:41:00.000Z",
    access: {
      rail: "circle_gateway_x402",
      price: "0.000001",
      status: "paid",
      txHash: "0xabc",
    },
  }));
  assert.equal(first.status, "claimed");
  assert.equal(first.claimedBy, `agent_a_${label}`);

  await assert.rejects(
    () => store.transaction(async (tx) => tx.jobs.claimJob({
      jobId,
      agentId: `agent_b_${label}`,
      claimedAt: "2026-07-15T12:32:00.000Z",
      leaseExpiresAt: "2026-07-15T12:42:00.000Z",
      access: { rail: "circle_gateway_x402", price: "0.000001", status: "paid", txHash: "0xdef" },
    })),
    (error) => error?.code === "JOB_NOT_CLAIMABLE" || /not claimable|already claimed/i.test(String(error?.message || error)),
  );

  const loaded = await store.jobs.getJob(jobId);
  assert.equal(loaded.claimedBy, `agent_a_${label}`);
  assert.equal(loaded.status, "claimed");
}

async function exerciseConcurrentClaims(store, label) {
  await seedIssuerAndAgents(store, `${label}_c`);
  const jobId = `job_concurrent_${label}`;
  await store.transaction(async (tx) => tx.jobs.createJob({
    jobId,
    issuerId: `issuer_${label}_c`,
    issuerReferenceId: null,
    jobType: "link_verification",
    input: { url: "https://example.test/concurrent" },
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
  }));

  const attempts = await Promise.allSettled([
    store.transaction(async (tx) => tx.jobs.claimJob({
      jobId,
      agentId: `agent_a_${label}_c`,
      claimedAt: "2026-07-15T12:33:00.000Z",
      leaseExpiresAt: "2026-07-15T12:43:00.000Z",
      access: { rail: "circle_gateway_x402", price: "0.000001", status: "paid", txHash: "0x1" },
    })),
    store.transaction(async (tx) => tx.jobs.claimJob({
      jobId,
      agentId: `agent_b_${label}_c`,
      claimedAt: "2026-07-15T12:33:00.100Z",
      leaseExpiresAt: "2026-07-15T12:43:00.100Z",
      access: { rail: "circle_gateway_x402", price: "0.000001", status: "paid", txHash: "0x2" },
    })),
  ]);

  const fulfilled = attempts.filter((item) => item.status === "fulfilled");
  const rejected = attempts.filter((item) => item.status === "rejected");
  assert.equal(fulfilled.length, 1, `${label}: exactly one concurrent claim must win`);
  assert.equal(rejected.length, 1, `${label}: the losing claim must fail closed`);
  const winner = fulfilled[0].value.claimedBy;
  assert.ok([`agent_a_${label}_c`, `agent_b_${label}_c`].includes(winner));
  const job = await store.jobs.getJob(jobId);
  assert.equal(job.claimedBy, winner);
}

const sqlitePath = resolve("data/jobs-repository.sqlite");
const sqlite = await createStore({
  env: { DB_DIALECT: "sqlite", NODE_ENV: "test" },
  sqlite: { path: sqlitePath, reset: true },
});
try {
  await exerciseJobs(sqlite, "sqlite");
  await exerciseConcurrentClaims(sqlite, "sqlite");
} finally {
  await sqlite.close();
  const { cleanupDatabase } = await import("./test-helpers.mjs");
  cleanupDatabase(sqlitePath);
}

const connectionString = process.env["TEST_DATABASE_URL"] || "postgresql:///prooflet_test?host=%2Fvar%2Frun%2Fpostgresql";
const schema = `jobs_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const postgres = await createStore({
  env: { DATABASE_URL: connectionString, PGPOOL_MAX: "3" },
  schema,
  sharePool: false,
});
try {
  await exerciseJobs(postgres, "postgres");
  await exerciseConcurrentClaims(postgres, "postgres");
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
    "jobs repository creates open jobs under transactions",
    "claimJob is atomic and rejects second claimants",
    "concurrent claim races allow exactly one winner on sqlite and postgres",
  ],
}, null, 2));
