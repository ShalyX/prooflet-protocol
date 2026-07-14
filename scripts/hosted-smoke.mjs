const baseUrl = String(process.env["PROOFLET_SMOKE_URL"] || process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const expectDurable = process.env["PROOFLET_EXPECT_DURABLE"] === "true";

const healthResponse = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(45000) });
if (!healthResponse.ok) throw new Error(`Health check failed with HTTP ${healthResponse.status}.`);
const health = await healthResponse.json();
if (!health.ok || !health.database?.connected || !health.database?.foreignKeys) throw new Error("Health response did not confirm database connectivity and foreign-key enforcement.");
if (expectDurable && !health.storage?.durable) throw new Error("Hosted API did not report durable storage.");
if (healthResponse.headers.get("cache-control") !== "no-store") throw new Error("Health response must be no-store.");
if (!healthResponse.headers.get("x-request-id")) throw new Error("Health response is missing x-request-id.");

const dashboardResponse = await fetch(`${baseUrl}/dashboard`, { signal: AbortSignal.timeout(45000) });
if (!dashboardResponse.ok) throw new Error(`Dashboard check failed with HTTP ${dashboardResponse.status}.`);
const dashboard = await dashboardResponse.json();
if (dashboard.protocol !== "Prooflet" || !Array.isArray(dashboard.jobs) || !Array.isArray(dashboard.proofs)) {
  throw new Error("Dashboard response is missing protocol ledger state.");
}

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  storage: health.storage,
  durabilityEvidence: "configuration-only; verify a unique record survives an actual platform restart or redeploy",
  migrationVersion: health.database?.migrationVersion,
  counts: { agents: dashboard.agents.length, jobs: dashboard.jobs.length, proofs: dashboard.proofs.length },
}, null, 2));
