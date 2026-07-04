import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const testDb = resolve("data/useful-waiting.acceptance.sqlite");
for (const suffix of ["", "-shm", "-wal"]) {
  const path = `${testDb}${suffix}`;
  if (existsSync(path)) rmSync(path);
}
process.env.UWP_DB_PATH = testDb;

const { createApp } = await import("../server/api.mjs");
const { app, db } = createApp();
const server = app.listen(0, "127.0.0.1");
await new Promise((resolveReady) => server.once("listening", resolveReady));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  const dashboardBefore = await request("GET", "/dashboard");
  assert.equal(dashboardBefore.status, 200);
  assert.equal(dashboardBefore.body.proofs.filter((proof) => proof.fundingStatus === "paid").length, 3);

  const issuerRegistration = await request("POST", "/issuers/register", {
    issuerId: "acceptance_issuer",
    name: "Acceptance Issuer",
    treasuryAddress: "0x0000000000000000000000000000000000000011",
  });
  assert.equal(issuerRegistration.status, 201);
  assert.ok(issuerRegistration.body.walletProvisioning, "Registration should return a walletProvisioning object");
  assert.ok(issuerRegistration.body.walletProvisioning.status === "success" || issuerRegistration.body.walletProvisioning.status === "failed", "walletProvisioning should have a valid status");
  const issuerKey = issuerRegistration.body.apiKey;

  const generatedJob = await request("POST", "/jobs", {
    issuerId: "acceptance_issuer",
    issuerReferenceId: "ticket-104-generated-id",
    jobType: "link_verification",
    input: { url: "https://example.com/generated-job" },
    rewardAmount: "0.003",
    rewardAsset: "USDC",
    network: "Arc Testnet",
    fundingStatus: "reserved",
    status: "open",
    proofRequirements: { requiredResultFields: ["status", "responseTimeMs", "contentHash"] },
  }, issuerKey);
  assert.equal(generatedJob.status, 201);
  assert.match(generatedJob.body.job.jobId, /^job_[a-z0-9]{10}$/);
  assert.equal(generatedJob.body.job.issuerReferenceId, "ticket-104-generated-id");

  const agentRegistration = await request("POST", "/agents/register", {
    agentId: "acceptance_agent",
    name: "Acceptance Agent",
    capabilities: ["link_verification"],
    payoutAddress: "0x3333333333333333333333333333333333333333",
  });
  assert.equal(agentRegistration.status, 201);
  assert.equal(agentRegistration.body.agent.reputationScore, 50);
  const agentKey = agentRegistration.body.apiKey;

  const jobInput = { url: "https://example.com/useful-waiting" };
  const proofRequirements = { requiredResultFields: ["status", "responseTimeMs", "contentHash"] };
  for (const jobId of ["acceptance_link_1", "acceptance_link_2", "acceptance_lease"]) {
    const created = await request("POST", "/jobs", {
      jobId,
      issuerId: "acceptance_issuer",
      jobType: "link_verification",
      input: jobInput,
      rewardAmount: "0.003",
      rewardAsset: "USDC",
      network: "Arc Testnet",
      fundingStatus: "reserved",
      status: "open",
      proofRequirements,
    }, issuerKey);
    assert.equal(created.status, 201);
  }
  const freshness = await request("POST", "/jobs", {
    jobId: "acceptance_freshness",
    issuerId: "acceptance_issuer",
    jobType: "freshness_check",
    input: { sourceUrl: "https://example.com", maxAgeHours: 24 },
    rewardAmount: "0.002",
    proofRequirements: { requiredResultFields: ["lastModified", "stale"] },
  }, issuerKey);
  assert.equal(freshness.status, 201);

  const nonMatching = await request("POST", "/agents/acceptance_agent/claim-job", { jobId: "acceptance_freshness" }, agentKey);
  assert.equal(nonMatching.status, 409);

  const blockedWithoutAccess = await request("POST", "/agents/acceptance_agent/claim-job", { jobId: "acceptance_lease", leaseSeconds: 60 }, agentKey);
  assert.equal(blockedWithoutAccess.status, 402);
  assert.equal(blockedWithoutAccess.body.code, "claim_access_payment_required");
  assert.equal(blockedWithoutAccess.body.payment.rail, "circle_gateway_x402");
  const fallbackNoAuth = await request("POST", "/jobs/acceptance_lease/access-fee/verify", { agentId: "acceptance_agent", agentAddress: "0x3333333333333333333333333333333333333333" });
  assert.equal(fallbackNoAuth.status, 403);
  const fallbackWrongAddress = await request("POST", "/jobs/acceptance_lease/access-fee/verify", { agentId: "acceptance_agent", agentAddress: "0x4444444444444444444444444444444444444444" }, agentKey);
  assert.equal(fallbackWrongAddress.status, 403);
  grantAccess("acceptance_lease", "acceptance_agent");
  const leaseClaim = await request("POST", "/agents/acceptance_agent/claim-job", { jobId: "acceptance_lease", leaseSeconds: 60 }, agentKey);
  assert.equal(leaseClaim.status, 200);
  db.prepare("UPDATE job_claims SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE job_id = 'acceptance_lease'").run();
  db.prepare("UPDATE jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE job_id = 'acceptance_lease'").run();
  await request("GET", "/jobs");
  assert.equal(db.prepare("SELECT status FROM jobs WHERE job_id = 'acceptance_lease'").get().status, "open");

  grantAccess("acceptance_link_1", "acceptance_agent");
  const firstClaim = await request("POST", "/agents/acceptance_agent/claim-job", { jobId: "acceptance_link_1", leaseSeconds: 120 }, agentKey);
  assert.equal(firstClaim.status, 200);
  assert.equal(firstClaim.body.job.claimedBy, "acceptance_agent");
  assert.ok(Date.parse(firstClaim.body.job.leaseExpiresAt) > Date.now());

  const result = { status: 200, responseTimeMs: 83, contentHash: "0xabc123" };
  const accepted = await request("POST", "/jobs/acceptance_link_1/proof", {
    proofId: "acceptance_proof_1",
    agentId: "acceptance_agent",
    jobId: "acceptance_link_1",
    jobType: "link_verification",
    input: jobInput,
    result,
    verificationRoute: "link_verification_v0",
    proofTimestamp: new Date().toISOString(),
  }, agentKey);
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.proof.fundingStatus, "payable");

  grantAccess("acceptance_link_2", "acceptance_agent");
  const secondClaim = await request("POST", "/agents/acceptance_agent/claim-job", { jobId: "acceptance_link_2" }, agentKey);
  assert.equal(secondClaim.status, 200);
  const duplicate = await request("POST", "/jobs/acceptance_link_2/proof", {
    proofId: "acceptance_proof_duplicate",
    agentId: "acceptance_agent",
    jobId: "acceptance_link_2",
    jobType: "link_verification",
    input: jobInput,
    result,
    verificationRoute: "link_verification_v0",
    proofTimestamp: new Date().toISOString(),
  }, agentKey);
  assert.equal(duplicate.status, 422);
  assert.equal(duplicate.body.proof.fundingStatus, "rejected");

  const exported = await request("POST", "/settlement-batches/export", { issuerId: "acceptance_issuer", batchId: "acceptance_batch_001" }, issuerKey);
  assert.equal(exported.status, 201);
  assert.equal(exported.body.batch.approvedProofs, 1);
  assert.equal(exported.body.batch.proofs[0].proofId, "acceptance_proof_1");
  assert.equal(exported.body.batch.recipients[0].payoutAddress, "0x3333333333333333333333333333333333333333");
  assert.ok(!exported.body.batch.proofs.some((proof) => proof.proofId === "acceptance_proof_duplicate"));

  const receipt = await request("POST", "/settlement-batches/acceptance_batch_001/receipt", {
    issuerId: "acceptance_issuer",
    transactions: [{
      agentId: "acceptance_agent",
      to: "0x3333333333333333333333333333333333333333",
      amount: "0.003",
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      explorer: "https://testnet.arcscan.app/tx/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      blockNumber: "123",
      status: "success",
    }],
  }, issuerKey);
  assert.equal(receipt.status, 201);
  assert.equal(receipt.body.status, "settled");
  assert.equal(db.prepare("SELECT funding_status FROM proofs WHERE proof_id='acceptance_proof_1'").get().funding_status, "paid");
  const duplicateReceipt = await request("POST", "/settlement-batches/acceptance_batch_001/receipt", {
    issuerId: "acceptance_issuer",
    transactions: receipt.body.transactions,
  }, issuerKey);
  assert.equal(duplicateReceipt.status, 409);

  const paidProofs = db.prepare("SELECT COUNT(*) AS count FROM proofs WHERE funding_status = 'paid'").get().count;
  assert.equal(paidProofs, 4);
  console.log(JSON.stringify({
    ok: true,
    checks: [
      "agent and issuer registration",
      "authenticated job creation",
      "capability-gated claim rejection",
      "Circle Gateway x402 access fee blocks unpaid claims",
      "fallback access verifier requires agent auth and registered payout address",
      "stored paid access lease",
      "expired lease reopens job",
      "deterministic proof approval",
      "duplicate proof rejection",
      "rejected proof settlement exclusion",
      "remote settlement receipt marks payable proof paid",
      "duplicate remote settlement receipt rejected",
      "historical paid proofs remain paid",
    ],
  }, null, 2));
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  db.close();
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${testDb}${suffix}`;
    if (existsSync(path)) rmSync(path);
  }
}

async function request(method, path, body, apiKey) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

function grantAccess(jobId, agentId) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO job_access_payments
      (job_id, agent_id, rail, amount, payer_address, tx_hash, gateway_transaction_id, network, status, metadata_json, created_at, updated_at)
    VALUES (?, ?, 'circle_gateway_x402', '0.000001', '0x3333333333333333333333333333333333333333', NULL, ?, 'eip155:5042002', 'paid', '{}', ?, ?)
    ON CONFLICT(job_id, agent_id) DO UPDATE SET status='paid', updated_at=excluded.updated_at
  `).run(jobId, agentId, `test-gateway-${jobId}-${agentId}`, now, now);
}
