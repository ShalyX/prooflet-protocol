/**
 * Circle Wallet Service v2
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
    const r = await c.createWallets({ accountType: "SCA", blockchains: ["ARC-TESTNET"], count: 1, walletSetId: wsId });
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
  return createAgentWallet(issuerId, "Issuer"); // Same logic
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
    fee: { type: "level", level: "MEDIUM" },
  });
  const tx = r.data?.transaction;
  return tx ? { transactionId: tx.id, state: tx.state, hash: tx.transactionHash, explorer: "https://testnet.arcscan.app/tx/" + tx.transactionHash } : null;
}

export async function getWalletBalance(walletId) {
  const c = g();
  if (!c) return null;
  try {
    const r = await c.getWalletTokenBalance({ walletId, tokenId: "USDC-ARC" });
    const b = r.data?.tokenBalances?.[0];
    return b ? { amount: b.amount || "0", decimals: b.decimals || 6 } : { amount: "0", decimals: 6 };
  } catch { return { amount: "0", decimals: 6 }; }
}

export async function getWalletDetails(walletId) {
  const c = g();
  if (!c) return null;
  try {
    const r = await c.getWallet({ id: walletId });
    const w = r.data?.wallet;
    return w ? { address: w.address, blockchain: w.blockchain } : null;
  } catch { return null; }
}

export async function requestTestnetFunds(walletId) {
  const c = g();
  if (!c) return null;
  try {
    const r = await c.requestTestnetTokens({ walletId, blockchains: ["ARC-TESTNET"] });
    return r.data;
  } catch (e) { console.error(e.message); return null; }
}

export function isCircleConfigured() { return Boolean(__key && __secret); }

export function getCircleStatus() {
  return { configured: isCircleConfigured(), clientVersion: "10.7.1", walletSetId: process.env.CIRCLE_WALLET_SET_ID || null, supportedActions: ["createAgentWallet", "sendUsdc", "getWalletBalance", "requestTestnetFunds"] };
}
