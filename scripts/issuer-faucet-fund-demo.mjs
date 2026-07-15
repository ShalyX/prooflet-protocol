#!/usr/bin/env node
/**
 * Post-submission: real issuer faucet → Circle fund path (no treasury fundJob).
 *
 * 1) Register issuer (or reuse env)
 * 2) POST /issuers/:id/faucet
 * 3) If API Forbidden, print manual faucet steps and poll balance
 * 4) Create draft job + fund-from-circle-wallet
 *
 * Env:
 *   USEFUL_WAITING_API_URL
 *   ISSUER_ID / ISSUER_API_KEY optional
 *   FAUCET_WAIT_MS default 180000
 *   SKIP_FUND=1 to only claim faucet
 */
const API = (process.env.USEFUL_WAITING_API_URL || process.env.PROOFLET_API_URL || "https://prooflet-api.onrender.com").replace(/\/$/, "");
const waitMs = Number(process.env.FAUCET_WAIT_MS || 180_000);

async function req(method, path, body, apiKey) {
  const res = await fetch(`${API}${path}`, {
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

let issuerId = process.env.ISSUER_ID;
let apiKey = process.env.ISSUER_API_KEY;

if (!issuerId || !apiKey) {
  const reg = await req("POST", "/issuers/register", { name: `Faucet Demo ${Date.now().toString(36)}` });
  if (![200, 201].includes(reg.status)) throw new Error(`register failed: ${JSON.stringify(reg.data)}`);
  issuerId = reg.data.issuer.issuerId;
  apiKey = reg.data.apiKey;
  console.log(JSON.stringify({ registered: true, issuerId, hasApiKey: Boolean(apiKey) }, null, 2));
}

const faucet = await req("POST", `/issuers/${issuerId}/faucet`, {}, apiKey);
console.log(JSON.stringify({ faucet: { status: faucet.status, ok: faucet.data.ok, wallet: faucet.data.wallet, mode: faucet.data.faucet?.mode, message: faucet.data.faucet?.message || faucet.data.next } }, null, 2));

const address = faucet.data.wallet?.address || faucet.data.faucet?.address;
if (!faucet.data.ok) {
  console.log(JSON.stringify({
    manualFaucet: faucet.data.faucet?.manual || { url: "https://faucet.circle.com/", address },
    note: "Complete reCAPTCHA on faucet.circle.com for Arc Testnet USDC. This script will poll balance (no treasury top-up).",
  }, null, 2));
}

const started = Date.now();
let balance = faucet.data.wallet?.balanceAfter || "0";
while (Date.now() - started < waitMs) {
  const w = await req("GET", `/issuers/${issuerId}/wallet`, null, apiKey);
  balance = w.data.wallet?.balance || "0";
  console.log(JSON.stringify({ pollBalance: balance, address: w.data.wallet?.address || address }, null, 2));
  if (Number(balance) >= 0.003) break;
  await new Promise((r) => setTimeout(r, 10_000));
}

if (Number(balance) < 0.003) {
  console.log(JSON.stringify({
    ok: false,
    reason: "issuer_wallet_still_unfunded",
    address,
    balance,
    action: "Claim faucet then re-run with ISSUER_ID and ISSUER_API_KEY",
    issuerId,
  }, null, 2));
  process.exit(2);
}

if (process.env.SKIP_FUND === "1") {
  console.log(JSON.stringify({ ok: true, fundedWallet: true, balance, issuerId, skippedFund: true }, null, 2));
  process.exit(0);
}

const jobId = `job_faucet_${Date.now().toString(36)}`;
const created = await req("POST", "/jobs", {
  jobId,
  issuerId,
  jobType: "link_verification",
  input: { url: "https://example.com/faucet-issuer" },
  rewardAmount: "0.003",
  fundingStatus: "awaiting_wallet_funding",
  fundingRail: "arc_usdc_escrow_v2",
  status: "draft",
  proofRequirements: { requiredResultFields: ["status", "responseTimeMs", "contentHash"] },
}, apiKey);
if (created.status !== 201) throw new Error(`create job failed: ${JSON.stringify(created.data)}`);

const fund = await req("POST", `/jobs/${jobId}/fund-from-circle-wallet`, { issuerId, requestFaucet: false }, apiKey);
console.log(JSON.stringify({
  ok: fund.status === 200,
  status: fund.status,
  jobId,
  issuerId,
  balance,
  fund: fund.data,
  treasuryUsed: false,
}, null, 2));
if (fund.status !== 200) process.exit(1);
