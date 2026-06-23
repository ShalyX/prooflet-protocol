import { createHash, randomUUID } from "node:crypto";
import { AgentClient, UsefulWaitingApiError } from "@useful-waiting/agent-sdk";

const flags = parseArgs(process.argv.slice(2));
const config = {
  apiUrl: (flags.apiUrl || process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, ""),
  agentId: flags.agentId || process.env.AGENT_ID || "agent_lynx",
  apiKey: flags.agentApiKey || process.env.AGENT_API_KEY || "uwp_agent_lynx_dev",
  capabilities: parseCapabilities(flags.capabilities || process.env.WORKER_CAPABILITIES || "link_verification"),
  pollIntervalMs: positiveInteger(flags.pollIntervalMs || process.env.POLL_INTERVAL_MS, 5000),
  fetchTimeoutMs: positiveInteger(flags.fetchTimeoutMs || process.env.WORKER_FETCH_TIMEOUT_MS, 20000),
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
      const claim = await claimJob();
      if (!claim) {
        emptyPolls += 1;
        const waitMs = Math.min(config.pollIntervalMs * 2 ** Math.min(emptyPolls - 1, 4), 60000);
        log("no eligible job", { backoffMs: waitMs });
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

async function assertHealthy() {
  const body = await client.health();
  const acceptedProtocols = new Set(["Prooflet", "Useful Waiting Protocol"]);
  if (!body.ok || !acceptedProtocols.has(body.protocol)) throw new Error("Prooflet API health check failed.");
  log("api healthy", { apiUrl: config.apiUrl, version: body.version });
}

async function validateAgent() {
  const agent = await client.getAgent();
  const missing = config.capabilities.filter((capability) => !agent.capabilities.includes(capability));
  if (missing.length > 0) throw new Error(`Agent ${config.agentId} is not registered for: ${missing.join(", ")}.`);
  return agent;
}

async function claimJob() {
  const job = await client.claimJob({ leaseSeconds: Math.max(60, Math.ceil(config.fetchTimeoutMs / 1000) + 20) });
  if (!job) return null;
  if (!config.capabilities.includes(job.jobType)) {
    throw new Error(`API returned unsupported capability ${job.jobType} to ${config.agentId}.`);
  }
  return job;
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
    reward: {
      amount: job.rewardAmount,
      asset: job.rewardAsset,
      network: job.network,
    },
    proofTimestamp: new Date().toISOString(),
  };
}

async function submitProof(jobId, proof) {
  return client.submitProof(jobId, proof);
}

function parseCapabilities(value) {
  const capabilities = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (capabilities.length === 0) throw new Error("WORKER_CAPABILITIES must include at least one capability.");
  return [...new Set(capabilities)];
}

function parseArgs(args) {
  const parsed = { once: false, check: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--once") {
      parsed.once = true;
      continue;
    }
    if (argument === "--check") {
      parsed.check = true;
      continue;
    }
    const match = argument.match(/^--(api-url|agent-id|agent-api-key|capabilities|poll-interval-ms|fetch-timeout-ms)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${argument}. Expected --once, --check, --api-url, --agent-id, --agent-api-key, --capabilities, --poll-interval-ms, or --fetch-timeout-ms.`);
    const value = match[2] ?? args[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${match[1]} requires a value.`);
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[key] = value;
  }
  return parsed;
}

function positiveInteger(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return number;
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(event, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), worker: "link-sentinel-v0", event, ...details }));
}
