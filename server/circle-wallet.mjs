/**
 * Circle Wallet Service v2
 * Post-submission: faucet path for Arc Testnet issuer funding (no treasury top-up).
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
  // Prefer ERC-20 USDC on Arc Testnet (escrow/fund path). Fall back to provided tokenId.
  const tokenId = opts.tokenId || process.env.CIRCLE_ARC_USDC_TOKEN_ID || "ef87c8c3-85de-598a-af50-c5135eecfa74";
  const r = await c.createTransaction({
    idempotencyKey: opts.idempotencyKey || "send-" + Date.now(),
    walletId: opts.sourceWalletId,
    tokenId,
    // SDK accepts amount (docs) / amounts (types) — amount is the working shape on this client.
    amount: [String(opts.amount)],
    amounts: [String(opts.amount)],
    destinationAddress: opts.destinationAddress,
    fee: { type: "level", config: { feeLevel: opts.feeLevel || "HIGH" } },
  });
  const tx = r.data?.transaction || r.data;
  return tx
    ? {
        transactionId: tx.id,
        state: tx.state,
        hash: tx.txHash || tx.transactionHash || null,
        explorer: (tx.txHash || tx.transactionHash)
          ? `https://testnet.arcscan.app/tx/${tx.txHash || tx.transactionHash}`
          : null,
      }
    : null;
}

export async function executeContract({
  walletId,
  contractAddress,
  abiFunctionSignature,
  abiParameters = [],
  callData = null,
  amount = undefined,
  idempotencyKey = null,
  feeLevel = "HIGH",
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
  if (callData) payload.callData = callData;
  else {
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
      hash: tx.txHash || tx.transactionHash || null,
      explorer: (tx.txHash || tx.transactionHash)
        ? `https://testnet.arcscan.app/tx/${tx.txHash || tx.transactionHash}`
        : null,
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
    if (waitForState === "SENT" && (latest.txHash || latest.transactionHash) && ["SENT", "CONFIRMED", "COMPLETE"].includes(state)) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const hash = latest.txHash || latest.transactionHash || null;
  return {
    transactionId: latest.id || tx.id,
    state: latest.state,
    hash,
    explorer: hash ? `https://testnet.arcscan.app/tx/${hash}` : null,
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

/** Circle public faucet for Arc Testnet USDC (manual claim when API is gated). */
export function manualFaucetInfo(address) {
  return {
    url: "https://faucet.circle.com/",
    network: "Arc Testnet",
    asset: "USDC",
    address: address || null,
    instructions: [
      "Open https://faucet.circle.com/",
      "Select Arc Testnet and USDC",
      address ? `Paste address ${address}` : "Paste the issuer Circle wallet address",
      "Complete reCAPTCHA and claim (typically ~10–20 USDC; rate-limited per address)",
      "Return to Prooflet and refresh wallet balance, then Fund Escrow V2",
    ],
    note: "Programmatic /v1/faucet/drips requires a Circle mainnet-upgraded API key. Free-tier keys get Forbidden and must use the web faucet.",
  };
}

/**
 * Request Arc Testnet USDC for a wallet.
 * Prefers Circle SDK faucet; falls back to manual faucet instructions when Forbidden.
 */
export async function requestTestnetFunds(walletId, { usdc = true, native = false } = {}) {
  const c = g();
  if (!c) {
    const e = new Error("Circle not configured");
    e.code = "CIRCLE_CONFIG_MISSING";
    throw e;
  }
  const details = await getWalletDetails(walletId);
  const address = details?.address;
  if (!address) {
    const e = new Error("Could not resolve wallet address for faucet claim.");
    e.code = "WALLET_ADDRESS_MISSING";
    throw e;
  }

  try {
    const r = await c.requestTestnetTokens({
      address,
      blockchain: "ARC-TESTNET",
      usdc: Boolean(usdc),
      native: Boolean(native),
    });
    return {
      ok: true,
      mode: "circle_api",
      status: r.status,
      address,
      walletId,
      balanceBefore: null,
      manual: null,
      message: "Faucet request accepted by Circle API.",
    };
  } catch (err) {
    const status = err.response?.status || err.status || null;
    const message = String(err.message || err);
    const forbidden = status === 403 || /forbidden/i.test(message);
    return {
      ok: false,
      mode: "manual_required",
      status,
      address,
      walletId,
      error: message,
      code: forbidden ? "FAUCET_API_FORBIDDEN" : "FAUCET_API_FAILED",
      manual: manualFaucetInfo(address),
      message: forbidden
        ? "Circle faucet API is not available on this API key (mainnet upgrade required). Use the web faucet with the issuer wallet address."
        : `Circle faucet API failed: ${message}. Use the web faucet with the issuer wallet address.`,
    };
  }
}

/**
 * Poll wallet USDC until min amount or timeout (for after manual faucet claim).
 */
export async function waitForUsdcBalance(walletId, { minAmount = "0.003", timeoutMs = 120_000, pollMs = 5000 } = {}) {
  const { parseUnits } = await import("viem");
  const need = parseUnits(String(minAmount), 6);
  const started = Date.now();
  let last = { amount: "0", decimals: 6 };
  while (Date.now() - started < timeoutMs) {
    last = (await getWalletBalance(walletId)) || last;
    try {
      if (parseUnits(String(last.amount || "0"), Number(last.decimals || 6)) >= need) {
        return { ok: true, balance: last, waitedMs: Date.now() - started };
      }
    } catch {
      // ignore parse errors
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, balance: last, waitedMs: Date.now() - started };
}

export function isCircleConfigured() {
  return Boolean(__key && __secret);
}

export function getCircleStatus() {
  return {
    configured: isCircleConfigured(),
    clientVersion: "10.7.1",
    walletSetId: process.env.CIRCLE_WALLET_SET_ID || null,
    faucet: {
      api: "requestTestnetTokens",
      network: "ARC-TESTNET",
      manualUrl: "https://faucet.circle.com/",
      note: "API faucet often Forbidden without Circle mainnet upgrade; web faucet remains the reliable path.",
    },
    supportedActions: [
      "createAgentWallet",
      "sendUsdc",
      "getWalletBalance",
      "requestTestnetFunds",
      "executeContract",
      "manualFaucetInfo",
    ],
  };
}
