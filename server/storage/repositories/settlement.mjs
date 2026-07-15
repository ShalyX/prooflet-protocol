import { json } from "../../db.mjs";

export function createSettlementRepository(store) {
  if (store.dialect === "postgres") return createPostgresSettlementRepository(store);
  if (store.dialect === "sqlite") return createSqliteSettlementRepository(store);
  throw new Error(`Unsupported store dialect: ${store.dialect}`);
}

function createSqliteSettlementRepository(store) {
  const db = () => {
    if (!store.native) throw new Error("SQLite settlement repository requires store.native.");
    return store.native;
  };

  return {
    async getBatch(batchId) {
      const row = db().prepare("SELECT * FROM settlement_batches WHERE batch_id = ?").get(batchId);
      return row ? mapBatch(row) : null;
    },

    async createPreparingBatch(batch) {
      try {
        db().prepare(`
          INSERT INTO settlement_batches
            (batch_id, issuer_id, network, chain_id, asset, total_payout, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'preparing', ?)
        `).run(
          batch.batchId,
          batch.issuerId,
          batch.network || "Arc Testnet",
          batch.chainId,
          batch.asset || "USDC",
          batch.totalPayout,
          batch.createdAt,
        );
      } catch (error) {
        throw asUniqueViolation(error);
      }
      return this.getBatch(batch.batchId);
    },

    async lockProofToBatch({ batchId, proofId }) {
      const result = db().prepare(`
        UPDATE proofs SET batch_id = ?
        WHERE proof_id = ? AND funding_status = 'payable' AND settlement_status != 'Settled on Arc Testnet'
          AND tx_hash IS NULL AND batch_id IS NULL
      `).run(batchId, proofId);
      if (result.changes !== 1) {
        const error = new Error(`Could not lock proof ${proofId} for settlement.`);
        error.code = "PROOF_NOT_LOCKABLE";
        throw error;
      }
    },

    async markBatchPrepared(batchId) {
      db().prepare("UPDATE settlement_batches SET status = 'prepared' WHERE batch_id = ? AND status = 'preparing'").run(batchId);
      return this.getBatch(batchId);
    },

    async markBatchSettled({ batchId, settledAt }) {
      db().prepare("UPDATE settlement_batches SET status = 'settled', settled_at = ? WHERE batch_id = ?").run(settledAt, batchId);
      return this.getBatch(batchId);
    },

    async insertSettledBatch(batch) {
      try {
        db().prepare(`
          INSERT INTO settlement_batches
            (batch_id, issuer_id, network, chain_id, asset, total_payout, status, created_at, settled_at)
          VALUES (?, ?, ?, ?, ?, ?, 'settled', ?, ?)
        `).run(
          batch.batchId,
          batch.issuerId,
          batch.network || "Arc Testnet",
          batch.chainId,
          batch.asset || "USDC",
          batch.totalPayout,
          batch.createdAt,
          batch.settledAt,
        );
      } catch (error) {
        throw asUniqueViolation(error);
      }
      return this.getBatch(batch.batchId);
    },

    async markProofPaid({ proofId, batchId, txHash, explorerUrl }) {
      const result = db().prepare(`
        UPDATE proofs
        SET funding_status = 'paid', settlement_status = 'Settled on Arc Testnet',
            tx_hash = ?, explorer_url = ?, batch_id = ?
        WHERE proof_id = ? AND funding_status = 'payable' AND tx_hash IS NULL
      `).run(txHash, explorerUrl, batchId, proofId);
      if (result.changes !== 1) {
        const error = new Error(`Proof ${proofId} was not payable or was already paid.`);
        error.code = "PROOF_NOT_PAYABLE";
        throw error;
      }
    },

    async insertSettlementTransaction(tx) {
      try {
        db().prepare(`
          INSERT INTO settlement_transactions
            (batch_id, proof_id, agent_id, recipient_address, amount, tx_hash, explorer_url,
             block_number, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          tx.batchId,
          tx.proofId ?? null,
          tx.agentId,
          tx.recipientAddress,
          tx.amount,
          tx.txHash,
          tx.explorerUrl,
          tx.blockNumber ?? null,
          tx.status,
          tx.createdAt,
        );
      } catch (error) {
        throw asUniqueViolation(error);
      }
    },

    async hasSettlementTxHash(txHash) {
      return !!db().prepare("SELECT 1 FROM settlement_transactions WHERE tx_hash = ?").get(txHash);
    },
  };
}

function createPostgresSettlementRepository(store) {
  const query = (text, values = []) => store.query(text, values);

  return {
    async getBatch(batchId) {
      const result = await query("SELECT * FROM settlement_batches WHERE batch_id = $1", [batchId]);
      return result.rows[0] ? mapBatch(result.rows[0]) : null;
    },

    async createPreparingBatch(batch) {
      try {
        await query(`
          INSERT INTO settlement_batches
            (batch_id, issuer_id, network, chain_id, asset, total_payout, status, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,'preparing',$7)
        `, [
          batch.batchId,
          batch.issuerId,
          batch.network || "Arc Testnet",
          batch.chainId,
          batch.asset || "USDC",
          batch.totalPayout,
          batch.createdAt,
        ]);
      } catch (error) {
        throw asUniqueViolation(error);
      }
      return this.getBatch(batch.batchId);
    },

    async lockProofToBatch({ batchId, proofId }) {
      const result = await query(`
        UPDATE proofs SET batch_id = $1
        WHERE proof_id = $2 AND funding_status = 'payable' AND settlement_status != 'Settled on Arc Testnet'
          AND tx_hash IS NULL AND batch_id IS NULL
      `, [batchId, proofId]);
      if (result.rowCount !== 1) {
        const error = new Error(`Could not lock proof ${proofId} for settlement.`);
        error.code = "PROOF_NOT_LOCKABLE";
        throw error;
      }
    },

    async markBatchPrepared(batchId) {
      await query("UPDATE settlement_batches SET status = 'prepared' WHERE batch_id = $1 AND status = 'preparing'", [batchId]);
      return this.getBatch(batchId);
    },

    async markBatchSettled({ batchId, settledAt }) {
      await query("UPDATE settlement_batches SET status = 'settled', settled_at = $1 WHERE batch_id = $2", [settledAt, batchId]);
      return this.getBatch(batchId);
    },

    async insertSettledBatch(batch) {
      try {
        await query(`
          INSERT INTO settlement_batches
            (batch_id, issuer_id, network, chain_id, asset, total_payout, status, created_at, settled_at)
          VALUES ($1,$2,$3,$4,$5,$6,'settled',$7,$8)
        `, [
          batch.batchId,
          batch.issuerId,
          batch.network || "Arc Testnet",
          batch.chainId,
          batch.asset || "USDC",
          batch.totalPayout,
          batch.createdAt,
          batch.settledAt,
        ]);
      } catch (error) {
        throw asUniqueViolation(error);
      }
      return this.getBatch(batch.batchId);
    },

    async markProofPaid({ proofId, batchId, txHash, explorerUrl }) {
      const result = await query(`
        UPDATE proofs
        SET funding_status = 'paid', settlement_status = 'Settled on Arc Testnet',
            tx_hash = $1, explorer_url = $2, batch_id = $3
        WHERE proof_id = $4 AND funding_status = 'payable' AND tx_hash IS NULL
      `, [txHash, explorerUrl, batchId, proofId]);
      if (result.rowCount !== 1) {
        const error = new Error(`Proof ${proofId} was not payable or was already paid.`);
        error.code = "PROOF_NOT_PAYABLE";
        throw error;
      }
    },

    async insertSettlementTransaction(tx) {
      try {
        await query(`
          INSERT INTO settlement_transactions
            (batch_id, proof_id, agent_id, recipient_address, amount, tx_hash, explorer_url,
             block_number, status, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `, [
          tx.batchId,
          tx.proofId ?? null,
          tx.agentId,
          tx.recipientAddress,
          tx.amount,
          tx.txHash,
          tx.explorerUrl,
          tx.blockNumber ?? null,
          tx.status,
          tx.createdAt,
        ]);
      } catch (error) {
        throw asUniqueViolation(error);
      }
    },

    async hasSettlementTxHash(txHash) {
      const result = await query("SELECT 1 AS present FROM settlement_transactions WHERE tx_hash = $1", [txHash]);
      return result.rowCount > 0;
    },
  };
}

function mapBatch(row) {
  return {
    batchId: row.batch_id,
    issuerId: row.issuer_id,
    network: row.network,
    chainId: row.chain_id,
    asset: row.asset,
    totalPayout: row.total_payout,
    status: row.status,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}

function asUniqueViolation(error) {
  const message = String(error?.message || error || "");
  const code = error?.code;
  if (code === "23505" || /unique|UNIQUE/i.test(message)) {
    const unique = new Error(message || "Unique constraint violated.");
    unique.code = "UNIQUE_VIOLATION";
    unique.cause = error;
    return unique;
  }
  return error;
}
