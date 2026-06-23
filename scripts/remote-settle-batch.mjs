import { erc20Abi } from "viem";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  ARC_CHAIN_ID,
  ARC_USDC,
  ARCSCAN,
  assertArcTestnet,
  humanUsdc,
  makePublicClient,
  makeWalletClient,
  normalizeAmount,
  readJson,
  usdcBalance,
  validateAddress,
} from "./arc-common.mjs";

const flags = parseArgs(process.argv.slice(2));
const execute = flags.mode === "execute" || flags.execute;
const apiUrl = (flags.apiUrl || process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const issuerId = flags.issuerId || process.env.ISSUER_ID || "useful_waiting_protocol";
const issuerApiKey = flags.issuerApiKey || process.env.ISSUER_API_KEY;
const batchId = flags.batchId || process.env.REMOTE_SETTLEMENT_BATCH_ID || undefined;
const proofIds = parseProofIds(flags.proofIds || process.env.REMOTE_SETTLEMENT_PROOF_IDS);
const privateKey = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY;
const treasuryAddress = process.env.TREASURY_ADDRESS;
const stateFile = process.env.SETTLEMENT_STATE_FILE || "settlement/settlement-state.json";

if (!issuerApiKey) throw new Error("Set ISSUER_API_KEY or pass --issuer-api-key.");
if (execute && process.env.CONFIRM_ARC_TESTNET_USDC_SEND !== "true") {
  throw new Error("Execute mode requires CONFIRM_ARC_TESTNET_USDC_SEND=true. Dry-run sends nothing.");
}

const health = await apiRequest("GET", "/health");
if (!health.ok || health.protocol !== "Prooflet") throw new Error(`Unexpected API health response from ${apiUrl}.`);

const batch = (await apiRequest("POST", "/settlement-batches/export", {
  issuerId,
  ...(batchId ? { batchId } : {}),
  ...(proofIds ? { proofIds } : {}),
})).batch;
validateBatch(batch);

const state = await readSettlementState(stateFile);
if (state.settledBatches?.[batch.batchId]) {
  throw new Error(`Batch ${batch.batchId} was already settled locally. Refusing duplicate remote settlement.`);
}

const publicClient = makePublicClient();
await assertArcTestnet(publicClient);
const wallet = privateKey ? makeWalletClient(privateKey) : null;
if (execute && !wallet) throw new Error("Set TREASURY_PRIVATE_KEY before executing remote settlement.");

const transfers = batch.recipients.map((recipient) => {
  validateAddress(recipient.payoutAddress, recipient.agentId);
  return {
    agentId: recipient.agentId,
    to: recipient.payoutAddress,
    amount: String(recipient.amount),
    rawAmount: normalizeAmount(recipient.amount),
  };
});
validateProofs(batch, transfers);

const totalRaw = transfers.reduce((sum, transfer) => sum + transfer.rawAmount, 0n);
const balanceAddress = wallet?.account.address || treasuryAddress;
let balance = null;
if (balanceAddress) {
  validateAddress(balanceAddress, "treasury");
  balance = await usdcBalance(publicClient, balanceAddress);
  if (balance < totalRaw) throw new Error(`Insufficient Arc Testnet USDC. Need ${humanUsdc(totalRaw)}, treasury has ${humanUsdc(balance)}.`);
}

const result = {
  mode: execute ? "execute" : "dry-run",
  source: apiUrl,
  batchId: batch.batchId,
  protocol: batch.protocol,
  network: batch.network,
  chainId: batch.chainId,
  treasury: balanceAddress || null,
  treasuryBalance: balance === null ? null : humanUsdc(balance),
  usdc: ARC_USDC,
  approvedProofs: batch.approvedProofs,
  rejectedProofsExcluded: batch.rejectedProofs,
  totalPayout: humanUsdc(totalRaw),
  transfers: transfers.map(({ agentId, to, amount }) => ({ agentId, to, amount })),
  proofs: batch.proofs,
};

console.error(`Remote Arc settlement preflight: total payout ${humanUsdc(totalRaw)} USDC across ${transfers.length} recipient(s).`);

if (!execute) {
  result.sent = false;
  result.nextStep = "Review this dry-run. To send testnet USDC, run settlement:remote:execute with CONFIRM_ARC_TESTNET_USDC_SEND=true.";
  console.log(JSON.stringify(result, null, 2));
} else {
  result.transactions = [];
  for (const transfer of transfers) {
    const hash = await wallet.walletClient.writeContract({
      address: ARC_USDC,
      abi: erc20Abi,
      functionName: "transfer",
      args: [transfer.to, transfer.rawAmount],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    result.transactions.push({
      agentId: transfer.agentId,
      to: transfer.to,
      amount: transfer.amount,
      hash,
      explorer: `${ARCSCAN}/tx/${hash}`,
      blockNumber: receipt.blockNumber.toString(),
      status: receipt.status,
    });
  }

  state.settledBatches = state.settledBatches || {};
  state.settledBatches[batch.batchId] = {
    settledAt: new Date().toISOString(),
    source: apiUrl,
    network: "Arc Testnet",
    chainId: ARC_CHAIN_ID,
    totalPayout: humanUsdc(totalRaw),
    transactions: result.transactions,
  };
  await writeSettlementState(stateFile, state);

  const receipt = await apiRequest("POST", `/settlement-batches/${encodeURIComponent(batch.batchId)}/receipt`, {
    issuerId,
    transactions: result.transactions,
  });
  result.remoteReceipt = receipt;
  console.log(JSON.stringify(result, null, 2));
}

function validateBatch(batch) {
  if (!batch || typeof batch !== "object") throw new Error("Remote API did not return a settlement batch.");
  if (!batch.batchId || typeof batch.batchId !== "string") throw new Error("Batch must include a stable batchId.");
  if (!["Useful Waiting Protocol", "Prooflet"].includes(batch.protocol)) throw new Error("Batch protocol mismatch.");
  if (batch.issuer !== issuerId) throw new Error(`Batch issuer ${batch.issuer} does not match ${issuerId}.`);
  if (batch.network !== "Arc Testnet") throw new Error("Batch network must be Arc Testnet.");
  if (batch.chainId !== ARC_CHAIN_ID) throw new Error(`Batch chainId must be ${ARC_CHAIN_ID}.`);
  if (batch.asset !== "USDC") throw new Error("Batch asset must be USDC.");
  if (batch.settlementType !== "batch") throw new Error("Batch settlementType must be batch.");
  if (!Array.isArray(batch.recipients) || batch.recipients.length === 0) throw new Error("Batch has no recipients.");
  if (!Array.isArray(batch.proofs) || batch.proofs.length === 0) throw new Error("Batch has no payable proofs.");
  const recipientTotal = batch.recipients.reduce((sum, recipient) => sum + normalizeAmount(recipient.amount), 0n);
  if (recipientTotal !== normalizeAmount(batch.totalPayout)) throw new Error("Batch totalPayout does not match recipient total.");
}

function validateProofs(batch, transfers) {
  const transferAgents = new Set(transfers.map((transfer) => transfer.agentId));
  for (const proof of batch.proofs) {
    if (proof.outcome === "rejected" || proof.fundingStatus === "rejected") throw new Error(`Rejected proof ${proof.proofId || proof.jobId} cannot be included.`);
    if (proof.fundingStatus !== "payable") throw new Error(`Proof ${proof.proofId || proof.jobId} must be payable before settlement.`);
    if (proof.settlementStatus === "Settled on Arc Testnet") throw new Error(`Proof ${proof.proofId || proof.jobId} is already settled.`);
    if (!transferAgents.has(proof.agentId)) throw new Error(`Proof ${proof.proofId || proof.jobId} has no matching recipient transfer.`);
  }
}

async function apiRequest(method, path, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      authorization: `Bearer ${issuerApiKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Remote API ${method} ${path} failed (${response.status}): ${json.error || text}`);
  return json;
}

async function readSettlementState(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return { settledBatches: {} };
    throw error;
  }
}

async function writeSettlementState(path, state) {
  await mkdir(path.split(/[\\/]/).slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

function parseProofIds(value) {
  if (!value) return null;
  const ids = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  return ids.length ? [...new Set(ids)] : null;
}

function parseArgs(args) {
  const parsed = { execute: false, mode: process.env.SETTLEMENT_MODE || "dry-run" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--execute") {
      parsed.execute = true;
      parsed.mode = "execute";
      continue;
    }
    if (argument === "--dry-run") {
      parsed.mode = "dry-run";
      continue;
    }
    const match = argument.match(/^--(api-url|issuer-id|issuer-api-key|batch-id|proof-ids|mode)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${argument}.`);
    const value = match[2] ?? args[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${match[1]} requires a value.`);
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[key] = value;
  }
  if (!["dry-run", "execute"].includes(parsed.mode)) throw new Error("--mode must be dry-run or execute.");
  return parsed;
}
