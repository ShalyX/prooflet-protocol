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
  const c = g();
  if (!c) return null;
  let wsId = process.env.CIRCLE_WALLET_SET_ID;
  if (!wsId) {
    const ws = await c.listWalletSets();
    const sets = ws.data?.walletSets || [];
    wsId = sets[0]?.id;
  }
  const r = await c.createWallets({ accountType: "SCA", blockchains: ["ARC-TESTNET"], count: 1, walletSetId: wsId });
  const w = r.data?.wallets?.[0];
  if (!w) return null;
  return { walletId: w.id, address: w.address, blockchain: w.blockchain, state: w.state, accountType: w.accountType };
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
