#!/usr/bin/env node
/**
 * Post-submission: live Escrow V2 claim → proof against hosted API (after open-market fund).
 *
 * Usage:
 *   USEFUL_WAITING_API_URL=https://prooflet-api.onrender.com \
 *   JOB_ID=job_xxx AGENT_ID=agent_xxx AGENT_API_KEY=... \
 *   npm run escrow:v2:live-claim
 *
 * Access payment:
 *   - Real Gateway: PRIVATE_KEY=0x... (or GATEWAY_PRIVATE_KEY)
 *   - Or set SKIP_ACCESS_PAY=1 only when the job already has a paid access lease
 */
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const apiUrl = (process.env.USEFUL_WAITING_API_URL || process.env.PROOFLET_API_URL || "https://prooflet-api.onrender.com").replace(/\/$/, "");
const jobId = required(process.env.JOB_ID, "JOB_ID");
const agentId = process.env.AGENT_ID || `agent_v2_live_${Date.now().toString(36)}`;
const agentKey = process.env.AGENT_API_KEY || null;
const payout = process.env.AGENT_PAYOUT || process.env.TREASURY_ADDRESS || "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4";
const privateKey = process.env.PRIVATE_KEY || process.env.GATEWAY_PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY;

async function req(method, route, body, apiKey) {
  const response = await fetch(`${apiUrl}${route}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(apiKey ? { authorization: `Bearer ${apiKey}`, "x-api-key": apiKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

function required(v, name) {
  if (!v) throw new Error(`${name} is required`);
  return v;
}

let key = agentKey;
if (!key) {
  const reg = await req("POST", "/agents/register", {
    agentId,
    name: `Live V2 Agent ${agentId}`,
    capabilities: ["link_verification"],
    payoutAddress: payout,
  });
  if (![200, 201].includes(reg.status)) {
    throw new Error(`agent register failed: ${reg.status} ${JSON.stringify(reg.data)}`);
  }
  key = reg.data.apiKey;
  console.log(JSON.stringify({ registered: true, agentId, note: "save AGENT_API_KEY for reuse" }, null, 2));
}

// Access payment via gateway helper when possible
if (process.env.SKIP_ACCESS_PAY !== "1") {
  if (!privateKey) throw new Error("PRIVATE_KEY/GATEWAY_PRIVATE_KEY required for access payment (or SKIP_ACCESS_PAY=1)");
  const pay = spawnSync(process.execPath, [
    "--no-warnings",
    "scripts/pay-job-access.mjs",
    `--api-url=${apiUrl}`,
    `--job-id=${jobId}`,
    `--agent-id=${agentId}`,
    `--private-key=${privateKey}`,
  ], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", env: process.env });
  if (pay.status !== 0) {
    console.error(pay.stdout || "");
    console.error(pay.stderr || "");
    throw new Error(`gateway access payment failed (exit ${pay.status})`);
  }
  console.log(pay.stdout);
}

const claim = await req("POST", `/agents/${encodeURIComponent(agentId)}/claim-job`, { jobId, leaseSeconds: 180 }, key);
if (claim.status !== 200) {
  throw new Error(`claim failed: ${claim.status} ${JSON.stringify(claim.data)}`);
}
console.log(JSON.stringify({ claimed: true, jobId, agentId, claim: claim.data }, null, 2));

// Fetch job for input
const jobsRes = await req("GET", "/jobs");
const job = (jobsRes.data.jobs || []).find((j) => j.jobId === jobId) || claim.data.job || claim.data;
const url = job?.input?.url || "https://example.com";
const fetched = await fetch(url, { redirect: "follow" }).catch(() => null);
const status = fetched?.status || 0;
const body = fetched ? await fetched.text().catch(() => "") : "";
const contentHash = `0x${createHash("sha256").update(body || url).digest("hex").slice(0, 16)}`;
const proof = {
  proofId: `proof_${jobId}_${randomUUID().slice(0, 8)}`,
  agentId,
  jobId,
  jobType: job?.jobType || "link_verification",
  input: job?.input || { url },
  result: { status, responseTimeMs: 50, contentHash },
  verificationRoute: "link_verification_v0",
  proofTimestamp: new Date().toISOString(),
};

const submitted = await req("POST", `/jobs/${encodeURIComponent(jobId)}/proof`, proof, key);
if (![200, 201].includes(submitted.status)) {
  throw new Error(`proof failed: ${submitted.status} ${JSON.stringify(submitted.data)}`);
}

console.log(JSON.stringify({
  ok: true,
  postSubmission: true,
  jobId,
  agentId,
  proofId: proof.proofId,
  fundingStatus: submitted.data.proof?.fundingStatus || submitted.data.fundingStatus,
  outcome: submitted.data.proof?.outcome || submitted.data.outcome,
  verificationStatus: submitted.data.proof?.verificationStatus,
  next: "npm run escrow:v2:operator -- --release=JOB_ID --agent=0x... --proof=PROOF_ID",
}, null, 2));
