/**
 * Prooflet — Link Sentinel: Autonomous link-verification worker
 *
 * Claims jobs ranked by reward ÷ estimated effort (Agentic Sophistication).
 * Supports multi-capability filtering and reputation-aware job selection.
 */
import { createHash, randomUUID } from "node:crypto";
import { AgentClient, UsefulWaitingApiError } from "@useful-waiting/agent-sdk";

const flags = parseArgs(process.argv.slice(2));
const config = {
  apiUrl: (flags.apiUrl || process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, ""),
  agentId: flags.agentId || process.env.AGENT_ID || "agent_lynx",
  apiKey: flags.agentApiKey || "uwp_agent_lynx_dev",
  capabilities: parseCapabilities(flags.capabilities || process.env.WORKER_CAPABILITIES || "link_verification"),
  pollIntervalMs: positiveInteger(flags.pollIntervalMs || process.env.POLL_INTERVAL_MS, 5000),
  fetchTimeoutMs: positiveInteger(flags.fetchTimeoutMs || process.env.WORKER_FETCH_TIMEOUT_MS, 20000),
  strategy: flags.strategy || process.env.CLAIM_STRATEGY || "best_value", // best_value | first_match
  once: flags.once,
  checkOnly: flags.check,
};
const client = new AgentClient({ agentId: config.agentId, apiKey: config.apiKey, baseUrl: config.apiUrl, timeoutMs: config.fetchTimeoutMs });

await assertHealthy();
const agent = await validateAgent();
log("agent ready", {
  agentId: agent.agentId,
  capabilities: config.capabilities,
  payoutAddress: agent.payoutAddress,
  strategy: config.strategy,
});

if (config.checkOnly) {
  log("worker check passed", { apiUrl: config.apiUrl, agentId: config.agentId });
} else {
  await pollForever();
}

async function pollForever() {
  let emptyPolls = 0;
  while (true) {
    try {
      const claim = config.strategy === "best_value" ? await rankAndClaim() : await claimFirst();
      if (!claim) {
        emptyPolls += 1;
        const waitMs = Math.min(config.pollIntervalMs * 2 ** Math.min(emptyPolls - 1, 4), 60000);
        log("no eligible job", { backoffMs: waitMs, strategy: config.strategy });
        if (config.once) return;
        await sleep(waitMs);
        continue;
      }

      emptyPolls = 0;
      log("claimed job", {
        jobId: claim.jobId,
        jobType: claim.jobType,
        reward: `${claim.rewardAmount} ${claim.rewardAsset}`,
        leaseExpiresAt: claim.leaseExpiresAt,
        strategy: config.strategy,
      });

      const taskResult = await performJob(claim);
      log("task result", { jobId: claim.jobId, ...taskResult });
      const proof = buildProof(claim, taskResult);
      log("proof created", { jobId: claim.jobId, proofId: proof.proofId });
      const verification = await submitProof(claim.jobId, proof);
      log("verification result", {
        proofId: verification.proofId,
        outcome: verification.outcome,
        verificationRoute: verification.verificationRoute,
        rejectionReason: verification.rejectionReason,
        fundingStatus: verification.fundingStatus,
        settlementStatus: verification.settlementStatus,
      });
      if (config.once) return;
    } catch (error) {
      const graceful = error instanceof UsefulWaitingApiError && [404, 409, 422].includes(error.status);
      log(graceful ? "job cycle ended" : "worker error", {
        status: error.status,
        error: error.message,
      });
      if (config.once && !graceful) throw error;
      if (config.once) return;
      await sleep(config.pollIntervalMs);
    }
  }
}

/**
 * Decision-making: rank all available jobs by value (reward ÷ effort)
 * Higher reward, lower expected effort = better score.
 * Reputation also gates access (high rep agents can take high-value jobs).
 */
async function rankAndClaim() {
  // Fetch all open jobs
  const res = await fetch(`${config.apiUrl}/jobs`);
  if (!res.ok) throw new Error(`Failed to list jobs: ${res.status}`);
  const { jobs: allJobs } = await res.json();

  // Filter to open jobs matching our capabilities
  const openJobs = (allJobs || []).filter(
    (j) => j.status === "open" && config.capabilities.includes(j.jobType)
  );
  if (openJobs.length === 0) return null;

  // Fetch reputation
  let reputation = { score: 50, tier: "starter" };
  try {
    const repRes = await fetch(`${config.apiUrl}/agents/${config.agentId}/reputation`, {
      headers: { "x-api-key": config.apiKey },
    });
    if (repRes.ok) reputation = (await repRes.json()).reputation;
  } catch { /* ok */ }

  // Score each job
  const EST = { link_verification: 22, freshness_check: 18, context_compress: 35, label: 26 };
  const scored = openJobs.map((job) => {
    const effort = EST[job.jobType] || 30;
    const reward = Number(job.rewardAmount) || 0;
    const penalty = job.requiredAccessLevel === "trusted" && reputation.tier !== "trusted" ? 0.5 : 1;
    return { job, score: (effort > 0 ? reward / effort : 0) * penalty };
  });
  scored.sort((a, b) => b.score - a.score);

  // Try in order, skip ineligible
  for (const candidate of scored) {
    log("attempting claim", { jobId: candidate.job.jobId, jobType: candidate.job.jobType, score: candidate.score.toFixed(6) });
    try {
      const claimed = await client.claimJob({
        jobId: candidate.job.jobId,
        leaseSeconds: Math.max(60, Math.ceil(config.fetchTimeoutMs / 1000) + 20),
      });
      if (claimed) return claimed;
    } catch (error) {
      if (error instanceof UsefulWaitingApiError && error.status === 409) {
        log("skipped ineligible job", { jobId: candidate.job.jobId, reason: error.message });
        continue;
      }
      throw error;
    }
  }
  log("all ranked jobs exhausted", { candidates: scored.length });
  return null;
}

/** Fallback: claim first available (original behavior) */
async function claimFirst() {
  return client.claimJob({ leaseSeconds: Math.max(60, Math.ceil(config.fetchTimeoutMs / 1000) + 20) });
}

async function assertHealthy() {
  const body = await client.health();
  const acceptedProtocols = new Set(["Prooflet", "Useful Waiting Protocol"]);
  if (!body.ok || !acceptedProtocols.has(body.protocol)) throw new Error("Prooflet API health check failed.");
  log("api healthy", { apiUrl: config.apiUrl, version: body.version });
}

async function validateAgent() {
  const a = await client.getAgent();
  const missing = config.capabilities.filter((cap) => !a.capabilities.includes(cap));
  if (missing.length > 0) throw new Error(`Agent ${config.agentId} is not registered for: ${missing.join(", ")}.`);
  return a;
}

async function performJob(job) {
  if (job.jobType !== "link_verification") throw new Error(`Link Sentinel cannot perform ${job.jobType}.`);
  const url = job.input?.url;
  if (!isHttpUrl(url)) throw new Error(`Job ${job.jobId} contains an invalid HTTP URL.`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  const startedAt = performance.now();
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Useful-Waiting-Link-Sentinel/0.1" },
    });
    const responseTimeMs = Math.round(performance.now() - startedAt);
    const { contentHash, bodyBytes } = await hashResponseBody(response);
    return {
      status: response.status,
      responseTimeMs,
      contentHash,
      checkedAt,
      finalUrl: response.url,
      redirected: response.redirected,
      bodyBytes,
    };
  } catch (error) {
    const responseTimeMs = Math.round(performance.now() - startedAt);
    const message = error.name === "AbortError" ? "HTTP check timed out" : error.message;
    return {
      status: 599,
      responseTimeMs,
      contentHash: `0x${createHash("sha256").update(message).digest("hex")}`,
      checkedAt,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function hashResponseBody(response) {
  const hash = createHash("sha256");
  let bodyBytes = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bodyBytes += value.byteLength;
      hash.update(value);
    }
  }
  return { contentHash: `0x${hash.digest("hex")}`, bodyBytes };
}

function buildProof(job, result) {
  return {
    protocol: "Prooflet",
    proofId: `proof_${config.agentId}_${Date.now()}_${randomUUID().slice(0, 8)}`,
    agentId: config.agentId,
    jobId: job.jobId,
    jobType: job.jobType,
    input: job.input,
    result,
    verificationRoute: "link_verification_v0",
    reward: { amount: job.rewardAmount, asset: job.rewardAsset, network: job.network },
    proofTimestamp: new Date().toISOString(),
  };
}

async function submitProof(jobId, proof) {
  return client.submitProof(jobId, proof);
}

function parseCapabilities(value) {
  const caps = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (caps.length === 0) throw new Error("WORKER_CAPABILITIES must include at least one capability.");
  return [...new Set(caps)];
}

function parseArgs(args) {
  const parsed = { once: false, check: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--once") { parsed.once = true; continue; }
    if (arg === "--check") { parsed.check = true; continue; }
    const m = arg.match(/^--(api-url|agent-id|agent-api-key|capabilities|poll-interval-ms|fetch-timeout-ms|strategy)(?:=(.*))?$/);
    if (!m) throw new Error(`Unknown argument ${arg}.`);
    const v = m[2] ?? args[++i];
    if (!v || v.startsWith("--")) throw new Error(`--${m[1]} requires a value.`);
    parsed[m[1].replace(/-([a-z])/g, (_, l) => l.toUpperCase())] = v;
  }
  return parsed;
}

function positiveInteger(value, fallback) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function isHttpUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function log(event, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), worker: "link-sentinel-v0", event, ...details }));
}