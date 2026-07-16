#!/usr/bin/env node
/**
 * ProofletEscrowV2 auto-release operator (Arc Testnet).
 * Post-submission development — not part of the original Lepton Agents Hackathon submission.
 *
 * Polls GET /escrow/v2/payable and releases Funded escrows for accepted payable proofs.
 * Keys stay on the operator machine — not the hosted API.
 *
 * Usage:
 *   npm run escrow:v2:auto-release              # dry-run (default)
 *   npm run escrow:v2:auto-release -- --execute # sign releases
 *   npm run escrow:v2:auto-release -- --once    # single pass
 *
 * Env:
 *   PROOFLET_API_URL / USEFUL_WAITING_API_URL
 *   SETTLEMENT_OPERATOR_PRIVATE_KEY / TREASURY_PRIVATE_KEY
 *   ESCROW_V2_ADDRESS
 *   ESCROW_V2_AUTO_RELEASE_MODE=dry-run|execute
 *   ESCROW_V2_AUTO_RELEASE_INTERVAL_MS=30000
 */
import { createWalletClient, http, parseUnits, formatUnits, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  jobIdToBytes32,
  loadEscrowV2Abi,
  loadEscrowV2Deployment,
  createArcPublicClient,
} from "../server/escrow-v2.mjs";

const flags = parseArgs(process.argv.slice(2));
const API_URL = (flags.apiUrl || process.env.PROOFLET_API_URL || process.env.USEFUL_WAITING_API_URL || "https://prooflet-api.onrender.com").replace(/\/$/, "");
const mode = flags.execute || process.env.ESCROW_V2_AUTO_RELEASE_MODE === "execute" ? "execute" : "dry-run";
const once = Boolean(flags.once) || process.env.ESCROW_V2_AUTO_RELEASE_ONCE === "true";
const intervalMs = Number(flags.intervalMs || process.env.ESCROW_V2_AUTO_RELEASE_INTERVAL_MS || 30_000);
const RPC_URL = process.env.ARC_RPC_URL || process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";
const PRIVATE_KEY = process.env.SETTLEMENT_OPERATOR_PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY || process.env.ESCROW_DEPLOYER_PRIVATE_KEY;
const cfg = loadEscrowV2Deployment();
const abi = loadEscrowV2Abi();

if (!cfg.address) {
  console.error("Set ESCROW_V2_ADDRESS or deploy contracts/deployment-v2.json");
  process.exit(1);
}
if (!PRIVATE_KEY) {
  console.error("Set SETTLEMENT_OPERATOR_PRIVATE_KEY or TREASURY_PRIVATE_KEY");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);
const chain = {
  id: cfg.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};
const publicClient = createArcPublicClient();
const walletClient = createWalletClient({ transport: http(RPC_URL), chain, account });

async function waitReceipt(hash, attempts = 12) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    } catch (error) {
      lastError = error;
      const message = String(error?.shortMessage || error?.message || error);
      if (!/request limit|429|rate|timeout/i.test(message) && i > 1) throw error;
      await new Promise((r) => setTimeout(r, 3000 + i * 2000));
    }
  }
  throw lastError;
}

async function fetchPayable() {
  const key =
    process.env.ESCROW_OPERATOR_API_KEY ||
    process.env.OPERATOR_API_KEY ||
    process.env.ADJUDICATOR_API_KEY ||
    "";
  const headers = key ? { authorization: `Bearer ${key}`, "x-api-key": key } : {};
  const res = await fetch(`${API_URL}/escrow/v2/payable`, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`payable list failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function onchainStatus(jobId) {
  const bid = jobIdToBytes32(jobId);
  const data = await publicClient.readContract({
    address: cfg.address,
    abi,
    functionName: "getEscrow",
    args: [bid],
  });
  const statusValue = Number(data.status ?? data[5]);
  return {
    bid,
    statusValue,
    status: ["None", "Funded", "Released", "Refunded"][statusValue] || String(statusValue),
    amount: BigInt(data.amount ?? data[3] ?? 0),
    agent: data.agent ?? data[2],
  };
}

async function releaseOne(item) {
  if (!item.ready || !isAddress(item.agentPayoutAddress)) {
    return { skipped: true, reason: "missing_agent_payout", jobId: item.jobId };
  }
  const chainState = await onchainStatus(item.jobId);
  if (chainState.statusValue === 2) {
    // Already released on-chain — sync ledger.
    return { skipped: true, reason: "already_released_onchain", jobId: item.jobId, chainState };
  }
  if (chainState.statusValue !== 1) {
    return { skipped: true, reason: `onchain_not_funded:${chainState.status}`, jobId: item.jobId, chainState };
  }

  const expected = parseUnits(String(item.rewardAmount), 6);
  if (expected !== chainState.amount) {
    return {
      skipped: true,
      reason: "amount_mismatch",
      jobId: item.jobId,
      expected: formatUnits(expected, 6),
      onchain: formatUnits(chainState.amount, 6),
    };
  }

  if (mode !== "execute") {
    return {
      dryRun: true,
      jobId: item.jobId,
      proofId: item.proofId,
      agent: item.agentPayoutAddress,
      amount: formatUnits(chainState.amount, 6),
      onchainStatus: chainState.status,
    };
  }

  const proofBytes = jobIdToBytes32(item.proofId);
  const hash = await walletClient.writeContract({
    address: cfg.address,
    abi,
    functionName: "release",
    args: [chainState.bid, proofBytes, item.agentPayoutAddress, chainState.amount],
  });
  const receipt = await waitReceipt(hash);

  let ledger = null;
  try {
    const res = await fetch(`${API_URL}/jobs/${encodeURIComponent(item.jobId)}/escrow-release-receipt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash: hash, agentAddress: item.agentPayoutAddress }),
    });
    const body = await res.json().catch(() => ({}));
    ledger = { ok: res.ok, status: res.status, escrowStatus: body.job?.escrowStatus };
  } catch (error) {
    ledger = { ok: false, error: String(error.message || error) };
  }

  return {
    ok: true,
    action: "release",
    jobId: item.jobId,
    proofId: item.proofId,
    agent: item.agentPayoutAddress,
    amount: formatUnits(chainState.amount, 6),
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    explorer: `https://testnet.arcscan.app/tx/${hash}`,
    ledger,
  };
}

async function tick() {
  const queue = await fetchPayable();
  const results = [];
  for (const item of queue.items || []) {
    try {
      results.push(await releaseOne(item));
    } catch (error) {
      results.push({ ok: false, jobId: item.jobId, proofId: item.proofId, error: String(error.message || error) });
    }
  }
  console.log(JSON.stringify({
    ok: true,
    postSubmission: true,
    mode,
    operator: account.address,
    contract: cfg.address,
    api: API_URL,
    queueCount: queue.count ?? (queue.items || []).length,
    results,
    at: new Date().toISOString(),
  }, null, 2));
  return results;
}

if (once) {
  await tick();
} else {
  console.error(JSON.stringify({ starting: true, mode, intervalMs, api: API_URL, operator: account.address }, null, 2));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (error) {
      console.error(JSON.stringify({ ok: false, error: String(error.message || error) }, null, 2));
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--execute") out.execute = true;
    else if (a === "--once") out.once = true;
    else if (a === "--dry-run") out.execute = false;
    else if (a.startsWith("--api-url=")) out.apiUrl = a.slice("--api-url=".length);
    else if (a.startsWith("--interval-ms=")) out.intervalMs = a.slice("--interval-ms=".length);
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: escrow-v2-auto-release [--dry-run|--execute] [--once] [--api-url=URL] [--interval-ms=N]`);
      process.exit(0);
    }
  }
  return out;
}
