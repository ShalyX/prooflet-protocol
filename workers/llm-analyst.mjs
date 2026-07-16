/**
 * Post-submission: LLM Analyst worker — real model inference + profit-aware claim gate.
 *
 * Not a scripted HTTP fetcher. Claims subjective content_summary jobs when:
 *   estimated_token_cost_usd + access_fee < reward * (1 - minMargin)
 *
 * Env:
 *   USEFUL_WAITING_API_URL, AGENT_ID, AGENT_API_KEY
 *   LLM_API_KEY | OPENROUTER_API_KEY | OPENAI_API_KEY
 *   LLM_BASE_URL (default OpenRouter), LLM_MODEL
 *   USD_PER_1K_INPUT / USD_PER_1K_OUTPUT (cost model for profit gate)
 *   MIN_PROFIT_MARGIN (default 0.2)
 *   ACCESS_FEE_USDC (default 0.000001)
 *   PRIVATE_KEY optional — if set, pays Gateway x402 before claim
 */
import { createHash, randomUUID } from "node:crypto";
import { AgentClient, UsefulWaitingApiError } from "@useful-waiting/agent-sdk";
import { estimateJobEconomics } from "./lib/llm-economics.mjs";

const flags = parseArgs(process.argv.slice(2));
const config = {
  apiUrl: (flags.apiUrl || process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, ""),
  agentId: flags.agentId || process.env.AGENT_ID,
  apiKey: flags.apiKey || process.env.AGENT_API_KEY,
  capabilities: parseCapabilities(flags.capabilities || process.env.WORKER_CAPABILITIES || "content_summary,claim_factcheck"),
  pollIntervalMs: positiveInteger(flags.pollIntervalMs || process.env.POLL_INTERVAL_MS, 8000),
  once: Boolean(flags.once),
  checkOnly: Boolean(flags.check),
  dryRun: Boolean(flags.dryRun || process.env.DRY_RUN === "1"),
  llm: {
    apiKey: process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.XAI_API_KEY,
    baseUrl: (process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL || "openai/gpt-4o-mini",
    usdPer1kIn: Number(process.env.USD_PER_1K_INPUT || 0.00015),
    usdPer1kOut: Number(process.env.USD_PER_1K_OUTPUT || 0.0006),
  },
  minProfitMargin: Number(process.env.MIN_PROFIT_MARGIN || 0.2),
  accessFeeUsdc: Number(process.env.ACCESS_FEE_USDC || 0.000001),
  privateKey: process.env.PRIVATE_KEY || process.env.GATEWAY_PRIVATE_KEY || null,
};

if (!config.agentId || !config.apiKey) {
  console.error("AGENT_ID and AGENT_API_KEY are required.");
  process.exit(1);
}
if (!config.llm.apiKey && !config.checkOnly) {
  console.error("LLM_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY required for live inference.");
  process.exit(1);
}

const client = new AgentClient({
  agentId: config.agentId,
  apiKey: config.apiKey,
  baseUrl: config.apiUrl,
  timeoutMs: 120_000,
});

await assertHealthy();
const agent = await client.getAgent();
log("llm-analyst ready", {
  agentId: agent.agentId,
  capabilities: config.capabilities,
  model: config.llm.model,
  minProfitMargin: config.minProfitMargin,
  accessFeeUsdc: config.accessFeeUsdc,
});

if (config.checkOnly) {
  log("check passed", { apiUrl: config.apiUrl });
  process.exit(0);
}

await pollForever();

async function pollForever() {
  let empty = 0;
  while (true) {
    try {
      const decision = await planAndMaybeClaim();
      if (!decision?.claim) {
        empty += 1;
        const wait = Math.min(config.pollIntervalMs * 2 ** Math.min(empty - 1, 3), 60_000);
        log("no profitable job", { waitMs: wait, rejections: decision?.rejections || [] });
        if (config.once) return;
        await sleep(wait);
        continue;
      }
      empty = 0;
      log("claimed", {
        jobId: decision.claim.jobId,
        jobType: decision.claim.jobType,
        reward: decision.claim.rewardAmount,
        estimate: decision.estimate,
      });
      const task = await runLlmJob(decision.claim);
      log("llm result", {
        jobId: decision.claim.jobId,
        model: task.model,
        tokens: task.tokenUsage,
        confidence: task.confidence,
      });
      const proof = buildProof(decision.claim, task);
      const verification = await client.submitProof(decision.claim.jobId, proof);
      log("verification", {
        proofId: verification.proofId || proof.proofId,
        outcome: verification.outcome,
        fundingStatus: verification.fundingStatus,
        verificationRoute: verification.verificationRoute,
      });
      if (config.once) return;
    } catch (error) {
      const graceful = error instanceof UsefulWaitingApiError && [404, 409, 422].includes(error.status);
      log(graceful ? "cycle ended" : "worker error", { status: error.status, error: error.message });
      if (config.once && !graceful) throw error;
      if (config.once) return;
      await sleep(config.pollIntervalMs);
    }
  }
}

/**
 * Agentic P&L gate: estimate tokens from input size, compare to reward − access fee.
 */
async function planAndMaybeClaim() {
  const res = await fetch(`${config.apiUrl}/jobs`);
  if (!res.ok) throw new Error(`list jobs failed: ${res.status}`);
  const { jobs: allJobs } = await res.json();
  const openJobs = (allJobs || []).filter(
    (j) => j.status === "open" && config.capabilities.includes(j.jobType),
  );
  const rejections = [];
  const ranked = [];

  for (const job of openJobs) {
    const estimate = estimateJobEconomics(job, {
      usdPer1kIn: config.llm.usdPer1kIn,
      usdPer1kOut: config.llm.usdPer1kOut,
      accessFeeUsdc: config.accessFeeUsdc,
      minProfitMargin: config.minProfitMargin,
    });
    if (!estimate.profitable) {
      rejections.push({
        jobId: job.jobId,
        reason: "unprofitable",
        reward: estimate.reward,
        estimatedCost: estimate.estimatedCostUsd,
        accessFee: estimate.accessFee,
        margin: estimate.margin,
      });
      continue;
    }
    ranked.push({ job, estimate });
  }

  ranked.sort((a, b) => b.estimate.margin - a.estimate.margin);
  log("plan", {
    open: openJobs.length,
    profitable: ranked.length,
    rejectedUnprofitable: rejections.length,
    top: ranked.slice(0, 3).map((r) => ({
      jobId: r.job.jobId,
      margin: r.estimate.margin,
      reward: r.estimate.reward,
      estCost: r.estimate.estimatedCostUsd,
    })),
  });

  for (const candidate of ranked) {
    try {
      if (config.privateKey) {
        await payAccessIfNeeded(candidate.job.jobId);
      }
      const claim = await client.claimJob({
        jobId: candidate.job.jobId,
        leaseSeconds: 180,
      });
      if (claim) return { claim, estimate: candidate.estimate, rejections };
    } catch (error) {
      if (error instanceof UsefulWaitingApiError && [402, 409].includes(error.status)) {
        rejections.push({ jobId: candidate.job.jobId, reason: error.message });
        continue;
      }
      throw error;
    }
  }
  return { claim: null, rejections };
}

// local estimateJobEconomics removed — import from ./lib/llm-economics.mjs

async function runLlmJob(job) {
  const input = job.input || {};
  const sourceText = extractSourceText(input);
  if (!sourceText || sourceText.length < 40) {
    throw new Error("Job input lacks enough source text for LLM work.");
  }

  const system =
    job.jobType === "claim_factcheck"
      ? "You are a careful fact-checker. Return strict JSON only."
      : "You are a precise research analyst. Return strict JSON only.";

  const user =
    job.jobType === "claim_factcheck"
      ? `Fact-check the claim against the source. JSON keys: verdict (supported|refuted|insufficient), confidence (0-1), rationale (string), citations (string[]).\nClaim: ${input.claim || input.question || ""}\nSource:\n${sourceText.slice(0, 12000)}`
      : `Summarize the source for an agent operator. JSON keys: summary (2-4 sentences), keyPoints (string[] max 5), confidence (0-1), openQuestions (string[] max 3).\nTitle: ${input.title || "untitled"}\nSource:\n${sourceText.slice(0, 12000)}`;

  if (config.dryRun) {
    return {
      model: "dry-run",
      confidence: 0.5,
      summary: sourceText.slice(0, 240),
      keyPoints: ["dry-run"],
      tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      raw: { dryRun: true },
    };
  }

  const started = Date.now();
  const completion = await chatCompletions([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const parsed = parseJsonLoose(completion.content);
  const tokenUsage = {
    promptTokens: Number(completion.usage?.prompt_tokens || 0),
    completionTokens: Number(completion.usage?.completion_tokens || 0),
    totalTokens: Number(completion.usage?.total_tokens || 0),
  };

  return {
    model: config.llm.model,
    latencyMs: Date.now() - started,
    confidence: clamp01(parsed.confidence ?? 0.6),
    summary: String(parsed.summary || parsed.rationale || "").slice(0, 4000),
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String).slice(0, 5) : [],
    verdict: parsed.verdict || null,
    citations: Array.isArray(parsed.citations) ? parsed.citations.map(String).slice(0, 8) : [],
    openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions.map(String).slice(0, 3) : [],
    tokenUsage,
    contentHash: `0x${createHash("sha256").update(completion.content).digest("hex")}`,
    rawModelText: completion.content.slice(0, 8000),
  };
}

async function chatCompletions(messages) {
  const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://www.prooflet.xyz",
      "X-Title": "Prooflet LLM Analyst",
    },
    body: JSON.stringify({
      model: config.llm.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`LLM HTTP ${res.status}: ${body.error?.message || JSON.stringify(body).slice(0, 200)}`);
  }
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content.");
  return { content, usage: body.usage || {} };
}

function buildProof(job, task) {
  const result =
    job.jobType === "claim_factcheck"
      ? {
          verdict: task.verdict || "insufficient",
          confidence: task.confidence,
          rationale: task.summary,
          citations: task.citations,
          model: task.model,
          tokenUsage: task.tokenUsage,
          contentHash: task.contentHash,
          latencyMs: task.latencyMs,
        }
      : {
          summary: task.summary,
          keyPoints: task.keyPoints,
          confidence: task.confidence,
          openQuestions: task.openQuestions,
          model: task.model,
          tokenUsage: task.tokenUsage,
          contentHash: task.contentHash,
          latencyMs: task.latencyMs,
        };

  return {
    proofId: `proof_${config.agentId}_${Date.now()}_${randomUUID().slice(0, 8)}`,
    agentId: config.agentId,
    jobId: job.jobId,
    jobType: job.jobType,
    input: job.input,
    result,
    verificationRoute: "llm_analyst_v0",
    proofTimestamp: new Date().toISOString(),
  };
}

async function payAccessIfNeeded(jobId) {
  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync(
      "node",
      ["--no-warnings", "scripts/pay-job-access.mjs", "--job-id", jobId, "--agent-id", config.agentId, "--private-key", config.privateKey],
      {
        cwd: new URL("..", import.meta.url).pathname,
        env: { ...process.env, USEFUL_WAITING_API_URL: config.apiUrl },
        stdio: "pipe",
        timeout: 120_000,
      },
    );
    log("x402 paid", { jobId });
  } catch (error) {
    log("x402 pay failed (will try claim if already paid)", { jobId, error: error.message });
  }
}

async function assertHealthy() {
  const body = await client.health();
  if (!body.ok) throw new Error("API unhealthy");
}

function extractSourceText(input) {
  return String(input.sourceText || input.text || input.article || input.body || input.content || "").trim();
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return {};
    try {
      return JSON.parse(m[0]);
    } catch {
      return {};
    }
  }
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0.5;
  return Math.min(1, Math.max(0, x));
}


function parseCapabilities(value) {
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function positiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--once") out.once = true;
    else if (a === "--check") out.check = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--") && args[i + 1] && !args[i + 1].startsWith("--")) {
      out[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = args[++i];
    }
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(event, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), worker: "llm-analyst-v0", event, ...details }));
}
