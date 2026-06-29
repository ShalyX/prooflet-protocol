import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { formatUnits, parseUnits } from "viem";
import { parseJson, withTransaction } from "./db.mjs";
import { appendReputationEvent } from "./reputation.mjs";

export const ARC_CHAIN_ID = 5042002;

export function createSettlementBatch(db, { issuerId = "useful_waiting_protocol", batchId, outputPath, proofIds } = {}) {
  const resolvedBatchId = withTransaction(db, () => {
    const preparedBatch = batchId
      ? db.prepare("SELECT * FROM settlement_batches WHERE batch_id = ? AND issuer_id = ? AND status = 'prepared'").get(batchId, issuerId)
      : db.prepare("SELECT * FROM settlement_batches WHERE issuer_id = ? AND status = 'prepared' ORDER BY created_at DESC LIMIT 1").get(issuerId);
    if (preparedBatch) return preparedBatch.batch_id;

    const payableProofs = loadUnbatchedPayableProofs(db, issuerId, proofIds);
    if (payableProofs.length === 0) throw new Error(`No unbatched payable proofs or prepared batch exists for issuer ${issuerId}.`);
    if (proofIds && payableProofs.length !== new Set(proofIds).size) throw new Error("One or more requested proofs are missing, already batched, or not payable.");
    const newBatchId = batchId || nextBatchId(db);
    if (db.prepare("SELECT 1 FROM settlement_batches WHERE batch_id = ?").get(newBatchId)) {
      throw new Error(`Batch ${newBatchId} already exists.`);
    }

    const now = new Date().toISOString();
    const total = formatUnits(payableProofs.reduce((sum, proof) => sum + parseUnits(proofAmount(db, proof.job_id), 6), 0n), 6);
    db.prepare(`
      INSERT INTO settlement_batches
        (batch_id, issuer_id, network, chain_id, asset, total_payout, status, created_at)
      VALUES (?, ?, 'Arc Testnet', ?, 'USDC', ?, 'preparing', ?)
    `).run(newBatchId, issuerId, ARC_CHAIN_ID, total, now);
    const attach = db.prepare(`
      UPDATE proofs SET batch_id = ?
      WHERE proof_id = ? AND funding_status = 'payable' AND settlement_status != 'Settled on Arc Testnet'
        AND tx_hash IS NULL AND batch_id IS NULL
    `);
    for (const proof of payableProofs) {
      if (attach.run(newBatchId, proof.proof_id).changes !== 1) throw new Error(`Could not lock proof ${proof.proof_id} for settlement.`);
    }
    db.prepare("UPDATE settlement_batches SET status = 'prepared' WHERE batch_id = ? AND status = 'preparing'").run(newBatchId);
    return newBatchId;
  });

  const proofs = loadBatchProofs(db, resolvedBatchId);
  if (proofs.length === 0) throw new Error(`Prepared batch ${resolvedBatchId} has no payable proofs.`);

  const recipients = new Map();
  for (const proof of proofs) {
    const current = recipients.get(proof.agent_id) || { agentId: proof.agent_id, rawAmount: 0n, payoutAddress: proof.payout_address };
    current.rawAmount += parseUnits(proofAmount(db, proof.job_id), 6);
    recipients.set(proof.agent_id, current);
  }
  const recipientList = [...recipients.values()].map((item) => ({
    agentId: item.agentId,
    amount: formatUnits(item.rawAmount, 6),
    payoutAddress: item.payoutAddress,
  }));
  const totalPayout = formatUnits(recipientList.reduce((sum, item) => sum + parseUnits(item.amount, 6), 0n), 6);
  const rejectedProofs = db.prepare("SELECT COUNT(*) AS count FROM proofs WHERE outcome = 'rejected'").get().count;

  const payload = {
    batchId: resolvedBatchId,
    protocol: "Useful Waiting Protocol",
    issuer: issuerId,
    network: "Arc Testnet",
    chainId: ARC_CHAIN_ID,
    asset: "USDC",
    settlementType: "batch",
    approvedProofs: proofs.length,
    rejectedProofs,
    totalPayout,
    recipients: recipientList.map(({ agentId, amount, payoutAddress }) => ({ agentId, amount, payoutAddress })),
    proofs: proofs.map((proof) => ({
      proofId: proof.proof_id,
      jobId: proof.job_id,
      agentId: proof.agent_id,
      amount: formatUnits(parseUnits(proofAmount(db, proof.job_id), 6), 6),
      fundingStatus: proof.funding_status,
      settlementStatus: proof.settlement_status,
      fundingRail: proof.funding_rail,
    })),
  };

  if (outputPath) {
    const absolute = resolve(outputPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`);
  }
  return payload;
}

export function recordSettledBatch(db, batch, transactions) {
  const existing = db.prepare("SELECT status FROM settlement_batches WHERE batch_id = ?").get(batch.batchId);
  if (existing?.status === "settled") throw new Error(`Batch ${batch.batchId} is already settled in SQLite.`);
  const now = new Date().toISOString();
  const txByAgent = new Map(transactions.map((tx) => [tx.agentId, tx]));

  withTransaction(db, () => {
    if (!existing) {
      db.prepare(`
        INSERT INTO settlement_batches
          (batch_id, issuer_id, network, chain_id, asset, total_payout, status, created_at, settled_at)
        VALUES (?, ?, 'Arc Testnet', ?, 'USDC', ?, 'settled', ?, ?)
      `).run(batch.batchId, batch.issuer, ARC_CHAIN_ID, batch.totalPayout, now, now);
    } else {
      db.prepare("UPDATE settlement_batches SET status = 'settled', settled_at = ? WHERE batch_id = ?").run(now, batch.batchId);
    }

    const updateProof = db.prepare(`
      UPDATE proofs
      SET funding_status = 'paid', settlement_status = 'Settled on Arc Testnet',
          tx_hash = ?, explorer_url = ?, batch_id = ?
      WHERE proof_id = ? AND funding_status = 'payable' AND tx_hash IS NULL
    `);
    const insertTx = db.prepare(`
      INSERT OR IGNORE INTO settlement_transactions
        (batch_id, proof_id, agent_id, recipient_address, amount, tx_hash, explorer_url,
         block_number, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const proof of batch.proofs) {
      const tx = txByAgent.get(proof.agentId);
      if (!tx || tx.status !== "success") throw new Error(`Missing successful transaction for ${proof.agentId}.`);
      const changed = updateProof.run(tx.hash, tx.explorer, batch.batchId, proof.proofId);
      if (changed.changes !== 1) throw new Error(`Proof ${proof.proofId} was not payable or was already paid.`);
      insertTx.run(batch.batchId, proof.proofId, proof.agentId, tx.to, proof.amount, tx.hash, tx.explorer, tx.blockNumber, tx.status, now);
      appendReputationEvent(db, { eventId: `paid:${proof.proofId}:${batch.batchId}`, agentId: proof.agentId, eventType: "proof_paid", jobId: proof.jobId, proofId: proof.proofId, issuerId: batch.issuer, batchId: batch.batchId, metadata: { amount: proof.amount }, createdAt: now });
    }
  });
}

export function settlementSummary(db) {
  const batches = db.prepare("SELECT * FROM settlement_batches ORDER BY created_at DESC").all();
  const transactions = db.prepare("SELECT * FROM settlement_transactions ORDER BY created_at DESC").all();
  const failures = db.prepare("SELECT * FROM settlement_failures ORDER BY created_at DESC").all();
  return { batches, transactions, failures };
}

function loadUnbatchedPayableProofs(db, issuerId, proofIds) {
  const ids = proofIds ? [...new Set(proofIds)] : [];
  const proofFilter = ids.length ? ` AND p.proof_id IN (${ids.map(() => "?").join(",")})` : "";
  return db.prepare(`
    SELECT p.*, a.payout_address
    FROM proofs p
    JOIN agents a ON a.agent_id = p.agent_id
    JOIN jobs j ON j.job_id = p.job_id
    WHERE p.outcome = 'accepted' AND p.funding_status = 'payable'
      AND p.settlement_status != 'Settled on Arc Testnet'
      AND p.batch_id IS NULL AND p.tx_hash IS NULL AND j.issuer_id = ?${proofFilter}
    ORDER BY p.created_at, p.proof_id
  `).all(issuerId, ...ids);
}

function loadBatchProofs(db, batchId) {
  return db.prepare(`
    SELECT p.*, a.payout_address, j.funding_rail
    FROM proofs p JOIN agents a ON a.agent_id = p.agent_id
    JOIN jobs j ON j.job_id = p.job_id
    WHERE p.batch_id = ? AND p.outcome = 'accepted' AND p.funding_status = 'payable'
      AND p.settlement_status != 'Settled on Arc Testnet' AND p.tx_hash IS NULL
    ORDER BY p.created_at, p.proof_id
  `).all(batchId);
}

function proofAmount(db, jobId) {
  return db.prepare("SELECT reward_amount FROM jobs WHERE job_id = ?").get(jobId).reward_amount;
}

function nextBatchId(db) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const prefix = `uwp_arc_${date}_`;
  const rows = db.prepare("SELECT batch_id FROM settlement_batches WHERE batch_id LIKE ?").all(`${prefix}%`);
  const next = rows.reduce((max, row) => Math.max(max, Number(row.batch_id.slice(prefix.length)) || 0), 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}
