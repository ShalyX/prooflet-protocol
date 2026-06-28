import { erc20Abi, formatUnits, http, isAddress, parseUnits, createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { json, openDatabase, withTransaction } from "../server/db.mjs";
import { seedDatabase } from "../server/seed.mjs";
import { ARC_CHAIN_ID, createSettlementBatch } from "../server/settlement.mjs";
import { appendReputationEvent } from "../server/reputation.mjs";

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ARCSCAN = "https://testnet.arcscan.app";
const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const config = {
  mode: modeArg?.slice("--mode=".length) || process.env.SETTLEMENT_MODE || "dry-run",
  intervalMs: positiveInteger(process.env.SETTLEMENT_INTERVAL_MS, 60000),
  apiUrl: (process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, ""),
  rpcUrl: process.env.ARC_RPC_URL || process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network",
  chainId: Number(process.env.ARC_CHAIN_ID || ARC_CHAIN_ID),
  usdcAddress: process.env.ARC_USDC_ADDRESS || ARC_USDC,
  privateKey: process.env.TREASURY_PRIVATE_KEY,
  issuerId: process.env.ISSUER_ID || "useful_waiting_protocol",
  once: process.argv.includes("--once"),
};

validateConfig();
const db = openDatabase();
seedDatabase(db);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl, { timeout: 10000 }) });

try {
  await checkApiHealth();
  await checkArcConnection();
  if (config.mode === "off") {
    log("daemon off", { mode: config.mode });
  } else {
    do {
      await runSettlementLoop();
      if (!config.once) await sleep(config.intervalMs);
    } while (!config.once);
  }
} finally {
  db.close();
}

async function runSettlementLoop() {
  const counts = payableCounts();
  log("proof scan", counts);
  let batch;
  try {
    batch = createSettlementBatch(db, { issuerId: config.issuerId });
  } catch (error) {
    if (error.message.includes("No unbatched payable proofs or prepared batch")) {
      log("no settlement work", { mode: config.mode });
      return;
    }
    throw error;
  }

  const plan = validateAndBuildPlan(batch);
  const balance = await publicClient.readContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [plan.treasuryAddress],
  });
  if (balance < plan.totalRaw) throw new Error(`Treasury has ${formatUnits(balance, 6)} USDC; batch requires ${batch.totalPayout}.`);
  printPlan(batch, plan, balance);

  if (config.mode === "dry-run") {
    log("dry-run complete", { batchId: batch.batchId, sent: false });
    return;
  }

  if (process.env.CONFIRM_ARC_TESTNET_USDC_SEND !== "true") {
    throw new Error("Execute mode requires CONFIRM_ARC_TESTNET_USDC_SEND=true.");
  }
  const locked = db.prepare("UPDATE settlement_batches SET status = 'executing' WHERE batch_id = ? AND status = 'prepared'").run(batch.batchId);
  if (locked.changes !== 1) {
    const status = db.prepare("SELECT status FROM settlement_batches WHERE batch_id = ?").get(batch.batchId)?.status;
    throw new Error(`Batch ${batch.batchId} is ${status || "missing"}; another process may hold the settlement lock.`);
  }

  let settlementFailures = [];

// Use Circle SDK if treasury wallet ID is configured
  const circleTreasuryWalletId = process.env.CIRCLE_TREASURY_WALLET_ID;
  if (circleTreasuryWalletId) {
    await settleViaCircle(batch, plan, circleTreasuryWalletId);
  } else {
    await settleViaViem(batch, plan);
  }

  const settledAt = new Date().toISOString();
  if (settlementFailures.length === 0) {
    db.prepare("UPDATE settlement_batches SET status = 'settled', settled_at = ? WHERE batch_id = ? AND status = 'executing'").run(settledAt, batch.batchId);
    log("batch settled", { batchId: batch.batchId, settledAt, totalPayout: batch.totalPayout });
  } else {
    db.prepare("UPDATE settlement_batches SET status = 'failed' WHERE batch_id = ? AND status = 'executing'").run(batch.batchId);
    log("batch failed", { batchId: batch.batchId, failedTransfers: settlementFailures.length });
  }
}

async function settleViaViem(batch, plan) {
  const account = privateKeyToAccount(normalizePrivateKey(config.privateKey));
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(config.rpcUrl, { timeout: 10000 }) });
  for (const transfer of plan.transfers) {
    let hash = null;
    try {
      assertProofsPayable(batch.batchId, transfer.proofIds);
      hash = await walletClient.writeContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [transfer.to, transfer.rawAmount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30000 });
      if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted.`);
      recordSuccessfulTransfer(batch.batchId, transfer, hash, receipt.blockNumber.toString());
      log("transfer settled", { batchId: batch.batchId, agentId: transfer.agentId, amount: transfer.amount, txHash: hash, explorer: `${ARCSCAN}/tx/${hash}` });
    } catch (error) {
      settlementFailures.push({ transfer, hash, error });
      recordTransferFailure(batch.batchId, transfer, hash, error);
      log("transfer failed", { batchId: batch.batchId, agentId: transfer.agentId, amount: transfer.amount, txHash: hash, error: error.message });
    }
  }
}

async function settleViaCircle(batch, plan, treasuryWalletId) {
  const c = initiateDeveloperControlledWalletsClient({ apiKey: *** entitySecret: process.env.CIRCLE_ENTITY_SECRET });
  for (const transfer of plan.transfers) {
    let response = null;
    try {
      assertProofsPayable(batch.batchId, transfer.proofIds);
      response = await c.createTransaction({
        idempotencyKey: `settle-${batch.batchId}-${transfer.agentId}-${Date.now()}`,
        walletId: treasuryWalletId,
        tokenId: "USDC-ARC",
        amounts: [transfer.amount],
        destinationAddress: transfer.to,
        fee: { type: "level", level: "MEDIUM" },
      });
      const tx = response.data?.transaction;
      if (!tx || !tx.transactionHash) throw new Error("Circle transaction missing hash");
      const hash = tx.transactionHash;
      recordSuccessfulTransfer(batch.batchId, transfer, hash, tx.blockNumber?.toString() || "0");
      log("transfer settled (Circle)", { batchId: batch.batchId, agentId: transfer.agentId, amount: transfer.amount, txHash: hash, state: tx.state, explorer: `${ARCSCAN}/tx/${hash}` });
    } catch (error) {
      settlementFailures.push({ transfer, hash: response?.data?.transaction?.transactionHash || null, error });
      recordTransferFailure(batch.batchId, transfer, response?.data?.transaction?.transactionHash || null, error);
      log("transfer failed (Circle)", { batchId: batch.batchId, agentId: transfer.agentId, amount: transfer.amount, error: error.message });
    }
  }
}

function validateAndBuildPlan(batch) {
  if (batch.network !== "Arc Testnet" || batch.chainId !== ARC_CHAIN_ID || batch.asset !== "USDC") {
    throw new Error(`Batch ${batch.batchId} is not an Arc Testnet USDC batch.`);
  }
  if (!Array.isArray(batch.recipients) || batch.recipients.length === 0) throw new Error("Settlement batch has no recipients.");
  if (!Array.isArray(batch.proofs) || batch.proofs.length === 0) throw new Error("Settlement batch has no payable proofs.");
  const proofsByAgent = new Map();
  for (const proof of batch.proofs) {
    if (proof.fundingStatus !== "payable" || proof.settlementStatus === "Settled on Arc Testnet") {
      throw new Error(`Proof ${proof.proofId} is not eligible for settlement.`);
    }
    const current = proofsByAgent.get(proof.agentId) || [];
    current.push(proof.proofId);
    proofsByAgent.set(proof.agentId, current);
  }

  const transfers = batch.recipients.map((recipient) => {
    const agent = db.prepare("SELECT payout_address FROM agents WHERE agent_id = ?").get(recipient.agentId);
    if (!agent || !isAddress(agent.payout_address)) throw new Error(`Missing valid payout address for ${recipient.agentId}.`);
    const rawAmount = parseUsdc(recipient.amount);
    const proofIds = proofsByAgent.get(recipient.agentId) || [];
    if (proofIds.length === 0) throw new Error(`Recipient ${recipient.agentId} has no matching payable proof.`);
    return { agentId: recipient.agentId, to: agent.payout_address, amount: formatUnits(rawAmount, 6), rawAmount, proofIds };
  });
  const totalRaw = transfers.reduce((sum, transfer) => sum + transfer.rawAmount, 0n);
  if (totalRaw !== parseUsdc(batch.totalPayout)) throw new Error("Recipient totals do not match batch totalPayout.");

  let treasuryAddress = process.env.TREASURY_ADDRESS;
  if (config.mode === "execute") {
    const account = privateKeyToAccount(normalizePrivateKey(config.privateKey));
    if (treasuryAddress && account.address.toLowerCase() !== treasuryAddress.toLowerCase()) {
      throw new Error("TREASURY_PRIVATE_KEY does not match TREASURY_ADDRESS.");
    }
    treasuryAddress = account.address;
  }
  if (!treasuryAddress || !isAddress(treasuryAddress)) throw new Error("Set a valid TREASURY_ADDRESS for settlement planning.");
  return { transfers, totalRaw, treasuryAddress };
}

function assertProofsPayable(batchId, proofIds) {
  const getProof = db.prepare("SELECT funding_status, settlement_status, tx_hash, batch_id FROM proofs WHERE proof_id = ?");
  for (const proofId of proofIds) {
    const proof = getProof.get(proofId);
    if (!proof || proof.batch_id !== batchId || proof.funding_status !== "payable" || proof.tx_hash || proof.settlement_status === "Settled on Arc Testnet") {
      throw new Error(`Proof ${proofId} is no longer payable.`);
    }
  }
}

function recordSuccessfulTransfer(batchId, transfer, hash, blockNumber) {
  const now = new Date().toISOString();
  withTransaction(db, () => {
    const batch = db.prepare("SELECT status FROM settlement_batches WHERE batch_id = ?").get(batchId);
    if (batch?.status !== "executing") throw new Error(`Batch ${batchId} lost its execution lock.`);
    const updateProof = db.prepare(`
      UPDATE proofs SET funding_status = 'paid', settlement_status = 'Settled on Arc Testnet',
        tx_hash = ?, explorer_url = ?
      WHERE proof_id = ? AND batch_id = ? AND funding_status = 'payable'
        AND settlement_status != 'Settled on Arc Testnet' AND tx_hash IS NULL
    `);
    for (const proofId of transfer.proofIds) {
      const changed = updateProof.run(hash, `${ARCSCAN}/tx/${hash}`, proofId, batchId);
      if (changed.changes !== 1) throw new Error(`Proof ${proofId} could not be marked paid.`);
      const proof = db.prepare("SELECT p.agent_id,p.job_id,j.issuer_id,j.reward_amount FROM proofs p JOIN jobs j USING(job_id) WHERE p.proof_id=?").get(proofId);
      appendReputationEvent(db, { eventId: `paid:${proofId}:${batchId}`, agentId: proof.agent_id, eventType: "proof_paid", jobId: proof.job_id, proofId, issuerId: proof.issuer_id, batchId, metadata: { amount: proof.reward_amount }, createdAt: now });
    }
    db.prepare(`
      INSERT INTO settlement_transactions
        (batch_id, proof_id, agent_id, recipient_address, amount, tx_hash, explorer_url,
         block_number, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?)
    `).run(batchId, transfer.proofIds[0], transfer.agentId, transfer.to, transfer.amount, hash, `${ARCSCAN}/tx/${hash}`, blockNumber, now);
  });
}

function recordTransferFailure(batchId, transfer, hash, error) {
  const now = new Date().toISOString();
  withTransaction(db, () => {
    db.prepare(`
      INSERT INTO settlement_failures
        (batch_id, agent_id, proof_ids_json, amount, tx_hash, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(batchId, transfer.agentId, json(transfer.proofIds), transfer.amount, hash, error.message, now);
    appendReputationEvent(db, { eventId: `settlement-failed:${batchId}:${transfer.agentId}:${now}`, agentId: transfer.agentId, eventType: "settlement_failed", batchId, metadata: { proofIds: transfer.proofIds, amount: transfer.amount, txHash: hash || null, error: error.message }, createdAt: now });
    if (hash) {
      const markReview = db.prepare(`
        UPDATE proofs SET funding_status = 'settlement_failed', settlement_status = 'Settlement requires review'
        WHERE proof_id = ? AND batch_id = ? AND funding_status = 'payable' AND tx_hash IS NULL
      `);
      for (const proofId of transfer.proofIds) markReview.run(proofId, batchId);
    } else {
      const release = db.prepare(`
        UPDATE proofs SET batch_id = NULL
        WHERE proof_id = ? AND batch_id = ? AND funding_status = 'payable' AND tx_hash IS NULL
      `);
      for (const proofId of transfer.proofIds) release.run(proofId, batchId);
    }
  });
}

function payableCounts() {
  return {
    payable: db.prepare("SELECT COUNT(*) AS count FROM proofs WHERE outcome = 'accepted' AND funding_status = 'payable' AND tx_hash IS NULL").get().count,
    rejectedExcluded: db.prepare("SELECT COUNT(*) AS count FROM proofs WHERE outcome = 'rejected' OR funding_status = 'rejected'").get().count,
    paidExcluded: db.prepare("SELECT COUNT(*) AS count FROM proofs WHERE funding_status = 'paid' OR settlement_status = 'Settled on Arc Testnet'").get().count,
  };
}

async function checkApiHealth() {
  const response = await fetch(`${config.apiUrl}/health`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(`Prooflet API health check failed at ${config.apiUrl}.`);
  log("api healthy", { apiUrl: config.apiUrl, version: body.version });
}

async function checkArcConnection() {
  const chainId = await publicClient.getChainId();
  if (chainId !== ARC_CHAIN_ID) throw new Error(`Refusing settlement: expected Arc Testnet chain ${ARC_CHAIN_ID}, got ${chainId}.`);
  log("arc healthy", { rpcUrl: config.rpcUrl, chainId, usdc: config.usdcAddress });
}

function printPlan(batch, plan, balance) {
  log("payout plan", {
    mode: config.mode,
    batchId: batch.batchId,
    treasury: plan.treasuryAddress,
    treasuryBalance: `${formatUnits(balance, 6)} USDC`,
    approvedProofs: batch.approvedProofs,
    rejectedProofsExcluded: batch.rejectedProofs,
    totalPayout: `${batch.totalPayout} USDC`,
    transfers: plan.transfers.map(({ agentId, to, amount, proofIds }) => ({ agentId, to, amount, proofIds })),
  });
}

function validateConfig() {
  if (!["dry-run", "execute", "off"].includes(config.mode)) throw new Error("SETTLEMENT_MODE must be dry-run, execute, or off.");
  if (config.chainId !== ARC_CHAIN_ID) throw new Error(`ARC_CHAIN_ID must be ${ARC_CHAIN_ID}.`);
  if (config.usdcAddress.toLowerCase() !== ARC_USDC.toLowerCase()) throw new Error(`ARC_USDC_ADDRESS must be ${ARC_USDC}.`);
  if (config.mode === "execute" && !config.privateKey) throw new Error("TREASURY_PRIVATE_KEY is required in execute mode.");
}

function parseUsdc(value) {
  const raw = parseUnits(String(value), 6);
  if (raw <= 0n) throw new Error(`Invalid USDC amount: ${value}.`);
  return raw;
}

function normalizePrivateKey(value) {
  if (!value) throw new Error("TREASURY_PRIVATE_KEY is required in execute mode.");
  return value.startsWith("0x") ? value : `0x${value}`;
}

function positiveInteger(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(event, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), daemon: "settlement-daemon-v0", event, ...details }));
}
