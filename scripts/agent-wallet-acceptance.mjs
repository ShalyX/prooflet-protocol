import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const testDb = resolve("data/useful-waiting.agent-wallet.sqlite");
for (const suffix of ["", "-shm", "-wal"]) {
  const path = `${testDb}${suffix}`;
  if (existsSync(path)) rmSync(path);
}
process.env.UWP_DB_PATH = testDb;

const { createApp } = await import("../server/api.mjs");

try {
  await runCircleConfiguredCase();
  await runCircleNotConfiguredCases();
  console.log(JSON.stringify({
    ok: true,
    checks: [
      "circle wallet registration uses Circle wallet address as payout address",
      "dashboard exposes Circle wallet ID and payout address",
      "Circle wallet creation failure can fall back to a valid manual payout address",
      "missing Circle config without fallback payout is rejected",
      "manual fallback payout remains available and labeled",
    ],
  }, null, 2));
} finally {
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${testDb}${suffix}`;
    if (existsSync(path)) rmSync(path);
  }
}

async function runCircleConfiguredCase() {
  const circleAddress = "0x1111111111111111111111111111111111111111";
  const circleWalletId = "circle-wallet-agent-001";
  const walletService = {
    isCircleConfigured: () => true,
    createAgentWallet: async (agentId) => ({ walletId: circleWalletId, address: circleAddress, blockchain: "ARC-TESTNET", state: "LIVE", accountType: "SCA", agentId }),
    createIssuerWallet: async (issuerId) => ({ walletId: `issuer-${issuerId}`, address: "0x2222222222222222222222222222222222222222" }),
    getCircleStatus: () => ({ configured: true, walletSetId: "test-wallet-set" }),
    getWalletBalance: async () => ({ amount: "0", decimals: 6 }),
    getWalletDetails: async () => ({ address: circleAddress, blockchain: "ARC-TESTNET" }),
    sendUsdc: async () => null,
  };
  const test = await startServer(walletService);
  try {
    const registered = await request(test.baseUrl, "POST", "/agents/register-with-wallet", {
      agentId: "wallet_agent_circle",
      name: "Circle Wallet Agent",
      capabilities: ["link_verification"],
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.walletProvisioning.status, "success");
    assert.equal(registered.body.circleWallet.walletId, circleWalletId);
    assert.equal(registered.body.circleWallet.address, circleAddress);
    assert.equal(registered.body.agent.payoutAddress, circleAddress);
    assert.equal(registered.body.agent.circleWalletId, circleWalletId);

    const stored = test.db.prepare("SELECT payout_address, circle_wallet_id FROM agents WHERE agent_id = 'wallet_agent_circle'").get();
    assert.equal(stored.payout_address, circleAddress);
    assert.equal(stored.circle_wallet_id, circleWalletId);

    const dashboard = await request(test.baseUrl, "GET", "/dashboard");
    assert.equal(dashboard.status, 200);
    const dashboardAgent = dashboard.body.agents.find((agent) => agent.agentId === "wallet_agent_circle");
    assert.ok(dashboardAgent);
    assert.equal(dashboardAgent.payoutAddress, circleAddress);
    assert.equal(dashboardAgent.circleWalletId, circleWalletId);
    assert.equal(dashboardAgent.walletSource, "circle_wallet");

    const fallbackAddress = "0x4444444444444444444444444444444444444444";
    walletService.createAgentWallet = async () => {
      const error = new Error("mock Circle create failure");
      error.code = "CIRCLE_WALLET_CREATE_FAILED";
      throw error;
    };
    const fallback = await request(test.baseUrl, "POST", "/agents/register-with-wallet", {
      agentId: "wallet_agent_circle_fallback",
      name: "Circle Fallback Agent",
      capabilities: ["link_verification"],
      payoutAddress: fallbackAddress,
    });
    assert.equal(fallback.status, 201);
    assert.equal(fallback.body.walletProvisioning.status, "failed");
    assert.equal(fallback.body.circleWallet, null);
    assert.equal(fallback.body.agent.payoutAddress, fallbackAddress);
    assert.equal(fallback.body.agent.circleWalletId, null);
  } finally {
    await stopServer(test);
  }
}

async function runCircleNotConfiguredCases() {
  const manualAddress = "0x3333333333333333333333333333333333333333";
  const walletService = {
    isCircleConfigured: () => false,
    createAgentWallet: async () => { throw new Error("should not be called"); },
    createIssuerWallet: async () => { throw new Error("should not be called"); },
    getCircleStatus: () => ({ configured: false, walletSetId: null }),
    getWalletBalance: async () => null,
    getWalletDetails: async () => null,
    sendUsdc: async () => null,
  };
  const test = await startServer(walletService);
  try {
    const missingFallback = await request(test.baseUrl, "POST", "/agents/register-with-wallet", {
      agentId: "wallet_agent_no_fallback",
      name: "No Fallback Agent",
      capabilities: ["link_verification"],
    });
    assert.equal(missingFallback.status, 400);
    assert.equal(missingFallback.body.error, "Circle wallet provisioning is not configured and payoutAddress is required.");

    const manual = await request(test.baseUrl, "POST", "/agents/register-with-wallet", {
      agentId: "wallet_agent_manual",
      name: "Manual Fallback Agent",
      capabilities: ["link_verification"],
      payoutAddress: manualAddress,
    });
    assert.equal(manual.status, 201);
    assert.equal(manual.body.walletProvisioning.status, "not_configured");
    assert.equal(manual.body.circleWallet, null);
    assert.equal(manual.body.agent.payoutAddress, manualAddress);
    assert.equal(manual.body.agent.circleWalletId, null);

    const dashboard = await request(test.baseUrl, "GET", "/dashboard");
    assert.equal(dashboard.status, 200);
    const dashboardAgent = dashboard.body.agents.find((agent) => agent.agentId === "wallet_agent_manual");
    assert.ok(dashboardAgent);
    assert.equal(dashboardAgent.payoutAddress, manualAddress);
    assert.equal(dashboardAgent.circleWalletId, null);
    assert.equal(dashboardAgent.walletSource, "manual_payout");
  } finally {
    await stopServer(test);
  }
}

async function startServer(walletService) {
  const { app, db } = createApp({ walletService });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolveReady) => server.once("listening", resolveReady));
  return { server, db, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function stopServer({ server, db }) {
  await new Promise((resolveClose) => server.close(resolveClose));
  db.close();
}

async function request(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
