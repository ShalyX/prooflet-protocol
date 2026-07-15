/**
 * Post-submission: issuer faucet endpoint acceptance (no live drip required).
 */
import assert from "node:assert/strict";
import { createApp } from "../server/api.mjs";
import { openDatabase } from "../server/db.mjs";
import { cleanupDatabase } from "./test-helpers.mjs";

const path = `data/issuer-faucet-${Date.now()}.sqlite`;
const db = openDatabase({ path, reset: true });

const fakeWalletId = "wallet-faucet-test";
const fakeAddress = "0x1111111111111111111111111111111111111111";
let faucetCalls = 0;

const walletService = {
  isCircleConfigured: () => true,
  getCircleStatus: () => ({ configured: true }),
  createIssuerWallet: async () => ({ walletId: fakeWalletId, address: fakeAddress, blockchain: "ARC-TESTNET" }),
  getWalletBalance: async () => ({ amount: faucetCalls > 0 ? "10" : "0", decimals: 6 }),
  getWalletDetails: async () => ({ address: fakeAddress, blockchain: "ARC-TESTNET" }),
  requestTestnetFunds: async () => {
    faucetCalls += 1;
    return {
      ok: true,
      mode: "circle_api",
      address: fakeAddress,
      walletId: fakeWalletId,
      message: "Faucet request accepted by Circle API.",
    };
  },
  manualFaucetInfo: (address) => ({
    url: "https://faucet.circle.com/",
    address,
    network: "Arc Testnet",
    asset: "USDC",
    instructions: ["open faucet"],
  }),
  sendUsdc: async () => null,
  createAgentWallet: async () => ({ walletId: "a", address: fakeAddress }),
};

const { app } = createApp({ db, seedDemoData: false, walletService });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

async function req(method, route, body, apiKey) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

try {
  const issuer = await req("POST", "/issuers/register", { name: "Faucet Issuer" });
  const issuerId = issuer.data.issuer.issuerId;
  const key = issuer.data.apiKey;

  const unauth = await req("POST", `/issuers/${issuerId}/faucet`, {});
  assert.equal(unauth.status, 401);

  const claimed = await req("POST", `/issuers/${issuerId}/faucet`, {}, key);
  assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
  assert.equal(claimed.data.ok, true);
  assert.equal(claimed.data.network, "Arc Testnet");
  assert.equal(claimed.data.wallet.address.toLowerCase(), fakeAddress.toLowerCase());
  assert.equal(faucetCalls, 1);

  const info = await req("GET", `/issuers/${issuerId}/faucet`, null, key);
  assert.equal(info.status, 200);
  assert.equal(info.data.manual.url, "https://faucet.circle.com/");

  console.log(JSON.stringify({
    ok: true,
    postSubmission: true,
    checks: ["auth required", "faucet claim path", "manual faucet metadata"],
  }, null, 2));
} finally {
  await new Promise((r) => server.close(r));
  db.close();
  cleanupDatabase(path);
}
