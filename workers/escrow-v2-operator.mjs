/**
 * ProofletEscrowV2 settlement operator (Arc Testnet).
 * Post-submission development — not part of the original Lepton Agents Hackathon submission.
 *
 * Usage:
 *   node --env-file=.env workers/escrow-v2-operator.mjs --status=JOB_ID
 *   node --env-file=.env workers/escrow-v2-operator.mjs --release=JOB_ID --agent=0x... --proof=PROOF_ID --amount=0.01
 *   node --env-file=.env workers/escrow-v2-operator.mjs --refund=JOB_ID
 *   node --env-file=.env workers/escrow-v2-operator.mjs --fund=JOB_ID --amount=0.01 --expires-hours=24
 *
 * Requires SETTLEMENT_OPERATOR_PRIVATE_KEY or TREASURY_PRIVATE_KEY for operator actions.
 * Fund path requires a funded issuer/deployer key with USDC (uses same key by default).
 */
import { createWalletClient, http, parseUnits, formatUnits, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  jobIdToBytes32,
  loadEscrowV2Abi,
  loadEscrowV2Deployment,
  createArcPublicClient,
} from "../server/escrow-v2.mjs";

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


const USDC_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

function parseArgs(args) {
  const result = {};
  for (const arg of args) {
    if (arg.startsWith("--release=")) result.release = arg.slice("--release=".length);
    if (arg.startsWith("--refund=")) result.refund = arg.slice("--refund=".length);
    if (arg.startsWith("--status=")) result.status = arg.slice("--status=".length);
    if (arg.startsWith("--fund=")) result.fund = arg.slice("--fund=".length);
    if (arg.startsWith("--agent=")) result.agent = arg.slice("--agent=".length);
    if (arg.startsWith("--proof=")) result.proof = arg.slice("--proof=".length);
    if (arg.startsWith("--amount=")) result.amount = arg.slice("--amount=".length);
    if (arg.startsWith("--expires-hours=")) result.expiresHours = Number(arg.slice("--expires-hours=".length));
    if (arg === "--list") result.list = true;
  }
  return result;
}

async function getEscrow(jobId) {
  const bid = jobIdToBytes32(jobId);
  const data = await publicClient.readContract({
    address: cfg.address,
    abi,
    functionName: "getEscrow",
    args: [bid],
  });
  return { bid, data };
}

async function status(jobId) {
  const { bid, data } = await getEscrow(jobId);
  const labels = ["None", "Funded", "Released", "Refunded"];
  const statusValue = Number(data.status ?? data[5]);
  console.log(JSON.stringify({
    jobId,
    jobIdBytes32: bid,
    status: labels[statusValue] || statusValue,
    issuer: data.issuer ?? data[1],
    agent: data.agent ?? data[2],
    amount: formatUnits(BigInt(data.amount ?? data[3] ?? 0), 6),
    expiresAt: Number((data.expiresAt ?? data[4]) || 0),
    contract: cfg.address,
  }, null, 2));
}

async function release(jobId, agent, proofId, amountUsdc) {
  if (!isAddress(agent)) throw new Error("--agent must be a valid EVM address");
  if (!proofId) throw new Error("--proof is required for V2 release");
  const { bid, data } = await getEscrow(jobId);
  const statusValue = Number(data.status ?? data[5]);
  if (statusValue !== 1) throw new Error(`Escrow not Funded (status=${statusValue})`);
  const onchainAmount = BigInt(data.amount ?? data[3]);
  const amount = amountUsdc ? parseUnits(String(amountUsdc), 6) : onchainAmount;
  if (amount !== onchainAmount) throw new Error("amount must match on-chain funded amount");
  const proofBytes = jobIdToBytes32(proofId);
  console.log(`Releasing ${formatUnits(amount, 6)} USDC to ${agent} for ${jobId}...`);
  const hash = await walletClient.writeContract({
    address: cfg.address,
    abi,
    functionName: "release",
    args: [bid, proofBytes, agent, amount],
  });
  console.log(`TX: ${hash}`);
  const receipt = await waitReceipt(hash);
  console.log(JSON.stringify({
    ok: true,
    action: "release",
    jobId,
    agent,
    proofId,
    amount: formatUnits(amount, 6),
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    explorer: `https://testnet.arcscan.app/tx/${hash}`,
  }, null, 2));

  const apiUrl = process.env.PROOFLET_API_URL || process.env.UWP_API_URL;
  if (apiUrl) {
    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, "")}/jobs/${encodeURIComponent(jobId)}/escrow-release-receipt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txHash: hash, agentAddress: agent }),
      });
      const body = await res.json().catch(() => ({}));
      console.log(JSON.stringify({ protocolLedger: res.ok ? "updated" : "failed", status: res.status, body }, null, 2));
    } catch (error) {
      console.log(JSON.stringify({ protocolLedger: "error", message: String(error.message || error) }, null, 2));
    }
  }
}

async function refund(jobId) {
  const { bid, data } = await getEscrow(jobId);
  const statusValue = Number(data.status ?? data[5]);
  if (statusValue !== 1) throw new Error(`Escrow not Funded (status=${statusValue})`);
  console.log(`Refunding ${formatUnits(BigInt(data.amount ?? data[3]), 6)} USDC for ${jobId}...`);
  const hash = await walletClient.writeContract({
    address: cfg.address,
    abi,
    functionName: "refundJob",
    args: [bid],
  });
  console.log(`TX: ${hash}`);
  const receipt = await waitReceipt(hash);
  console.log(JSON.stringify({
    ok: true,
    action: "refund",
    jobId,
    txHash: hash,
    blockNumber: Number(receipt.blockNumber),
    explorer: `https://testnet.arcscan.app/tx/${hash}`,
  }, null, 2));
}

async function fund(jobId, amountUsdc, expiresHours = 72) {
  if (!amountUsdc) throw new Error("--amount required for fund");
  const amount = parseUnits(String(amountUsdc), 6);
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + Math.max(1, expiresHours) * 3600);
  const bid = jobIdToBytes32(jobId);
  const balance = await publicClient.readContract({
    address: cfg.usdc,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (balance < amount) {
    throw new Error(`Insufficient USDC: have ${formatUnits(balance, 6)}, need ${amountUsdc}`);
  }
  console.log(`Approving ${amountUsdc} USDC to ${cfg.address}...`);
  const approveHash = await walletClient.writeContract({
    address: cfg.usdc,
    abi: USDC_ABI,
    functionName: "approve",
    args: [cfg.address, amount],
  });
  await waitReceipt(approveHash);
  console.log(`Funding job ${jobId} (${bid})...`);
  const hash = await walletClient.writeContract({
    address: cfg.address,
    abi,
    functionName: "fundJob",
    args: [bid, amount, expiresAt],
  });
  const receipt = await waitReceipt(hash);
  console.log(JSON.stringify({
    ok: true,
    action: "fund",
    jobId,
    jobIdBytes32: bid,
    amount: String(amountUsdc),
    txHash: hash,
    approveTxHash: approveHash,
    blockNumber: Number(receipt.blockNumber),
    expiresAt: Number(expiresAt),
    explorer: `https://testnet.arcscan.app/tx/${hash}`,
  }, null, 2));
}

const flags = parseArgs(process.argv.slice(2));
try {
  if (flags.list) {
    console.log(JSON.stringify({
      operator: account.address,
      contract: cfg.address,
      usdc: cfg.usdc,
      chainId: cfg.chainId,
      network: "Arc Testnet",
    }, null, 2));
  } else if (flags.status) {
    await status(flags.status);
  } else if (flags.release) {
    await release(flags.release, flags.agent, flags.proof, flags.amount);
  } else if (flags.refund) {
    await refund(flags.refund);
  } else if (flags.fund) {
    await fund(flags.fund, flags.amount, flags.expiresHours || 72);
  } else {
    console.log("Usage:");
    console.log("  node workers/escrow-v2-operator.mjs --list");
    console.log("  node workers/escrow-v2-operator.mjs --status=JOB_ID");
    console.log("  node workers/escrow-v2-operator.mjs --fund=JOB_ID --amount=0.01");
    console.log("  node workers/escrow-v2-operator.mjs --release=JOB_ID --agent=0x... --proof=PROOF_ID");
    console.log("  node workers/escrow-v2-operator.mjs --refund=JOB_ID");
    process.exit(1);
  }
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
