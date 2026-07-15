/**
 * Post-submission: issuer Circle wallet fund endpoint gates (no live Circle tx required).
 */
import assert from "node:assert/strict";
import { createApp } from "../server/api.mjs";
import { openDatabase } from "../server/db.mjs";
import { cleanupDatabase } from "./test-helpers.mjs";

process.env.ESCROW_V2_SKIP_ONCHAIN = "true";
process.env.ESCROW_V2_ADDRESS = process.env.ESCROW_V2_ADDRESS || "0x55bde7d3546f3e6e534a508a9b96d4e8d839eee9";

const path = `data/issuer-fund-${Date.now()}.sqlite`;
const db = openDatabase({ path, reset: true });
const { app } = createApp({ db, seedDemoData: false });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

async function req(method, route, body, apiKey) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

try {
  const issuer = await req("POST", "/issuers/register", { name: "Circle Fund Issuer" });
  assert.ok([200, 201].includes(issuer.status));
  const issuerId = issuer.data.issuer.issuerId;
  const issuerKey = issuer.data.apiKey;
  // Force no wallet for gate test (local register may or may not provision)
  await db.prepare("UPDATE issuers SET circle_wallet_id = NULL WHERE issuer_id = ?").run(issuerId);

  const jobId = `job_circle_fund_${Date.now().toString(36)}`;
  const created = await req("POST", "/jobs", {
    jobId,
    issuerId,
    jobType: "link_verification",
    input: { url: "https://example.com/circle-fund" },
    rewardAmount: "0.003",
    fundingStatus: "awaiting_wallet_funding",
    fundingRail: "arc_usdc_escrow_v2",
    status: "draft",
    proofRequirements: { requiredResultFields: ["status", "responseTimeMs", "contentHash"] },
  }, issuerKey);
  assert.equal(created.status, 201);

  const unauth = await req("POST", `/jobs/${jobId}/fund-from-circle-wallet`, { issuerId });
  assert.equal(unauth.status, 401);

  const missingWallet = await req("POST", `/jobs/${jobId}/fund-from-circle-wallet`, { issuerId }, issuerKey);
  assert.ok([400, 503].includes(missingWallet.status), JSON.stringify(missingWallet.data));
  assert.match(String(missingWallet.data.error || ""), /Circle wallet|not configured|Escrow V2/i);

  console.log(JSON.stringify({
    ok: true,
    postSubmission: true,
    checks: [
      "fund-from-circle-wallet requires issuer auth",
      "missing Circle wallet fails closed",
    ],
    jobId,
  }, null, 2));
} finally {
  await new Promise((r) => server.close(r));
  db.close();
  cleanupDatabase(path);
}
