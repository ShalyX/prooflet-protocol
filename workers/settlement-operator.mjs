/**
 * Prooflet — Settlement Operator
 *
 * Manages the ProofletEscrow contract: release() and refund() calls.
 *
 * Usage:
 *   node --env-file=.env workers/settlement-operator.mjs --release=JOB_ID
 *   node --env-file=.env workers/settlement-operator.mjs --refund=JOB_ID
 *   node --env-file=.env workers/settlement-operator.mjs --status=JOB_ID
 *   node --env-file=.env workers/settlement-operator.mjs --list
 *
 * Requires:
 *   ESCROW_CONTRACT_ADDRESS — deployed ProofletEscrow address
 *   SETTLEMENT_OPERATOR_PRIVATE_KEY — operator wallet key
 */
import { createPublicClient, createWalletClient, http, parseAbi, encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const CHAIN_ID = 5042002;
const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.SETTLEMENT_OPERATOR_PRIVATE_KEY;

if (!ESCROW_ADDRESS) {
  console.error("Set ESCROW_CONTRACT_ADDRESS in .env (from deployment artifact)");
  process.exit(1);
}
if (!PRIVATE_KEY) {
  console.error("Set SETTLEMENT_OPERATOR_PRIVATE_KEY in .env");
  process.exit(1);
}

// Load ABI from deployment artifact or compiled output
let abi;
const deploymentPath = resolve(__dirname, "..", "contracts", "deployment.json");
const abiPath = resolve(__dirname, "..", "contracts", "out", "Escrow.abi");
if (existsSync(abiPath)) {
  abi = JSON.parse(readFileSync(abiPath, "utf-8"));
} else {
  console.error("ABI not found. Compile contract first: solc --abi -o contracts/out contracts/Escrow.sol");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ transport: http(RPC_URL), chain: { id: CHAIN_ID } });
const walletClient = createWalletClient({ transport: http(RPC_URL), chain: { id: CHAIN_ID }, account });

function jobIdToBytes32(jobId) {
  // Pad or truncate to 32 bytes
  const encoded = new TextEncoder().encode(jobId);
  const hash = Buffer.alloc(32);
  for (let i = 0; i < Math.min(encoded.length, 32); i++) {
    hash[i] = encoded[i];
  }
  return `0x${hash.toString("hex")}`;
}

async function getEscrow(bytes32JobId) {
  try {
    const data = await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi,
      functionName: "getEscrow",
      args: [bytes32JobId],
    });
    return data;
  } catch (e) {
    return null;
  }
}

async function release(jobId) {
  const bid = jobIdToBytes32(jobId);
  const escrow = await getEscrow(bid);
  if (!escrow || escrow.status === 0) {
    console.error(`No funded escrow found for job: ${jobId}`);
    process.exit(1);
  }
  if (escrow.status === 2) {
    console.log(`Escrow already released for ${jobId}`);
    return;
  }

  console.log(`Releasing ${escrow.amount} units to ${escrow.agent}...`);
  const hash = await walletClient.writeContract({
    address: ESCROW_ADDRESS,
    abi,
    functionName: "release",
    args: [bid],
  });
  console.log(`TX: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✅ Released. Block: ${receipt.blockNumber}`);
  console.log(`Explorer: https://testnet.arcscan.app/tx/${hash}`);
}

async function refund(jobId) {
  const bid = jobIdToBytes32(jobId);
  const escrow = await getEscrow(bid);
  if (!escrow || escrow.status === 0) {
    console.error(`No funded escrow found for job: ${jobId}`);
    process.exit(1);
  }
  if (escrow.status === 3) {
    console.log(`Escrow already refunded for ${jobId}`);
    return;
  }

  console.log(`Refunding ${escrow.amount} units to ${escrow.issuer}...`);
  const hash = await walletClient.writeContract({
    address: ESCROW_ADDRESS,
    abi,
    functionName: "refund",
    args: [bid],
  });
  console.log(`TX: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✅ Refunded. Block: ${receipt.blockNumber}`);
  console.log(`Explorer: https://testnet.arcscan.app/tx/${hash}`);
}

async function status(jobId) {
  const bid = jobIdToBytes32(jobId);
  const escrow = await getEscrow(bid);
  if (!escrow || escrow.status === 0) {
    console.log(`No escrow for job: ${jobId}`);
    return;
  }
  const statusLabels = ["None", "Funded", "Released", "Refunded"];
  console.log(`Job:      ${jobId}`);
  console.log(`Status:   ${statusLabels[escrow.status]}`);
  console.log(`Issuer:   ${escrow.issuer}`);
  console.log(`Agent:    ${escrow.agent}`);
  console.log(`Amount:   ${escrow.amount}`);
}

function parseArgs(args) {
  const result = {};
  for (const arg of args) {
    if (arg.startsWith("--release=")) result.release = arg.slice("--release=".length);
    if (arg.startsWith("--refund=")) result.refund = arg.slice("--refund=".length);
    if (arg.startsWith("--status=")) result.status = arg.slice("--status=".length);
    if (arg === "--list") result.list = true;
  }
  return result;
}

const flags = parseArgs(process.argv.slice(2));

if (flags.release) {
  await release(flags.release);
} else if (flags.refund) {
  await refund(flags.refund);
} else if (flags.status) {
  await status(flags.status);
} else if (flags.list) {
  console.log("Operator address:", account.address);
  console.log("Escrow contract:", ESCROW_ADDRESS);
  console.log("Use --status=JOB_ID to check specific escrow");
} else {
  console.log("Usage:");
  console.log("  node workers/settlement-operator.mjs --release=JOB_ID");
  console.log("  node workers/settlement-operator.mjs --refund=JOB_ID");
  console.log("  node workers/settlement-operator.mjs --status=JOB_ID");
  console.log("  node workers/settlement-operator.mjs --list");
}

process.exit(0);
