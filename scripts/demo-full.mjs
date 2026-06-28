#!/usr/bin/env node
/**
 * Prooflet — One-click full demo.
 * Seeds compound + single jobs, runs all 3 workers, shows results.
 *
 * Usage: npm run demo:full
 */
const API_URL = process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787";
const r = (path, opts = {}) => fetch(`${API_URL}${path}`, {
  ...opts,
  headers: { "content-type": "application/json", ...opts.headers },
  body: opts.body ? JSON.stringify(opts.body) : undefined,
}).then((res) => res.json().catch(() => ({})));

async function main() {
  console.log("\n═══════════════════════════════════════════");
  console.log("  Prooflet — Full Demo");
  console.log("  Tiny agent jobs. Verified by proof. Paid in USDC.");
  console.log("═══════════════════════════════════════════\n");

  // 1. Health check
  const health = await r("/health");
  console.log(`[1/6] API health: ${health.ok ? "✅" : "❌"} (${health.protocol} v${health.version})`);

  // 2. Create a compound job (link + freshness)
  console.log("\n[2/6] Creating compound job (link_verification + freshness_check)...");
  const compound = await r("/jobs/compound", {
    method: "POST",
    body: {
      jobId: `demo_compound_${Date.now()}`,
      issuerId: "useful_waiting_protocol",
      combinedReward: "0.03",
      subTasks: [
        { type: "link_verification", input: { url: "https://docs.arc.network" }, requiredResultFields: ["status", "responseTimeMs", "contentHash"] },
        { type: "freshness_check", input: { sourceUrl: "https://docs.arc.network", maxAgeHours: 24 }, requiredResultFields: ["lastModified", "stale", "cacheTtlHours"] },
      ],
    },
  });
  console.log(`   Parent: ${compound.compoundJob?.parentJobId || "❌"}`);
  console.log(`   Sub-jobs: ${compound.compoundJob?.subJobIds?.join(", ") || "❌"}`);

  // 3. Create a context compression job
  console.log("\n[3/6] Creating context compression job...");
  const traceText = `[2026-06-28T10:00:00Z] Starting agent cycle for job_2001\n` +
    `[2026-06-28T10:00:01Z] Fetching https://docs.arc.network\n` +
    `[2026-06-28T10:00:02Z] Response: 200 OK, 183ms\n` +
    `[2026-06-28T10:00:03Z] Content hash: 0x31a9d4e7\n` +
    `[2026-06-28T10:00:04Z] Error: rate limit at 95% capacity\n` +
    `[2026-06-28T10:00:05Z] Verifying proof packet for job_2001\n` +
    `[2026-06-28T10:00:06Z] Submitting to adjudication route: link_verification_v0\n` +
    `[2026-06-28T10:00:07Z] Outcome: accepted. Reward: 0.018 USDC\n` +
    `[2026-06-28T10:00:08Z] Wallet balance: 0.761 USDC remaining`;
  const ccJob = await r("/jobs", {
    method: "POST",
    body: {
      jobId: `demo_compress_${Date.now()}`,
      issuerId: "useful_waiting_protocol",
      jobType: "context_compression",
      input: { traceId: `trace_demo_${Date.now()}`, traceText, maxTokens: 1500 },
      rewardAmount: "0.022",
      proofRequirements: { requiredResultFields: ["originalLength", "compressedLength", "compressionRatio", "semanticChecksum"] },
    },
  });
  console.log(`   Job: ${ccJob.job?.jobId || "❌"} at ${ccJob.job?.rewardAmount} USDC`);

  // 4. Run Link Sentinel
  console.log("\n[4/6] Running Link Sentinel (link_verification)...");
  console.log("   npm run agent:link:once");
  const sentinel = await runWorker("link-sentinel", "--once --fetch-timeout-ms 15000");
  console.log(`   Exit: ${sentinel.code}${sentinel.outputs?.length ? ` | Lines: ${sentinel.outputs.length}` : ""}`);

  // 5. Run Freshness Clerk
  console.log("\n[5/6] Running Freshness Clerk (freshness_check)...");
  console.log("   npm run agent:freshness:once");
  const clerk = await runWorker("freshness-clerk", "--once --fetch-timeout-ms 15000");
  console.log(`   Exit: ${clerk.code}${clerk.outputs?.length ? ` | Lines: ${clerk.outputs.length}` : ""}`);

  // 6. Show results
  console.log("\n[6/6] Results:");
  const dashboard = await r("/dashboard");
  const proofs = dashboard.proofs || [];
  const jobs = dashboard.jobs || [];
  console.log(`   Jobs: ${jobs.length} total`);
  console.log(`   Proofs: ${proofs.length} total`);
  console.log(`   Payable: ${proofs.filter((p) => p.fundingStatus === "payable").length}`);
  console.log(`   Paid: ${proofs.filter((p) => p.fundingStatus === "paid").length}`);

  // Show leaderboard
  const lb = await r("/leaderboard");
  console.log("\n   ─── Agent Leaderboard ───");
  (lb.leaderboard || []).slice(0, 5).forEach((a) => {
    console.log(`   #${a.rank} ${a.name.padEnd(18)} ${String(a.score).padStart(3)} pts  ${a.approvedProofs} approved  ${a.paidProofs} paid`);
  });

  // Show compound job status
  const compounds = await r("/jobs/compound");
  console.log("\n   ─── Compound Jobs ───");
  (compounds.compoundJobs || []).forEach((cj) => {
    console.log(`   ${cj.parentJobId}: ${cj.status} (${cj.completedSubProofs}/${cj.totalSubJobs} sub-proofs)`);
  });

  console.log("\n═══════════════════════════════════════════");
  console.log("  Demo complete! npm run settlement:daemon:dry-run -- --once to preview payout.");
  console.log("═══════════════════════════════════════════\n");
}

async function runWorker(name, args) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn("node", ["--no-warnings", `workers/${name}.mjs`, ...args.split(" ")], {
      cwd: process.cwd(),
      env: { ...process.env, USEFUL_WAITING_API_URL: API_URL, AGENT_API_KEY: "uwp_agent_lynx_dev" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let outputs = [];
    child.stdout.on("data", (c) => outputs.push(c.toString().trim()));
    child.once("close", (code) => resolve({ code, outputs }));
    setTimeout(() => { child.kill(); resolve({ code: -1, outputs }); }, 20000);
  });
}

main().catch(console.error);