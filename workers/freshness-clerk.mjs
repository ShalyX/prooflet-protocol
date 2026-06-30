/**
 * Prooflet — Freshness Clerk: Autonomous freshness-check worker.
 *
 * Checks if URLs return recent content (Last-Modified, cache freshness).
 * Competes with Link Sentinel for freshness_check jobs.
 * Agentic: ranks jobs by reward/effort like Link Sentinel.
 */
import { createHash, randomUUID } from "node:crypto";
import { AgentClient, UsefulWaitingApiError } from "@useful-waiting/agent-sdk";

const flags = parseArgs(process.argv.slice(2));
const config = {
  apiUrl: (flags.apiUrl || process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, ""),
  agentId: flags.agentId || process.env.AGENT_ID || "agent_mira",
  apiKey: flags.agentApiKey || process.env["AGENT_API_KEY"] || "uwp_agent_mira_dev",
  capabilities: parseCapabilities(flags.capabilities || process.env.WORKER_CAPABILITIES || "freshness_check"),
  pollIntervalMs: positiveInteger(flags.pollIntervalMs || process.env.POLL_INTERVAL_MS, 5000),
  fetchTimeoutMs: positiveInteger(flags.fetchTimeoutMs || process.env.WORKER_FETCH_TIMEOUT_MS, 20000),
  strategy: flags.strategy || process.env.CLAIM_STRATEGY || "best_value",
  once: flags.once,
  checkOnly: flags.check,
};
const client = new AgentClient({ agentId: config.agentId, apiKey: config.apiKey, baseUrl: config.apiUrl, timeoutMs: config.fetchTimeoutMs });

await assertHealthy();
const agent = await validateAgent();
log("agent ready", { agentId: config.agentId, capabilities: config.capabilities, payoutAddress: agent.payoutAddress });

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
        log("no eligible job", { backoffMs: waitMs });
        if (config.once) return;
        await sleep(waitMs);
        continue;
      }
      emptyPolls = 0;
      log("claimed job", { jobId: claim.jobId, jobType: claim.jobType, reward: `${claim.rewardAmount} ${claim.rewardAsset}`, leaseExpiresAt: claim.leaseExpiresAt });
      const taskResult = await performJob(claim);
      log("task result", { jobId: claim.jobId, ...taskResult });
      const proof = buildProof(claim, taskResult);
      log("proof created", { jobId: claim.jobId, proofId: proof.proofId });
      const verification = await submitProof(claim.jobId, proof);
      log("verification result", { proofId: verification.proofId, outcome: verification.outcome, fundingStatus: verification.fundingStatus });
      if (config.once) return;
    } catch (error) {
      const graceful = error instanceof UsefulWaitingApiError && [404, 409, 422].includes(error.status);
      log(graceful ? "job cycle ended" : "worker error", { status: error.status, error: error.message });
      if (config.once && !graceful) throw error;
      if (config.once) return;
      await sleep(config.pollIntervalMs);
    }
  }
}

/** Rank available jobs by value (reward ÷ effort) and claim the best */
async function rankAndClaim() {
  const res = await fetch(`${config.apiUrl}/jobs`);
  if (!res.ok) throw new Error(`Failed to list jobs: ${res.status}`);
  const { jobs: allJobs } = await res.json();
  const open = (allJobs || []).filter((j) => j.status === "open" && config.capabilities.includes(j.jobType));
  if (open.length === 0) return null;

  let reputation = { score: 50, tier: "starter" };
  try {
    const r = await fetch(`${config.apiUrl}/agents/${config.agentId}/reputation`, {
      headers: { "x-api-key": config.apiKey },
    });
    if (r.ok) reputation = (await r.json()).reputation;
  } catch { /* ok */ }

  const EST = { link_verification: 22, freshness_check: 15, context_compress: 35, label: 26 };
  const scored = open.map((j) => {
    const effort = EST[j.jobType] || 30;
    const reward = Number(j.rewardAmount) || 0;
    const penalty = j.requiredAccessLevel === "trusted" && reputation.tier !== "trusted" ? 0.5 : 1;
    return { job: j, score: (effort > 0 ? reward / effort : 0) * penalty };
  });
  scored.sort((a, b) => b.score - a.score);
  for (const c of scored) {
    try {
      const claimed = await client.claimJob({ jobId: c.job.jobId, leaseSeconds: Math.max(60, Math.ceil(config.fetchTimeoutMs / 1000) + 20) });
      if (claimed) return claimed;
    } catch (e) {
      if (e instanceof UsefulWaitingApiError && e.status === 409) continue;
      throw e;
    }
  }
  return null;
}

async function claimFirst() {
  return client.claimJob({ leaseSeconds: Math.max(60, Math.ceil(config.fetchTimeoutMs / 1000) + 20) });
}

async function assertHealthy() {
  const body = await client.health();
  if (!body.ok || !new Set(["Prooflet", "Useful Waiting Protocol"]).has(body.protocol)) throw new Error("Prooflet API health check failed.");
  log("api healthy", { apiUrl: config.apiUrl, version: body.version });
}

async function validateAgent() {
  const a = await client.getAgent();
  const missing = config.capabilities.filter((c) => !a.capabilities.includes(c));
  if (missing.length) throw new Error(`Agent ${config.agentId} is not registered for: ${missing.join(", ")}.`);
  return a;
}

async function performJob(job) {
  if (job.jobType !== "freshness_check") throw new Error(`Freshness Clerk cannot perform ${job.jobType}.`);
  const url = job.input?.url || job.input?.sourceUrl;
  if (!isHttpUrl(url)) throw new Error(`Job ${job.jobId} contains an invalid HTTP URL.`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  const startedAt = performance.now();
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Useful-Waiting-Freshness-Clerk/0.1" },
    });
    const responseTimeMs = Math.round(performance.now() - startedAt);
    const lastModified = response.headers.get("last-modified") || checkedAt;
    const age = response.headers.get("age") || "unknown";
    const cacheControl = response.headers.get("cache-control") || "unknown";
    const { contentHash } = await hashResponseBody(response);
    const cacheTtlHours = parseCacheTtlHours(cacheControl);
    const stale = age !== "unknown" ? Number(age) > (job.input?.maxAgeHours || 24) * 3600 : false;
    return {
      status: response.status,
      responseTimeMs,
      lastModified,
      age,
      cacheControl,
      cacheTtlHours,
      contentHash,
      checkedAt,
      stale,
      isStale: stale,
    };
  } catch (error) {
    const responseTimeMs = Math.round(performance.now() - startedAt);
    const message = error.name === "AbortError" ? "HTTP check timed out" : error.message;
    return { status: 599, responseTimeMs, contentHash: `0x${createHash("sha256").update(message).digest("hex")}`, checkedAt, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function hashResponseBody(response) {
  const hash = createHash("sha256");
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
  }
  return { contentHash: `0x${hash.digest("hex")}` };
}

function parseCacheTtlHours(cacheControl) {
  const match = String(cacheControl || "").match(/max-age=(\d+)/i);
  return match ? Math.round((Number(match[1]) / 3600) * 100) / 100 : 0;
}

function buildProof(job, result) {
  return {
    proofId: `proof_${config.agentId}_${Date.now()}_${randomUUID().slice(0, 8)}`,
    agentId: config.agentId,
    jobId: job.jobId,
    jobType: job.jobType,
    input: job.input,
    result,
    verificationRoute: "freshness_check_v0",
    proofTimestamp: new Date().toISOString(),
  };
}

async function submitProof(jobId, proof) {
  return client.submitProof(jobId, proof);
}

function parseCapabilities(value) {
  return [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))];
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

function positiveInteger(v, fb) { const n = Number(v ?? fb); if (!Number.isInteger(n) || n <= 0) return fb; return n; }
function isHttpUrl(v) { try { return ["http:", "https:"].includes(new URL(v).protocol); } catch { return false; } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(event, d = {}) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), worker: "freshness-clerk-v0", event, ...d })); }
