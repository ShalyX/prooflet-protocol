#!/usr/bin/env node
/**
 * Post-submission: Escrow V2 + LLM analyst full loop on hosted API.
 * draft → fundJob → fund-escrow → x402 → LLM claim/proof → operator release
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

const api = (process.env.USEFUL_WAITING_API_URL || process.env.PROOFLET_API_URL || "https://prooflet-api.onrender.com").replace(/\/$/, "");
const pkRaw = process.env.PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY || process.env.GATEWAY_PRIVATE_KEY;
if (!pkRaw) throw new Error("PRIVATE_KEY / TREASURY_PRIVATE_KEY required");
const pk = pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`;
const treasury = privateKeyToAccount(pk).address;
const escrow = process.env.ESCROW_V2_ADDRESS || process.env.ESCROW_ADDRESS;
const usdc = process.env.USDC_ADDRESS || process.env.ARC_USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
const rpc = process.env.ARC_RPC_URL || "https://arc-testnet.drpc.org";
const reward = process.env.REWARD_AMOUNT || "0.003";
const llmKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
if (!llmKey) throw new Error("LLM_API_KEY / OPENROUTER_API_KEY required");
if (!escrow) throw new Error("ESCROW_V2_ADDRESS required");

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
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* ignore */
        }
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
    timeout: 240_000,
  });
}

const run = Date.now().toString(36);
const report = { ok: false, postSubmission: true, api, run, steps: [] };

const cfg = await req("GET", "/nanopayment/config");
if (cfg.data?.sellerAddress && cfg.data.sellerAddress.toLowerCase() === treasury.toLowerCase()) {
  throw new Error(`self_transfer risk: seller equals payer ${treasury}`);
}

const issuer = await req("POST", "/issuers/register", { name: `LLM Escrow ${run}` });
if (![200, 201].includes(issuer.status)) throw new Error(`issuer: ${issuer.status} ${JSON.stringify(issuer.data)}`);
const issuerId = issuer.data.issuer.issuerId;
const issuerKey = issuer.data.apiKey;
report.steps.push({ step: "issuer", ok: true, issuerId });

const sourceText = [
  "Prooflet funds agent micro-work on Arc Testnet USDC via Escrow V2.",
  "Issuers fund jobs before agents are known. Agents pay Circle Gateway x402,",
  "LLM analysts estimate cost versus reward, claim only profitable work, and submit structured proofs.",
  "Operators release approved rewards with a signed Escrow V2 transaction.",
].join(" ");

const jobId = `job_llm_escrow_${run}`;
const created = await req(
  "POST",
  "/jobs",
  {
    jobId,
    issuerId,
    jobType: "content_summary",
    input: { title: "Escrow+LLM e2e", sourceText, url: "https://www.prooflet.xyz" },
    rewardAmount: reward,
    fundingStatus: "awaiting_wallet_funding",
    fundingRail: "arc_usdc_escrow_v2",
    status: "draft",
    verificationMode: "deterministic",
    proofRequirements: {
      requiredResultFields: ["summary", "model", "confidence", "tokenUsage", "contentHash"],
    },
  },
  issuerKey,
);
if (created.status !== 201) throw new Error(`job create: ${created.status} ${JSON.stringify(created.data)}`);
report.steps.push({ step: "draft", ok: true, jobId, reward });

const fund = runNode(
  ["--no-warnings", "workers/escrow-v2-operator.mjs", `--fund=${jobId}`, `--amount=${reward}`, "--expires-hours=48"],
  {
    SETTLEMENT_OPERATOR_PRIVATE_KEY: pk,
    ESCROW_OPERATOR_PRIVATE_KEY: pk,
    ESCROW_V2_ADDRESS: escrow,
    USDC_ADDRESS: usdc,
    ARC_RPC_URL: rpc,
  },
);
if (fund.status !== 0) throw new Error(`fundJob failed: ${fund.stdout || fund.stderr}`);
const fundJson = parseJsonObjects(fund.stdout).find((o) => o.action === "fund" || o.txHash);
if (!fundJson?.txHash) throw new Error(`fundJob missing tx: ${fund.stdout.slice(0, 400)}`);
const fundApi = await req("POST", `/jobs/${jobId}/fund-escrow`, { issuerId, txHash: fundJson.txHash }, issuerKey);
if (fundApi.status !== 200) throw new Error(`fund-escrow: ${fundApi.status} ${JSON.stringify(fundApi.data)}`);
report.steps.push({
  step: "funded",
  ok: true,
  fundTx: fundJson.txHash,
  verifiedOnchain: !!fundApi.data.escrow?.verifiedOnchain,
  explorer: fundJson.explorer,
});

const agentId = `agent_llm_escrow_${run}`;
const agent = await req("POST", "/agents/register", {
  agentId,
  name: "LLM Escrow Agent",
  capabilities: ["content_summary"],
  payoutAddress: treasury,
});
if (![200, 201].includes(agent.status)) throw new Error(`agent: ${agent.status} ${JSON.stringify(agent.data)}`);
const agentKey = agent.data.apiKey;
report.steps.push({ step: "agent", ok: true, agentId });

const access = runNode(
  ["--no-warnings", "scripts/pay-job-access.mjs", "--job-id", jobId, "--agent-id", agentId, "--private-key", pk],
  { USEFUL_WAITING_API_URL: api, ARC_RPC_URL: rpc },
);
if (access.status !== 0) throw new Error(`x402 failed: ${access.stdout || access.stderr}`);
const accessJson = parseJsonObjects(access.stdout).at(-1) || {};
report.steps.push({ step: "x402", ok: true, transaction: accessJson.transaction || accessJson.payment?.transaction });

const llm = runNode(["--no-warnings", "workers/llm-analyst.mjs", "--once"], {
  USEFUL_WAITING_API_URL: api,
  AGENT_ID: agentId,
  AGENT_API_KEY: agentKey,
  LLM_API_KEY: llmKey,
  LLM_BASE_URL: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
  LLM_MODEL: process.env.LLM_MODEL || "openai/gpt-4o-mini",
  WORKER_CAPABILITIES: "content_summary",
  PRIVATE_KEY: "",
});
const llmEvents = parseJsonObjects(llm.stdout);
const verification = llmEvents.find((e) => e.event === "verification");
const claimed = llmEvents.find((e) => e.event === "claimed");
report.steps.push({ step: "llm", claimed, verification });
if (!verification || verification.outcome !== "accepted") {
  throw new Error(`LLM not accepted: ${JSON.stringify(verification || llmEvents.slice(-5))} ${llm.stderr?.slice(0, 300)}`);
}
const proofId = verification.proofId;

const release = runNode(
  [
    "--no-warnings",
    "workers/escrow-v2-operator.mjs",
    `--release=${jobId}`,
    `--agent=${treasury}`,
    `--proof=${proofId}`,
    `--amount=${reward}`,
  ],
  {
    SETTLEMENT_OPERATOR_PRIVATE_KEY: pk,
    ESCROW_OPERATOR_PRIVATE_KEY: pk,
    ESCROW_V2_ADDRESS: escrow,
    USDC_ADDRESS: usdc,
    ARC_RPC_URL: rpc,
  },
);
if (release.status !== 0) throw new Error(`release failed: ${release.stdout || release.stderr}`);
const relJson = parseJsonObjects(release.stdout).find((o) => o.action === "release" || o.txHash);
if (!relJson?.txHash) throw new Error(`release missing tx: ${release.stdout.slice(0, 400)}`);
const rec = await req("POST", `/jobs/${jobId}/escrow-release-receipt`, {
  txHash: relJson.txHash,
  agentAddress: treasury,
});
report.steps.push({
  step: "released",
  ok: true,
  releaseTx: relJson.txHash,
  explorer: relJson.explorer,
  receiptStatus: rec.status,
  jobEscrow: rec.data?.job?.escrowStatus,
});

report.ok = true;
report.summary = {
  jobId,
  proofId,
  fundTx: fundJson.txHash,
  releaseTx: relJson.txHash,
  x402: accessJson.transaction || accessJson.payment?.transaction,
  llmOutcome: verification.outcome,
  fundingStatus: verification.fundingStatus,
  model: process.env.LLM_MODEL || "openai/gpt-4o-mini",
};
writeFileSync("/tmp/escrow-llm-e2e.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
