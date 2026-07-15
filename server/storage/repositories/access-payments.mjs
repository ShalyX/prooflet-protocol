import { json } from "../../db.mjs";

export function createAccessPaymentsRepository(store) {
  if (store.dialect === "postgres") return createPostgresAccessPaymentsRepository(store);
  if (store.dialect === "sqlite") return createSqliteAccessPaymentsRepository(store);
  throw new Error(`Unsupported store dialect: ${store.dialect}`);
}

function createSqliteAccessPaymentsRepository(store) {
  const db = () => {
    if (!store.native) throw new Error("SQLite access payments repository requires store.native.");
    return store.native;
  };

  return {
    async recordPaidAccess(payment) {
      const now = payment.updatedAt || payment.createdAt || new Date().toISOString();
      try {
        db().prepare(`
          INSERT INTO job_access_payments
            (job_id, agent_id, rail, amount, payer_address, tx_hash, gateway_transaction_id, network, status, metadata_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?)
          ON CONFLICT(job_id, agent_id) DO UPDATE SET
            rail=excluded.rail,
            amount=excluded.amount,
            payer_address=COALESCE(excluded.payer_address, job_access_payments.payer_address),
            tx_hash=COALESCE(excluded.tx_hash, job_access_payments.tx_hash),
            gateway_transaction_id=COALESCE(excluded.gateway_transaction_id, job_access_payments.gateway_transaction_id),
            network=excluded.network,
            status='paid',
            metadata_json=excluded.metadata_json,
            updated_at=excluded.updated_at
        `).run(
          payment.jobId,
          payment.agentId,
          payment.rail,
          payment.amount,
          payment.payerAddress ?? null,
          payment.txHash ?? null,
          payment.gatewayTransactionId ?? null,
          payment.network,
          json(payment.metadata || {}),
          payment.createdAt || now,
          now,
        );
      } catch (error) {
        throw asUniqueViolation(error);
      }
      return this.getPaidAccess(payment.jobId, payment.agentId);
    },

    async getPaidAccess(jobId, agentId) {
      const row = db().prepare("SELECT * FROM job_access_payments WHERE job_id=? AND agent_id=?").get(jobId, agentId);
      return row ? mapPayment(row) : null;
    },

    async hasPaidAccess(jobId, agentId) {
      return !!db().prepare("SELECT 1 FROM job_access_payments WHERE job_id=? AND agent_id=? AND status='paid'").get(jobId, agentId);
    },

    async findByTxHash(txHash) {
      if (!txHash) return null;
      const row = db().prepare("SELECT * FROM job_access_payments WHERE tx_hash=?").get(txHash);
      return row ? mapPayment(row) : null;
    },

    async findByGatewayTransactionId(gatewayTransactionId) {
      if (!gatewayTransactionId) return null;
      const row = db().prepare("SELECT * FROM job_access_payments WHERE gateway_transaction_id=?").get(gatewayTransactionId);
      return row ? mapPayment(row) : null;
    },
  };
}

function createPostgresAccessPaymentsRepository(store) {
  const query = (text, values = []) => store.query(text, values);

  return {
    async recordPaidAccess(payment) {
      const now = payment.updatedAt || payment.createdAt || new Date().toISOString();
      try {
        await query(`
          INSERT INTO job_access_payments
            (job_id, agent_id, rail, amount, payer_address, tx_hash, gateway_transaction_id, network, status, metadata_json, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'paid',$9,$10,$11)
          ON CONFLICT (job_id, agent_id) DO UPDATE SET
            rail=EXCLUDED.rail,
            amount=EXCLUDED.amount,
            payer_address=COALESCE(EXCLUDED.payer_address, job_access_payments.payer_address),
            tx_hash=COALESCE(EXCLUDED.tx_hash, job_access_payments.tx_hash),
            gateway_transaction_id=COALESCE(EXCLUDED.gateway_transaction_id, job_access_payments.gateway_transaction_id),
            network=EXCLUDED.network,
            status='paid',
            metadata_json=EXCLUDED.metadata_json,
            updated_at=EXCLUDED.updated_at
        `, [
          payment.jobId,
          payment.agentId,
          payment.rail,
          payment.amount,
          payment.payerAddress ?? null,
          payment.txHash ?? null,
          payment.gatewayTransactionId ?? null,
          payment.network,
          json(payment.metadata || {}),
          payment.createdAt || now,
          now,
        ]);
      } catch (error) {
        throw asUniqueViolation(error);
      }
      return this.getPaidAccess(payment.jobId, payment.agentId);
    },

    async getPaidAccess(jobId, agentId) {
      const result = await query("SELECT * FROM job_access_payments WHERE job_id=$1 AND agent_id=$2", [jobId, agentId]);
      return result.rows[0] ? mapPayment(result.rows[0]) : null;
    },

    async hasPaidAccess(jobId, agentId) {
      const result = await query(
        "SELECT 1 AS paid FROM job_access_payments WHERE job_id=$1 AND agent_id=$2 AND status='paid'",
        [jobId, agentId],
      );
      return result.rowCount > 0;
    },

    async findByTxHash(txHash) {
      if (!txHash) return null;
      const result = await query("SELECT * FROM job_access_payments WHERE tx_hash=$1", [txHash]);
      return result.rows[0] ? mapPayment(result.rows[0]) : null;
    },

    async findByGatewayTransactionId(gatewayTransactionId) {
      if (!gatewayTransactionId) return null;
      const result = await query("SELECT * FROM job_access_payments WHERE gateway_transaction_id=$1", [gatewayTransactionId]);
      return result.rows[0] ? mapPayment(result.rows[0]) : null;
    },
  };
}

function mapPayment(row) {
  return {
    jobId: row.job_id,
    agentId: row.agent_id,
    rail: row.rail,
    amount: row.amount,
    payerAddress: row.payer_address,
    txHash: row.tx_hash,
    gatewayTransactionId: row.gateway_transaction_id,
    network: row.network,
    status: row.status,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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
