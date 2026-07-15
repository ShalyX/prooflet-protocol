/**
 * Post-submission development — not part of the original Lepton Agents Hackathon submission.
 *
 * Acceptance: open-market Escrow V2 fund → access payment → claim → proof → payable.
 * Uses local API + reported fund receipt (ESCROW_V2_SKIP_ONCHAIN).
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createApp } from "../server/api.mjs";
import { openDatabase } from "../server/db.mjs";
import { jobIdToBytes32 } from "../server/escrow-v2.mjs";
import { grantJobAccess, cleanupDatabase } from "./test-helpers.mjs";

process.env.ESCROW_V2_SKIP_ONCHAIN = "true";
process.env.ESCROW_V2_ADDRESS = process.env.ESCROW_V2_ADDRESS || "0x55bde7d3546f3e6e534a508a9b96d4e8d839eee9";

const path = `data/v2-claim-proof-${Date.now()}.sqlite`;
const db = openDatabase({ path, reset: true });
const { app } = createApp({ db, seedDemoData: false });
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

function fakeTx() {
  return `0x${createHash("sha256").update(randomUUID()).digest("hex")}`;
}

async function req(method, route, body, apiKey) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

try {
  // 1) Issuer + draft V2 job
  const issuerReg = await req("POST", "/issuers/register", { name: "V2 Claim Proof Issuer" });
  assert.ok(issuerReg.status === 200 || issuerReg.status === 201, `issuer register ${issuerReg.status}`);
  const issuerId = issuerReg.data.issuer.issuerId;
  const issuerKey = issuerReg.data.apiKey;

  const jobId = `job_v2_claim_${Date.now().toString(36)}`;
  const created = await req("POST", "/jobs", {
    jobId,
    issuerId,
    jobType: "link_verification",
    input: { url: "https://example.com/v2-claim-proof" },
    rewardAmount: "0.003",
    fundingStatus: "awaiting_wallet_funding",
    fundingRail: "arc_usdc_escrow_v2",
    status: "draft",
    proofRequirements: { requiredResultFields: ["status", "responseTimeMs", "contentHash"] },
  }, issuerKey);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.job.fundingStatus, "awaiting_wallet_funding");

  // 2) Fund receipt (open marketplace; agent still unknown)
  const fundTx = fakeTx();
  const funded = await req("POST", `/jobs/${jobId}/fund-escrow`, {
    issuerId,
    txHash: fundTx,
  }, issuerKey);
  assert.equal(funded.status, 200, JSON.stringify(funded.data));
  assert.equal(funded.data.job.fundingStatus, "reserved");
  assert.equal(funded.data.job.status, "open");
  assert.equal(funded.data.job.fundingRail, "arc_usdc_escrow_v2");
  assert.equal(funded.data.escrow.jobIdBytes32, jobIdToBytes32(jobId));

  // 3) Claim blocked without access payment
  const agentId = `agent_v2_${Date.now().toString(36)}`;
  const agentReg = await req("POST", "/agents/register", {
    agentId,
    name: "V2 Claim Agent",
    capabilities: ["link_verification"],
    payoutAddress: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4",
  });
  assert.ok(agentReg.status === 200 || agentReg.status === 201, JSON.stringify(agentReg.data));
  const agentKey = agentReg.data.apiKey;

  const unpaid = await req("POST", `/agents/${agentId}/claim-job`, { jobId, leaseSeconds: 120 }, agentKey);
  assert.equal(unpaid.status, 402, `unpaid claim must be blocked with 402, got ${unpaid.status}: ${JSON.stringify(unpaid.data)}`);
  assert.equal(unpaid.data.code, "claim_access_payment_required");

  // 4) Access payment recorded (test-mode Gateway receipt)
  await grantJobAccess(db, jobId, agentId, {
    payerAddress: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4",
  });

  // 5) Claim succeeds
  const claim = await req("POST", `/agents/${agentId}/claim-job`, { jobId, leaseSeconds: 120 }, agentKey);
  assert.equal(claim.status, 200, JSON.stringify(claim.data));
  assert.equal(claim.data.jobId || claim.data.job?.jobId || jobId, jobId);
  assert.ok(["claimed", "open"].includes(claim.data.status || claim.data.job?.status || "claimed") || claim.data.leaseExpiresAt || claim.data.claimId || claim.data.job);

  const jobAfterClaim = await db.prepare("SELECT status, claimed_by FROM jobs WHERE job_id = ?").get(jobId);
  assert.equal(jobAfterClaim.status, "claimed");
  assert.equal(jobAfterClaim.claimed_by, agentId);

  // 6) Submit deterministic link proof → payable
  const contentHash = `0x${createHash("sha256").update("v2-claim-proof").digest("hex").slice(0, 16)}`;
  const proofId = `proof_${jobId}`;
  const proof = {
    proofId,
    agentId,
    jobId,
    jobType: "link_verification",
    input: { url: "https://example.com/v2-claim-proof" },
    result: { status: 200, responseTimeMs: 42, contentHash },
    verificationRoute: "link_verification_v0",
    proofTimestamp: new Date().toISOString(),
  };
  const submitted = await req("POST", `/jobs/${jobId}/proof`, proof, agentKey);
  assert.ok([200, 201].includes(submitted.status), JSON.stringify(submitted.data));
  assert.equal(submitted.data.fundingStatus || submitted.data.proof?.fundingStatus, "payable");
  assert.ok(
    (submitted.data.verificationStatus || submitted.data.proof?.verificationStatus || "accepted").includes("verif")
    || (submitted.data.outcome || submitted.data.proof?.outcome) === "accepted"
    || (submitted.data.proof?.verificationStatus === "deterministic_verified"),
  );

  // 7) Duplicate proof rejected
  const dup = await req("POST", `/jobs/${jobId}/proof`, proof, agentKey);
  assert.equal(dup.status, 409);

  console.log(JSON.stringify({
    ok: true,
    postSubmission: true,
    checks: [
      "V2 draft job created for external issuer",
      "fund receipt opens job without pre-assigned agent",
      "claim blocked without Circle Gateway access payment",
      "claim succeeds after access payment",
      "deterministic proof becomes payable",
      "duplicate proof rejected",
    ],
    jobId,
    agentId,
    fundTx,
    proofId,
    flow: "fund → access → claim → proof → payable",
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  cleanupDatabase(path);
}
