/**
 * Circle Wallet Service v2
 * Post-submission: supports contract execution for Escrow V2 fundJob from issuer wallets.
 */
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const __key = process.env.CIRCLE_API_KEY;
const __secret = process.env.CIRCLE_ENTITY_SECRET;
let __client = null;

function g() {
  if (!__key || !__secret) return null;
  if (!__client) __client = initiateDeveloperControlledWalletsClient({ apiKey: __key, entitySecret: __secret });
  return __client;
}

export async function createAgentWallet(agentId, name) {
  if (!__key) {
    const e = new Error("Circle API key missing. Check CIRCLE_API_KEY.");
    e.code = "CIRCLE_CONFIG_MISSING";
    throw e;
  }
  if (!__secret) {
    const e = new Error("Circle entity secret missing. Check CIRCLE_ENTITY_SECRET.");
    e.code = "CIRCLE_ENTITY_SECRET_MISSING";
    throw e;
  }
  const c = g();
  let wsId = process.env.CIRCLE_WALLET_SET_ID;
  if (!wsId) {
    try {
      const ws = await c.listWalletSets();
      const sets = ws.data?.walletSets || [];
      wsId = sets[0]?.id;
    } catch (err) {
      const e = new Error("Failed to list wallet sets: " + err.message);
      e.code = "CIRCLE_WALLET_SET_MISSING";
      throw e;
    }
  }
  if (!wsId) {
    const e = new Error("No wallet sets found and CIRCLE_WALLET_SET_ID not provided.");
    e.code = "CIRCLE_WALLET_SET_MISSING";
    throw e;
  }
  try {
    const r = await c.createWallets({ accountType: "EOA", blockchains: ["ARC-TESTNET"], count: 1, walletSetId: wsId });
    const w = r.data?.wallets?.[0];
    if (!w) throw new Error("API returned no wallets.");
    return { walletId: w.id, address: w.address, blockchain: w.blockchain, state: w.state, accountType: w.accountType };
  } catch (err) {
    const e = new Error("Circle issuer wallet could not be created: " + err.message);
    e.code = "CIRCLE_WALLET_CREATE_FAILED";
    throw e;
  }
}

export async function createIssuerWallet(issuerId) {
  return createAgentWallet(issuerId, "Issuer");
}

export async function sendUsdc(opts) {
  const c = g();
  if (!c) throw new Error("Circle not configured");
  const r = await c.createTransaction({
    idempotencyKey: opts.idempotencyKey || "send-" + Date.now(),
    walletId: opts.sourceWalletId,
    tokenId: "USDC-ARC",
    amounts: [String(opts.amount)],
    destinationAddress: opts.destinationAddress,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const tx = r.data?.transaction;
  return tx
    ? {
        transactionId: tx.id,
        state: tx.state,
        hash: tx.transactionHash || null,
        explorer: tx.transactionHash ? `https://testnet.arcscan.app/tx/${tx.transactionHash}` : null,
      }
    : null;
}

/**
 * Execute a contract call from a Circle developer-controlled wallet.
 */
export async function executeContract({
  walletId,
  contractAddress,
  abiFunctionSignature,
  abiParameters = [],
  callData = null,
  amount = undefined,
  idempotencyKey = null,
  feeLevel = "MEDIUM",
  waitForState = "COMPLETE",
  pollMs = 2500,
  timeoutMs = 180_000,
}) {
  const c = g();
  if (!c) {
    const e = new Error("Circle not configured");
    e.code = "CIRCLE_CONFIG_MISSING";
    throw e;
  }
  const payload = {
    idempotencyKey: idempotencyKey || `cx-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    walletId,
    contractAddress,
    fee: { type: "level", config: { feeLevel } },
  };
  if (callData) {
    payload.callData = callData;
  } else {
    payload.abiFunctionSignature = abiFunctionSignature;
    payload.abiParameters = abiParameters;
  }
  if (amount != null) payload.amount = String(amount);

  const created = await c.createContractExecutionTransaction(payload);
  const tx = created.data?.transaction || created.data;
  if (!tx?.id) throw new Error("Circle contract execution returned no transaction id.");

  if (!waitForState) {
    return {
      transactionId: tx.id,
      state: tx.state,
      hash: tx.transactionHash || null,
      explorer: tx.transactionHash ? `https://testnet.arcscan.app/tx/${tx.transactionHash}` : null,
    };
  }

  const started = Date.now();
  let latest = tx;
  while (Date.now() - started < timeoutMs) {
    const got = await c.getTransaction({ id: tx.id }).catch(() => null);
    latest = got?.data?.transaction || got?.data || latest;
    const state = String(latest.state || "");
    if (state === "COMPLETE" || state === "CONFIRMED") break;
    if (["FAILED", "DENIED", "CANCELLED", "CANCELED"].includes(state)) {
      const e = new Error(`Circle contract execution ${state}: ${latest.errorReason || latest.failureReason || "unknown"}`);
      e.code = "CIRCLE_TX_FAILED";
      e.transaction = latest;
      throw e;
    }
    // Optional early exit if only waiting for SENT and we have a hash
    if (waitForState === "SENT" && latest.transactionHash && ["SENT", "CONFIRMED", "COMPLETE"].includes(state)) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return {
    transactionId: latest.id || tx.id,
    state: latest.state,
    hash: latest.transactionHash || null,
    explorer: latest.transactionHash ? `https://testnet.arcscan.app/tx/${latest.transactionHash}` : null,
    raw: latest,
  };
}

export async function getWalletBalance(walletId) {
  const c = g();
  if (!c) return null;
  try {
    const r = await c.getWalletTokenBalance({ id: walletId });
    const balances = r.data?.tokenBalances || [];
    const b = balances.find((item) => item.token?.tokenAddress?.toLowerCase() === "0x3600000000000000000000000000000000000000")
      || balances.find((item) => item.token?.symbol === "USDC" && item.token?.blockchain === "ARC-TESTNET")
      || balances[0];
    return b ? { amount: b.amount || "0", decimals: b.token?.decimals || 6 } : { amount: "0", decimals: 6 };
  } catch {
    return { amount: "0", decimals: 6 };
  }
}

export async function getWalletDetails(walletId) {
  const c = g();
  if (!c) return null;
  try {
    const r = await c.getWallet({ id: walletId });
    const w = r.data?.wallet;
    return w ? { address: w.address, blockchain: w.blockchain } : null;
  } catch {
    return null;
  }
}

export async function requestTestnetFunds(walletId) {
  const c = g();
  if (!c) return null;
  try {
    const r = await c.requestTestnetTokens({ walletId, blockchains: ["ARC-TESTNET"] });
    return r.data;
  } catch (e) {
    console.error(e.message);
    return null;
  }
}

export function isCircleConfigured() {
  return Boolean(__key && __secret);
}

export function getCircleStatus() {
  return {
    configured: isCircleConfigured(),
    clientVersion: "10.7.1",
    walletSetId: process.env.CIRCLE_WALLET_SET_ID || null,
    supportedActions: [
      "createAgentWallet",
      "sendUsdc",
      "getWalletBalance",
      "requestTestnetFunds",
      "executeContract",
    ],
  };
}
