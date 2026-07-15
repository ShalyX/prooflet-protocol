import { erc20Abi } from "viem";
import { mkdir, writeFile } from "node:fs/promises";
import { openDatabase } from "../server/db.mjs";

import { recordSettledBatch } from "../server/settlement.mjs";
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

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const batchFile = process.env.BATCH_FILE || process.argv.find((arg) => arg.endsWith(".json")) || "work/settlement-batch.json";
const recipientsFile = process.env.RECIPIENTS_FILE || "settlement/agent-addresses.json";
const privateKey = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY;
const treasuryAddress = process.env.TREASURY_ADDRESS;
const stateFile = process.env.SETTLEMENT_STATE_FILE || "settlement/settlement-state.json";
const db = openDatabase();

if (execute && process.env.CONFIRM_ARC_TESTNET_USDC_SEND !== "true") {
  throw new Error("Set CONFIRM_ARC_TESTNET_USDC_SEND=true in .env to execute transfers. Dry-run works without it.");
}

const batch = await readJson(batchFile);
const recipientBook = await loadRecipientBook(db, recipientsFile);
const state = await readSettlementState(stateFile);

validateBatch(batch);
if (state.settledBatches?.[batch.batchId]) {
  throw new Error(`Batch ${batch.batchId} was already settled. Refusing duplicate settlement.`);
}
const databaseBatch = db.prepare("SELECT status FROM settlement_batches WHERE batch_id = ?").get(batch.batchId);
if (databaseBatch?.status === "settled") {
  throw new Error(`Batch ${batch.batchId} was already settled in SQLite. Refusing duplicate settlement.`);
}

const publicClient = makePublicClient();
await assertArcTestnet(publicClient);
const wallet = privateKey ? makeWalletClient(privateKey) : null;
if (execute && !wallet) throw new Error("Set TREASURY_PRIVATE_KEY in .env before executing transfers.");

const transfers = batch.recipients.map((recipient) => {
  const to = recipientBook[recipient.agentId];
  validateAddress(to, recipient.agentId);
  return {
    agentId: recipient.agentId,
    to,
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
  if (balance < totalRaw) {
    throw new Error(`Insufficient Arc Testnet USDC. Need ${humanUsdc(totalRaw)}, treasury has ${humanUsdc(balance)}.`);
  }
}

const result = {
  mode: execute ? "execute" : "dry-run",
  batchId: batch.batchId,
  protocol: batch.protocol,
  network: "Arc Testnet",
  chainId: ARC_CHAIN_ID,
  treasury: balanceAddress || null,
  treasuryBalance: balance === null ? null : humanUsdc(balance),
  usdc: ARC_USDC,
  approvedProofs: batch.approvedProofs,
  rejectedProofs: batch.rejectedProofs,
  totalPayout: humanUsdc(totalRaw),
  transfers: transfers.map(({ agentId, to, amount }) => ({ agentId, to, amount })),
  proofs: batch.proofs,
};

console.error(`Arc settlement preflight: total payout ${humanUsdc(totalRaw)} USDC across ${transfers.length} recipient(s).`);

if (!execute) {
  result.nextStep = "Review this dry-run. To send testnet USDC, run: npm run arc:settle -- --execute";
  console.log(JSON.stringify(result, null, 2));
} else {
  if (databaseBatch) {
    const lock = db.prepare("UPDATE settlement_batches SET status = 'executing' WHERE batch_id = ? AND status = 'prepared'").run(batch.batchId);
    if (lock.changes !== 1) {
      const currentStatus = db.prepare("SELECT status FROM settlement_batches WHERE batch_id = ?").get(batch.batchId)?.status;
      throw new Error(`Batch ${batch.batchId} is ${currentStatus || databaseBatch.status}, not prepared. Refusing concurrent or duplicate settlement.`);
    }
  }
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

  const txByAgent = new Map(result.transactions.map((tx) => [tx.agentId, tx]));
  const paidProofs = batch.proofs.map((proof) => {
    const tx = txByAgent.get(proof.agentId);
    return {
      ...proof,
      fundingStatus: "paid",
      settlementStatus: "Settled on Arc Testnet",
      txHash: tx?.hash,
      explorer: tx?.explorer,
    };
  });

  state.settledBatches = state.settledBatches || {};
  state.settledBatches[batch.batchId] = {
    settledAt: new Date().toISOString(),
    network: "Arc Testnet",
    chainId: ARC_CHAIN_ID,
    totalPayout: humanUsdc(totalRaw),
    transactions: result.transactions,
    paidProofs,
  };
  await writeSettlementState(stateFile, state);
  await recordSettledBatch(db, batch, result.transactions);
  result.paidProofs = paidProofs;
  console.log(JSON.stringify(result, null, 2));
}
db.close();

function validateBatch(batch) {
  if (!batch.batchId || typeof batch.batchId !== "string") throw new Error("Batch must include a stable batchId.");
  if (batch.protocol !== "Useful Waiting Protocol") throw new Error("Batch protocol mismatch.");
  if (!batch.issuer || typeof batch.issuer !== "string") throw new Error("Batch must include an issuer.");
  if (batch.network !== "Arc Testnet") throw new Error("Batch network must be Arc Testnet.");
  if (batch.chainId !== ARC_CHAIN_ID) throw new Error(`Batch chainId must be ${ARC_CHAIN_ID}.`);
  if (batch.asset !== "USDC") throw new Error("Batch asset must be USDC.");
  if (batch.settlementType !== "batch") throw new Error("Batch settlementType must be batch.");
  if (!Array.isArray(batch.recipients) || batch.recipients.length === 0) throw new Error("Batch has no recipients.");
  if (!Array.isArray(batch.proofs) || batch.proofs.length === 0) throw new Error("Batch has no payable proofs.");
  const recipientTotal = batch.recipients.reduce((sum, recipient) => sum + normalizeAmount(recipient.amount), 0n);
  if (recipientTotal !== normalizeAmount(batch.totalPayout)) {
    throw new Error(`Batch totalPayout ${batch.totalPayout} does not match recipient total ${humanUsdc(recipientTotal)}.`);
  }
  if (Number(batch.rejectedProofs || 0) > 0) {
    console.error(`Notice: ${batch.rejectedProofs} rejected proof(s) are present and excluded from payout.`);
  }
}

function validateProofs(batch, transfers) {
  const transferAgents = new Set(transfers.map((transfer) => transfer.agentId));
  for (const proof of batch.proofs) {
    if (proof.outcome === "rejected" || proof.fundingStatus === "rejected") {
      throw new Error(`Rejected proof ${proof.proofId || proof.jobId} cannot be included in a settlement batch.`);
    }
    if (proof.fundingStatus !== "payable") {
      throw new Error(`Proof ${proof.proofId || proof.jobId} must be payable before settlement.`);
    }
    if (!transferAgents.has(proof.agentId)) {
      throw new Error(`Proof ${proof.proofId || proof.jobId} has no matching recipient transfer.`);
    }
  }
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

async function loadRecipientBook(database, path) {
  const rows = database.prepare("SELECT agent_id, payout_address FROM agents").all();
  const fromDatabase = Object.fromEntries(rows.map((row) => [row.agent_id, row.payout_address]));
  try {
    return { ...fromDatabase, ...(await readJson(path)) };
  } catch (error) {
    if (error.code === "ENOENT") return fromDatabase;
    throw error;
  }
}
