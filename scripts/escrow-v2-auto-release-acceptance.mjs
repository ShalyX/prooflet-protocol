/**
 * Post-submission: Escrow V2 payable queue + auto-release dry-run acceptance.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createApp } from "../server/api.mjs";
import { openDatabase } from "../server/db.mjs";
import { grantJobAccess, cleanupDatabase } from "./test-helpers.mjs";

process.env.ESCROW_V2_SKIP_ONCHAIN = "true";
process.env.ESCROW_V2_ADDRESS = process.env.ESCROW_V2_ADDRESS || "0x55bde7d3546f3e6e534a508a9b96d4e8d839eee9";
process.env.ESCROW_OPERATOR_API_KEY = process.env.ESCROW_OPERATOR_API_KEY || "uwp_operator_test_auto_release";
const OP_KEY = process.env.ESCROW_OPERATOR_API_KEY;

const path = `data/v2-auto-release-${Date.now()}.sqlite`;
const db = openDatabase({ path, reset: true });
const { app } = createApp({ db, seedDemoData: false });
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

async function req(method, route, body, apiKey) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

try {
  const denied = await req("GET", "/escrow/v2/payable");
  assert.equal(denied.status, 403);

  const empty = await req("GET", "/escrow/v2/payable", null, OP_KEY);
  assert.equal(empty.status, 200);
  assert.equal(empty.data.count, 0);

  const issuer = await req("POST", "/issuers/register", { name: "Auto Release Issuer" });
  const issuerId = issuer.data.issuer.issuerId;
  const issuerKey = issuer.data.apiKey;
  const jobId = `job_auto_${Date.now().toString(36)}`;
  await req("POST", "/jobs", {
    jobId,
    issuerId,
    jobType: "link_verification",
    input: { url: "https://example.com/auto-release" },
    rewardAmount: "0.003",
    fundingStatus: "awaiting_wallet_funding",
    fundingRail: "arc_usdc_escrow_v2",
    status: "draft",
    proofRequirements: { requiredResultFields: ["status", "responseTimeMs", "contentHash"] },
  }, issuerKey);
  const fundTx = `0x${createHash("sha256").update(randomUUID()).digest("hex")}`;
  await req("POST", `/jobs/${jobId}/fund-escrow`, { issuerId, txHash: fundTx }, issuerKey);

  const agentId = `agent_auto_${Date.now().toString(36)}`;
  const agent = await req("POST", "/agents/register", {
    agentId,
    name: "Auto Release Agent",
    capabilities: ["link_verification"],
    payoutAddress: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4",
  });
  const agentKey = agent.data.apiKey;
  await grantJobAccess(db, jobId, agentId, { payerAddress: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4" });
  await req("POST", `/agents/${agentId}/claim-job`, { jobId, leaseSeconds: 120 }, agentKey);

  const contentHash = `0x${createHash("sha256").update("auto").digest("hex").slice(0, 16)}`;
  const proofId = `proof_${jobId}`;
  const submitted = await req("POST", `/jobs/${jobId}/proof`, {
    proofId,
    agentId,
    jobId,
    jobType: "link_verification",
    input: { url: "https://example.com/auto-release" },
    result: { status: 200, responseTimeMs: 20, contentHash },
    verificationRoute: "link_verification_v0",
    proofTimestamp: new Date().toISOString(),
  }, agentKey);
  assert.ok([200, 201].includes(submitted.status), JSON.stringify(submitted.data));
  assert.equal(submitted.data.proof?.fundingStatus, "payable");

  const payable = await req("GET", "/escrow/v2/payable", null, OP_KEY);
  assert.equal(payable.status, 200);
  assert.ok(payable.data.count >= 1);
  const item = payable.data.items.find((row) => row.jobId === jobId);
  assert.ok(item, "payable queue includes job");
  assert.equal(item.proofId, proofId);
  assert.equal(item.ready, true);
  assert.equal(item.agentPayoutAddress.toLowerCase(), "0xc2094270dc7d17c1578a975dd1aa50578c034be4");

  // After marking released, item should leave the queue.
  await db.prepare("UPDATE jobs SET escrow_status='released' WHERE job_id=?").run(jobId);
  const after = await req("GET", "/escrow/v2/payable", null, OP_KEY);
  assert.equal(after.data.items.some((row) => row.jobId === jobId), false);

  console.log(JSON.stringify({
    ok: true,
    postSubmission: true,
    checks: [
      "payable queue empty initially",
      "payable after V2 fund→claim→proof",
      "ready includes agent payout",
      "released jobs leave payable queue",
    ],
    jobId,
    proofId,
  }, null, 2));
} finally {
  await new Promise((r) => server.close(r));
  db.close();
  cleanupDatabase(path);
}
