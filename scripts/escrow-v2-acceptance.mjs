import assert from "node:assert/strict";
import { createApp } from "../server/api.mjs";
import { openDatabase } from "../server/db.mjs";
import { jobIdToBytes32, isTxHash, escrowV2Config } from "../server/escrow-v2.mjs";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Post-submission development — not part of the original Lepton Agents Hackathon submission.
 * Escrow V2 acceptance: contract artifacts + open-market fund → claimable transition.
 */

const abiPath = resolve("contracts/out/EscrowV2.abi");
const binPath = resolve("contracts/out/EscrowV2.bin");
assert.ok(existsSync(abiPath), "EscrowV2 ABI missing — compile contracts/EscrowV2.sol");
assert.ok(existsSync(binPath), "EscrowV2 bytecode missing — compile contracts/EscrowV2.sol");
const abi = JSON.parse(readFileSync(abiPath, "utf8"));
const bin = readFileSync(binPath, "utf8").trim();
assert.ok(bin.length > 100, "EscrowV2 bytecode looks empty");
const fns = new Set(abi.filter((x) => x.type === "function").map((x) => x.name));
for (const name of ["fundJob", "release", "refundJob", "refundExpired", "getEscrow"]) {
  assert.ok(fns.has(name), `missing ABI function ${name}`);
}
assert.ok(isTxHash("0x" + "ab".repeat(32)));
assert.ok(!isTxHash("0x1234"));
const bytes = jobIdToBytes32("job_open_market_demo");
assert.match(bytes, /^0x[0-9a-f]{64}$/);

const db = openDatabase({ path: "data/escrow-v2-acceptance.sqlite", reset: true });
const { app } = createApp({ db, seedDemoData: false });
const server = await new Promise((resolveListen) => {
  const s = app.listen(0, "127.0.0.1", () => resolveListen(s));
});
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function json(method, path, body, apiKey) {
  const headers = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

try {
  const cfg = await json("GET", "/escrow/v2/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.data.escrowVersion, 2);
  assert.equal(cfg.data.network, "Arc Testnet");
  assert.equal(cfg.data.mainnet, false);

  const issuer = await json("POST", "/issuers/register", { name: "Escrow V2 Issuer" });
  assert.equal(issuer.status, 201);
  const issuerId = issuer.data.issuer.issuerId;
  const issuerKey = issuer.data.apiKey;

  const jobId = `job_v2_${Date.now()}`;
  const created = await json("POST", "/jobs", {
    jobId,
    issuerId,
    jobType: "link_verification",
    input: { url: "https://example.com/v2-escrow" },
    rewardAmount: "0.01",
    fundingStatus: "awaiting_wallet_funding",
    status: "draft",
    proofRequirements: { type: "link" },
    fundingRail: "arc_usdc_escrow_v2",
  }, issuerKey);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.job.fundingStatus, "awaiting_wallet_funding");
  assert.equal(created.data.job.status, "draft");

  const bad = await json("POST", `/jobs/${jobId}/fund-escrow`, {
    issuerId,
    txHash: "not-a-hash",
  }, issuerKey);
  assert.equal(bad.status, 400);

  const fundTx = "0x" + "11".repeat(32);
  const funded = await json("POST", `/jobs/${jobId}/fund-escrow`, {
    issuerId,
    txHash: fundTx,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  }, issuerKey);
  assert.equal(funded.status, 200, JSON.stringify(funded.data));
  assert.equal(funded.data.escrowVersion, 2);
  assert.equal(funded.data.job.fundingStatus, "reserved");
  assert.equal(funded.data.job.status, "open");
  assert.equal(funded.data.job.fundingRail, "arc_usdc_escrow_v2");
  assert.equal(funded.data.job.escrowStatus, "funded");
  assert.equal(funded.data.job.escrowTxHash, fundTx);
  assert.equal(funded.data.escrow.jobIdBytes32, jobIdToBytes32(jobId));
  assert.equal(funded.data.escrow.verifiedOnchain, false); // ESCROW_V2_SKIP_ONCHAIN in this check

  // Claim path requires agent + access fee in full stack; assert job is claim-funding eligible.
  const listed = await json("GET", "/jobs");
  assert.equal(listed.status, 200);
  const job = listed.data.jobs.find((row) => row.jobId === jobId);
  assert.ok(job);
  assert.equal(job.fundingStatus, "reserved");
  assert.equal(job.status, "open");

  console.log(JSON.stringify({
    ok: true,
    postSubmission: true,
    checks: [
      "ProofletEscrowV2 ABI/bytecode compiled",
      "fundJob/release/refundJob present",
      "open-market draft job becomes reserved/open after V2 fund receipt",
      "Arc Testnet only; mainnet flag false",
      "invalid fund txHash rejected",
    ],
    config: escrowV2Config(),
  }, null, 2));
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  db.close();
}
