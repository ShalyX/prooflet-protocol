#!/usr/bin/env node
/**
 * Autonomous settlement tick — silent when nothing to release.
 * Used by Hermes cron (no_agent) so empty ticks do not spam chat.
 *
 * Exit 0 always on soft empty queue; non-zero on hard failure.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sh = join(root, "scripts/run-autonomous-settlement.sh");

function loadSecureKey() {
  const p = "/root/.hermes/secure/escrow-operator-api-key";
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  return process.env.ESCROW_OPERATOR_API_KEY || "";
}

const env = {
  ...process.env,
  PROOFLET_API_URL: process.env.PROOFLET_API_URL || "https://prooflet-api.onrender.com",
  USEFUL_WAITING_API_URL: "https://prooflet-api.onrender.com",
  ESCROW_V2_ADDRESS: process.env.ESCROW_V2_ADDRESS || "0x55bde7d3546f3e6e534a508a9b96d4e8d839eee9",
  ARC_RPC_URL: process.env.ARC_RPC_URL || "https://arc-testnet.drpc.org",
  ESCROW_V2_AUTO_RELEASE_MODE: "execute",
  ESCROW_OPERATOR_API_KEY: loadSecureKey(),
};

const run = spawnSync("bash", [sh, "--execute", "--once"], {
  cwd: root,
  env,
  encoding: "utf8",
  timeout: 240_000,
});

const stdout = run.stdout || "";
const stderr = run.stderr || "";
if (run.status !== 0) {
  // Alert only on hard failures
  console.log(
    JSON.stringify(
      {
        ok: false,
        autonomousSettlement: true,
        exit: run.status,
        error: (stderr || stdout).slice(0, 1500),
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  process.exit(run.status || 1);
}

let parsed = null;
try {
  // last JSON object in stdout
  const start = stdout.lastIndexOf("{");
  if (start >= 0) parsed = JSON.parse(stdout.slice(start));
} catch {
  parsed = null;
}

const results = parsed?.results || [];
const released = results.filter((r) => r?.ok && r?.action === "release");
const failed = results.filter((r) => r?.ok === false || r?.error);

// Silent when queue empty or only skips
if (!released.length && !failed.length) {
  process.exit(0);
}

console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      autonomousSettlement: true,
      mode: "execute",
      queueCount: parsed?.queueCount ?? null,
      released: released.map((r) => ({
        jobId: r.jobId,
        proofId: r.proofId,
        amount: r.amount,
        txHash: r.txHash,
        explorer: r.explorer,
        ledger: r.ledger,
      })),
      failed: failed.map((r) => ({ jobId: r.jobId, error: r.error || r.reason })),
      skips: results.filter((r) => r?.skipped).map((r) => ({ jobId: r.jobId, reason: r.reason })),
      at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
process.exit(failed.length ? 2 : 0);
