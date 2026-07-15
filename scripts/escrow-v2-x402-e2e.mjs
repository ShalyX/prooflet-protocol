#!/usr/bin/env node
/**
 * Post-submission development — not part of the original Lepton Agents Hackathon submission.
 *
 * Full open-market loop on Arc Testnet + hosted API:
 *   draft → fundJob → fund-escrow verify → Circle Gateway x402 access → claim → proof → release
 *
 * Usage:
 *   USEFUL_WAITING_API_URL=https://prooflet-api.onrender.com \
 *   PRIVATE_KEY=0x... \
 *   npm run escrow:v2:x402-e2e
 *
 * Requires:
 *   - CIRCLE_GATEWAY_SELLER_ADDRESS ≠ payer (treasury/agent payout)
 *   - buyer Gateway USDC balance > 0 (or set GATEWAY_AUTO_DEPOSIT=0.01)
 *   - ESCROW_V2_ADDRESS configured on API + locally for operator CLI
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";

const api = (process.env.USEFUL_WAITING_API_URL || process.env.PROOFLET_API_URL || "https://prooflet-api.onrender.com").replace(/\/$/, "");
const pkRaw = process.env.PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY || process.env.GATEWAY_PRIVATE_KEY;
if (!pkRaw) throw new Error("PRIVATE_KEY / TREASURY_PRIVATE_KEY required");
const pk = pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`;
const treasury = privateKeyToAccount(pk).address;
const escrow = process.env.ESCROW_V2_ADDRESS || process.env.ESCROW_ADDRESS;
const usdc = process.env.USDC_ADDRESS || process.env.ARC_USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
const rpc = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const reward = process.env.REWARD_AMOUNT || "0.003";

function parseJsonObjects(text) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* ignore */ }
        start = -1;
      }
    }
  }
  return out;
}

async function req(method, route, body, apiKey) {
  const res = await fetch(`${api}${route}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(apiKey ? { authorization: `Bearer ${apiKey}`, "x-api-key": apiKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function runNode(args, extraEnv = {}) {
  return spawnSync(process.execPath, args, {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

const cfg = await req("GET", "/nanopayment/config");
if (cfg.data?.sellerAddress && cfg.data.sellerAddress.toLowerCase() === treasury.toLowerCase()) {
  throw new Error(`self_transfer risk: seller ${cfg.data.sellerAddress} equals payer ${treasury}. Set CIRCLE_GATEWAY_SELLER_ADDRESS.`);
}

const run = Date.now().toString(36);
const report = { ok: false, postSubmission: true, api, run, steps: [] };

const issuer = await req("POST", "/issuers/register", { name: `X402 E2E ${run}` });
if (![200, 201].includes(issuer.status)) throw new Error(`issuer register failed: ${issuer.status} ${JSON.stringify(issuer.data)}`);
const issuerId = issuer.data.issuer.issuerId;
const issuerKey = issuer.data.apiKey;
report.steps.push({ step: "issuer", ok: true, issuerId });

const jobId = `job_x402_e2e_${run}`;
const created = await req("POST", "/jobs", {
  jobId,
  issuerId,
  jobType: "link_verification",
  input: { url: `https://example.com/x402-e2e-${run}` },
  rewardAmount: reward,
  fundingStatus: "awaiting_wallet_funding",
  fundingRail: "arc_usdc_escrow_v2",
  status: "draft",
  proofRequirements: { requiredResultFields: ["status", "responseTimeMs", "contentHash"] },
}, issuerKey);
if (created.status !== 201) throw new Error(`job create failed: ${created.status} ${JSON.stringify(created.data)}`);
report.steps.push({ step: "draft", ok: true, jobId, reward });

if (!escrow) throw new Error("ESCROW_V2_ADDRESS required for on-chain fund/release");
const fund = runNode(
  ["workers/escrow-v2-operator.mjs", `--fund=${jobId}`, `--amount=${reward}`, "--expires-hours=48"],
  { SETTLEMENT_OPERATOR_PRIVATE_KEY: pk, ESCROW_V2_ADDRESS: escrow, USDC_ADDRESS: usdc, ARC_RPC_URL: rpc },
);
if (fund.status !== 0) throw new Error(`fundJob failed: ${fund.stdout || fund.stderr}`);
const fundJson = parseJsonObjects(fund.stdout).find((o) => o.action === "fund");
if (!fundJson?.txHash) throw new Error(`fundJob missing tx: ${fund.stdout.slice(0, 400)}`);
const fundApi = await req("POST", `/jobs/${jobId}/fund-escrow`, { issuerId, txHash: fundJson.txHash }, issuerKey);
if (fundApi.status !== 200) throw new Error(`fund-escrow failed: ${fundApi.status} ${JSON.stringify(fundApi.data)}`);
report.steps.push({
  step: "funded",
  ok: true,
  verifiedOnchain: !!fundApi.data.escrow?.verifiedOnchain,
  fundTx: fundJson.txHash,
  explorer: fundJson.explorer,
});

const agentId = `agent_x402_e2e_${run}`;
const agent = await req("POST", "/agents/register", {
  agentId,
  name: "X402 E2E Agent",
  capabilities: ["link_verification"],
  payoutAddress: treasury,
});
if (![200, 201].includes(agent.status)) throw new Error(`agent register failed: ${agent.status} ${JSON.stringify(agent.data)}`);
const agentKey = agent.data.apiKey;
report.steps.push({ step: "agent", ok: true, agentId });

const payArgs = [
  "--no-warnings",
  "scripts/pay-job-access.mjs",
  `--api-url=${api}`,
  `--job-id=${jobId}`,
  `--agent-id=${agentId}`,
  `--private-key=${pk}`,
];
if (process.env.GATEWAY_AUTO_DEPOSIT) payArgs.push(`--auto-deposit=${process.env.GATEWAY_AUTO_DEPOSIT}`);
const pay = runNode(payArgs);
if (pay.status !== 0) throw new Error(`x402 pay failed: ${pay.stdout || pay.stderr}`);
const payJson = parseJsonObjects(pay.stdout).find((o) => o.ok) || parseJsonObjects(pay.stdout).at(-1);
if (!payJson?.ok) throw new Error(`x402 pay not ok: ${pay.stdout}`);
report.steps.push({
  step: "x402_access",
  ok: true,
  rail: payJson.data?.payment?.rail || "circle_gateway_x402",
  buyer: payJson.buyer,
  seller: payJson.seller,
  httpStatus: payJson.status,
});

const claim = await req("POST", `/agents/${agentId}/claim-job`, { jobId, leaseSeconds: 180 }, agentKey);
if (claim.status !== 200) throw new Error(`claim failed: ${claim.status} ${JSON.stringify(claim.data)}`);
report.steps.push({ step: "claimed", ok: true });

const contentHash = `0x${createHash("sha256").update(`x402-e2e-${run}`).digest("hex").slice(0, 16)}`;
const proofId = `proof_${jobId}`;
const submitted = await req("POST", `/jobs/${jobId}/proof`, {
  proofId,
  agentId,
  jobId,
  jobType: "link_verification",
  input: { url: `https://example.com/x402-e2e-${run}` },
  result: { status: 200, responseTimeMs: 30, contentHash },
  verificationRoute: "link_verification_v0",
  proofTimestamp: new Date().toISOString(),
}, agentKey);
if (![200, 201].includes(submitted.status)) throw new Error(`proof failed: ${submitted.status} ${JSON.stringify(submitted.data)}`);
report.steps.push({
  step: "proof",
  ok: true,
  proofId,
  fundingStatus: submitted.data.proof?.fundingStatus,
  outcome: submitted.data.proof?.outcome,
});

const release = runNode(
  ["workers/escrow-v2-operator.mjs", `--release=${jobId}`, `--agent=${treasury}`, `--proof=${proofId}`, `--amount=${reward}`],
  {
    SETTLEMENT_OPERATOR_PRIVATE_KEY: pk,
    ESCROW_V2_ADDRESS: escrow,
    USDC_ADDRESS: usdc,
    ARC_RPC_URL: rpc,
    PROOFLET_API_URL: api,
  },
);
if (release.status !== 0) throw new Error(`release failed: ${release.stdout || release.stderr}`);
const relJson = parseJsonObjects(release.stdout).find((o) => o.action === "release");
if (!relJson?.txHash) throw new Error(`release missing tx: ${release.stdout.slice(0, 400)}`);
const rec = await req("POST", `/jobs/${jobId}/escrow-release-receipt`, { txHash: relJson.txHash, agentAddress: treasury });
report.steps.push({
  step: "released",
  ok: true,
  releaseTx: relJson.txHash,
  explorer: relJson.explorer,
  escrowStatus: rec.data.job?.escrowStatus,
  receiptStatus: rec.status,
});

report.ok = true;
report.flow = "draft→fundJob→fund-escrow→x402 gateway→claim→proof→release";
report.jobId = jobId;
report.agentId = agentId;
console.log(JSON.stringify(report, null, 2));
