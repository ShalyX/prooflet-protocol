#!/usr/bin/env node
/**
 * Prooflet — Full protocol demo runner.
 *
 * Covers:
 * - API health + Circle config status
 * - external issuer registration + Circle wallet provisioning state
 * - external draft escrow job creation + unfunded claim blocking
 * - demo issuer compound jobs
 * - context compression job
 * - all 3 reference workers: link, freshness, context compression
 * - dashboard, leaderboard, compound status
 * - settlement daemon dry-run preview
 *
 * Usage:
 *   npm run demo:full
 */

const API_URL = (process.env["USEFUL_WAITING_API_URL"] || "http://127.0.0.1:8787").replace(/\/$/, "");
const ISSUER_ID = "useful_waiting_protocol";
const ISSUER_KEY = "uwp_issuer_useful_waiting_protocol_dev";
const AGENTS = {
  link: { worker: "link-sentinel", agentId: "agent_lynx", apiKey: "uwp_agent_lynx_dev", args: ["--once", "--fetch-timeout-ms", "15000"] },
  freshness: { worker: "freshness-clerk", agentId: "agent_mira", apiKey: "uwp_agent_mira_dev", args: ["--once", "--fetch-timeout-ms", "15000"] },
  compress: { worker: "context-press", agentId: "agent_byte", apiKey: "uwp_agent_byte_dev", args: ["--once", "--fetch-timeout-ms", "30000"] },
};

const runId = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const report = [];

async function main() {
  banner("Prooflet — Full Demo Test");
  console.log(`API: ${API_URL}`);
  console.log(`Run: ${runId}\n`);

  await step("API health", async () => {
    const health = await request("/health");
    assert(health.ok, "API health returned ok=true");
    return `${health.protocol} ${health.version}`;
  });

  await step("Circle status", async () => {
    const status = await request("/circle/status");
    assert(typeof status.configured === "boolean", "circle/status returned configured boolean");
    return status.configured
      ? `configured=true walletSetId=${status.walletSetId || "auto"}`
      : `configured=false (wallet provisioning expected to fail gracefully)`;
  });

  const external = await step("External issuer registration", async () => {
    const result = await request("/issuers/register", {
      method: "POST",
      body: {
        name: `Arc Linkwatch Labs ${runId}`,
        email: "demo-issuer@example.com",
        description: "External issuer demo account for Prooflet full-flow test",
      },
    });
    assert(result.ok === true, "issuer registration returned ok=true");
    assert(result.issuer?.issuerId, "issuerId generated");
    assert(result.apiKey, "issuer apiKey returned");
    return result;
  }, (result) => {
    const wallet = result.wallet
      ? `wallet=${result.wallet.address || result.wallet.walletId}`
      : `walletProvisioning=${result.walletProvisioning?.status || "unknown"}: ${result.walletProvisioning?.message || "no wallet"}`;
    return `${result.issuer.issuerId} | ${wallet}`;
  });

  await step("External issuer wallet hydration/retry endpoint", async () => {
    const walletResult = await request(`/issuers/${encodeURIComponent(external.issuer.issuerId)}/wallet`, {
      headers: apiKey(external.apiKey),
    });
    assert("wallet" in walletResult, "wallet endpoint returned wallet field");
    return walletResult.wallet
      ? `wallet active: ${walletResult.wallet.address || walletResult.wallet.walletId}`
      : `wallet unavailable but graceful: ${walletResult.walletProvisioning?.message || "no reason returned"}`;
  });

  const externalDraft = await step("External issuer draft escrow job", async () => {
    const jobId = `demo_ext_draft_${runId}`;
    const result = await request("/jobs", {
      method: "POST",
      headers: apiKey(external.apiKey),
      body: {
        jobId,
        issuerId: external.issuer.issuerId,
        jobType: "link_verification",
        input: { url: "https://developers.circle.com/stablecoins" },
        rewardAmount: "0.002",
        fundingStatus: "awaiting_wallet_funding",
        fundingRail: "arc_usdc_escrow",
        status: "draft",
        proofRequirements: { requiredResultFields: ["status", "responseTimeMs", "contentHash", "checkedAt"] },
      },
    });
    assert(result.job?.jobId === jobId, "draft job created");
    assert(result.job.status === "draft", "draft job status preserved");
    assert(result.job.fundingStatus === "awaiting_wallet_funding", "funding status awaiting wallet funding");
    return result.job;
  }, (job) => `${job.jobId} status=${job.status} funding=${job.fundingStatus} rail=${job.fundingRail}`);

  await step("Unfunded external job claim is blocked", async () => {
    const result = await request(`/agents/${AGENTS.link.agentId}/claim-job`, {
      method: "POST",
      headers: apiKey(AGENTS.link.apiKey),
      body: { jobId: externalDraft.jobId, leaseSeconds: 30 },
      expectOk: false,
    });
    assert(result.status >= 400, "claim returned error status");
    assert(/not open|requires funding/i.test(result.body?.error || ""), "claim blocked because draft/unfunded");
    return `${result.status}: ${result.body?.error}`;
  });

  const compound = await step("Demo issuer compound job", async () => {
    const result = await request("/jobs/compound", {
      method: "POST",
      headers: apiKey(ISSUER_KEY),
      body: {
        jobId: `demo_compound_${runId}`,
        issuerId: ISSUER_ID,
        combinedReward: "0.006",
        subTasks: [
          { type: "link_verification", input: { url: "https://docs.arc.network" }, requiredResultFields: ["status", "responseTimeMs", "contentHash", "checkedAt"] },
          { type: "freshness_check", input: { sourceUrl: "https://docs.arc.network", maxAgeHours: 24 }, requiredResultFields: ["lastModified", "stale", "cacheTtlHours", "checkedAt"] },
        ],
      },
    });
    assert(result.compoundJob?.parentJobId, "compound parent created");
    assert(result.compoundJob?.subJobIds?.length === 2, "two subjobs created");
    return result.compoundJob;
  }, (cj) => `${cj.parentJobId} subjobs=${cj.subJobIds.join(",")}`);

  const compression = await step("Context compression job", async () => {
    const traceText = [
      `[${new Date().toISOString()}] Starting demo agent cycle ${runId}`,
      "Fetching https://docs.arc.network to validate live Arc documentation availability and redirect behavior for a micro-work issuer.",
      "Response: 200 OK, 183ms, content hash calculated and proof packet prepared for deterministic verification.",
      "Decision: verify page freshness, link redirect chain, response status, and structured proof fields before making payout eligible.",
      "Error: synthetic rate-limit warning at 95% capacity; worker records the warning and continues safely without retry storm.",
      "Action: submit structured proof packet with status, responseTimeMs, contentHash, checkedAt, and finalUrl.",
      "Outcome: accepted proof becomes payable after Prooflet verification; rejected and pending proofs are excluded from settlement.",
      "Settlement: operator-controlled release, not hosted API custody; frontend/API never holds escrowed issuer rewards.",
      "Wallet: agent payout address is stored as Circle-created wallet metadata or EVM payout address for Arc Testnet settlement.",
      "Demo note: this trace is intentionally verbose so Context Press can produce a shorter structured summary.",
    ].join("\n");
    const result = await request("/jobs", {
      method: "POST",
      headers: apiKey(ISSUER_KEY),
      body: {
        jobId: `demo_compress_${runId}`,
        issuerId: ISSUER_ID,
        jobType: "context_compression",
        input: { traceId: `trace_${runId}`, traceText, maxTokens: 1500 },
        rewardAmount: "0.004",
        proofRequirements: { requiredResultFields: ["originalLength", "compressedLength", "compressionRatio", "semanticChecksum"] },
      },
    });
    assert(result.job?.jobId, "compression job created");
    return result.job;
  }, (job) => `${job.jobId} reward=${job.rewardAmount}`);

  await step("Run Link Sentinel worker", async () => runWorker(AGENTS.link), workerSummary);
  await step("Run Freshness Clerk worker", async () => runWorker(AGENTS.freshness), workerSummary);
  await step("Run Context Press worker", async () => runWorker(AGENTS.compress), workerSummary);

  await step("Dashboard state", async () => {
    const dashboard = await request("/dashboard");
    const proofs = dashboard.proofs || [];
    const jobs = dashboard.jobs || [];
    const runJobs = jobs.filter((j) => String(j.jobId).includes(runId));
    const payable = proofs.filter((p) => p.fundingStatus === "payable").length;
    assert(runJobs.length >= 4, `expected at least 4 run jobs, got ${runJobs.length}`);
    return `jobs=${jobs.length} proofs=${proofs.length} runJobs=${runJobs.length} payable=${payable}`;
  });

  await step("Leaderboard", async () => {
    const lb = await request("/leaderboard");
    assert(Array.isArray(lb.leaderboard), "leaderboard array returned");
    const top = lb.leaderboard.slice(0, 3).map((a) => `#${a.rank}:${a.agentId || a.name}`).join(" ");
    return top || "empty leaderboard";
  });

  await step("Compound job status", async () => {
    const result = await request("/jobs/compound");
    const found = (result.compoundJobs || []).find((cj) => cj.parentJobId === compound.parentJobId);
    assert(found, "compound job appears in listing");
    return `${found.parentJobId} status=${found.status} completed=${found.completedSubProofs}/${found.totalSubJobs}`;
  });

  await step("Settlement daemon dry-run", async () => {
    const result = await runCommand("node", ["--no-warnings", "--env-file-if-exists=.env", "workers/settlement-daemon.mjs", "--mode=dry-run", "--once"], 30000, {
      TREASURY_ADDRESS: "0x709F18F797347FbB8D53Fb60567892751dd14B11",
    });
    assert(result.code === 0, `settlement dry-run exited ${result.code}`);
    return compactOutput(result.stdout || result.stderr || "dry-run ok");
  });

  await step("Production build", async () => {
    const result = await runCommand("npm", ["run", "build"], 60000);
    assert(result.code === 0, `build exited ${result.code}`);
    return compactOutput(result.stdout);
  });

  console.log("\n" + "═".repeat(64));
  console.log("Prooflet full demo summary");
  console.log("═".repeat(64));
  for (const item of report) {
    console.log(`${item.ok ? "✅" : "❌"} ${item.name}: ${item.summary}`);
  }
  const failures = report.filter((item) => !item.ok);
  console.log("\nResult:", failures.length ? `${failures.length} failure(s)` : "all demo checks passed");
  if (failures.length) process.exitCode = 1;
}

async function step(name, fn, summarize = (value) => String(value)) {
  process.stdout.write(`\n▶ ${name} ... `);
  try {
    const value = await fn();
    const summary = summarize(value);
    console.log("✅");
    console.log(`  ${summary}`);
    report.push({ name, ok: true, summary });
    return value;
  } catch (error) {
    console.log("❌");
    console.log(`  ${error.stack || error.message}`);
    report.push({ name, ok: false, summary: error.message });
    throw error;
  }
}

async function request(path, opts = {}) {
  const { expectOk = true, ...fetchOpts } = opts;
  const res = await fetch(`${API_URL}${path}`, {
    ...fetchOpts,
    headers: { "content-type": "application/json", ...(fetchOpts.headers || {}) },
    body: fetchOpts.body ? JSON.stringify(fetchOpts.body) : undefined,
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (expectOk && !res.ok) throw new Error(`${path} failed ${res.status}: ${body.error || text}`);
  if (!expectOk) return { status: res.status, body };
  return body;
}

function apiKey(key) {
  return { "x-api-key": key };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runWorker(spec) {
  const result = await runCommand("node", ["--no-warnings", `workers/${spec.worker}.mjs`, ...spec.args], 45000, {
    USEFUL_WAITING_API_URL: API_URL,
    AGENT_ID: spec.agentId,
    AGENT_API_KEY: spec.apiKey,
  });
  assert(result.code === 0, `${spec.worker} exited ${result.code}: ${compactOutput(result.stderr || result.stdout)}`);
  assert(/proof created|verification result|No eligible open job is available/i.test(result.stdout + result.stderr), `${spec.worker} produced no recognizable outcome`);
  return { ...result, worker: spec.worker };
}

function workerSummary(result) {
  const text = result.stdout || result.stderr || "";
  const proof = text.match(/"proofId":"([^"]+)"/);
  const outcome = text.match(/"outcome":"([^"]+)"/);
  const claimed = text.match(/"jobId":"([^"]+)"/);
  return `${result.worker} exit=${result.code} job=${claimed?.[1] || "n/a"} proof=${proof?.[1] || "n/a"} outcome=${outcome?.[1] || "n/a"}`;
}

async function runCommand(command, args, timeoutMs, extraEnv = {}) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: -1, stdout, stderr: stderr + "\n[TIMEOUT]" });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function compactOutput(text) {
  return String(text).split(/\r?\n/).filter(Boolean).slice(-8).join(" | ").slice(0, 800);
}

function banner(title) {
  console.log("\n" + "═".repeat(64));
  console.log(title);
  console.log("═".repeat(64));
}

main().catch((error) => {
  console.error("\nDemo failed:", error.message);
  process.exit(1);
});
