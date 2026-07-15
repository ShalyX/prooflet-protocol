import { json } from "../../db.mjs";

export function createProofsRepository(store) {
  if (store.dialect === "postgres") return createPostgresProofsRepository(store);
  if (store.dialect === "sqlite") return createSqliteProofsRepository(store);
  throw new Error(`Unsupported store dialect: ${store.dialect}`);
}

function createSqliteProofsRepository(store) {
  const db = () => {
    if (!store.native) throw new Error("SQLite proofs repository requires store.native.");
    return store.native;
  };

  return {
    async findByFingerprint(fingerprint) {
      const row = db().prepare("SELECT proof_id, job_id FROM proofs WHERE fingerprint = ? LIMIT 1").get(fingerprint);
      return row ? { proofId: row.proof_id, jobId: row.job_id } : null;
    },

    async getProof(proofId) {
      const row = db().prepare("SELECT * FROM proofs WHERE proof_id = ?").get(proofId);
      return row ? mapProof(row) : null;
    },

    async createProof(proof) {
      try {
        db().prepare(`
          INSERT INTO proofs
            (proof_id, job_id, agent_id, job_type, input_json, result_json, verification_route,
             proof_timestamp, fingerprint, outcome, rejection_reason, funding_status,
             settlement_status, verification_status, adjudication_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          proof.proofId,
          proof.jobId,
          proof.agentId,
          proof.jobType,
          json(proof.input ?? {}),
          json(proof.result ?? {}),
          proof.verificationRoute,
          proof.proofTimestamp,
          proof.fingerprint,
          proof.outcome,
          proof.rejectionReason ?? null,
          proof.fundingStatus,
          proof.settlementStatus,
          proof.verificationStatus,
          proof.adjudicationStatus,
          proof.createdAt,
        );
      } catch (error) {
        throw asUniqueViolation(error);
      }
      return this.getProof(proof.proofId);
    },

    async markClaimSubmitted(claimId) {
      db().prepare("UPDATE job_claims SET status = 'submitted' WHERE claim_id = ?").run(claimId);
    },

    async completeJobAfterProof({ jobId, jobStatus, fundingStatus, updatedAt }) {
      db().prepare(`
        UPDATE jobs SET status = ?, funding_status = ?, lease_expires_at = NULL, updated_at = ?
        WHERE job_id = ?
      `).run(jobStatus, fundingStatus, updatedAt, jobId);
    },
  };
}

function createPostgresProofsRepository(store) {
  const query = (text, values = []) => store.query(text, values);

  return {
    async findByFingerprint(fingerprint) {
      const result = await query("SELECT proof_id, job_id FROM proofs WHERE fingerprint = $1 LIMIT 1", [fingerprint]);
      const row = result.rows[0];
      return row ? { proofId: row.proof_id, jobId: row.job_id } : null;
    },

    async getProof(proofId) {
      const result = await query("SELECT * FROM proofs WHERE proof_id = $1", [proofId]);
      return result.rows[0] ? mapProof(result.rows[0]) : null;
    },

    async createProof(proof) {
      try {
        await query(`
          INSERT INTO proofs
            (proof_id, job_id, agent_id, job_type, input_json, result_json, verification_route,
             proof_timestamp, fingerprint, outcome, rejection_reason, funding_status,
             settlement_status, verification_status, adjudication_status, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        `, [
          proof.proofId,
          proof.jobId,
          proof.agentId,
          proof.jobType,
          json(proof.input ?? {}),
          json(proof.result ?? {}),
          proof.verificationRoute,
          proof.proofTimestamp,
          proof.fingerprint,
          proof.outcome,
          proof.rejectionReason ?? null,
          proof.fundingStatus,
          proof.settlementStatus,
          proof.verificationStatus,
          proof.adjudicationStatus,
          proof.createdAt,
        ]);
      } catch (error) {
        throw asUniqueViolation(error);
      }
      return this.getProof(proof.proofId);
    },

    async markClaimSubmitted(claimId) {
      await query("UPDATE job_claims SET status = 'submitted' WHERE claim_id = $1", [claimId]);
    },

    async completeJobAfterProof({ jobId, jobStatus, fundingStatus, updatedAt }) {
      await query(`
        UPDATE jobs SET status = $1, funding_status = $2, lease_expires_at = NULL, updated_at = $3
        WHERE job_id = $4
      `, [jobStatus, fundingStatus, updatedAt, jobId]);
    },
  };
}

function mapProof(row) {
  return {
    proofId: row.proof_id,
    jobId: row.job_id,
    agentId: row.agent_id,
    jobType: row.job_type,
    input: parseJson(row.input_json, {}),
    result: parseJson(row.result_json, {}),
    verificationRoute: row.verification_route,
    proofTimestamp: row.proof_timestamp,
    fingerprint: row.fingerprint,
    outcome: row.outcome,
    rejectionReason: row.rejection_reason,
    fundingStatus: row.funding_status,
    settlementStatus: row.settlement_status,
    verificationStatus: row.verification_status,
    adjudicationStatus: row.adjudication_status,
    createdAt: row.created_at,
    batchId: row.batch_id,
    txHash: row.tx_hash,
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
