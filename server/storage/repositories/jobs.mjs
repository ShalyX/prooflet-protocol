import { json } from "../../db.mjs";

export function createJobsRepository(store) {
  if (store.dialect === "postgres") return createPostgresJobsRepository(store);
  if (store.dialect === "sqlite") return createSqliteJobsRepository(store);
  throw new Error(`Unsupported store dialect: ${store.dialect}`);
}

function createSqliteJobsRepository(store) {
  const db = () => {
    if (!store.native) throw new Error("SQLite jobs repository requires store.native.");
    return store.native;
  };

  return {
    async createJob(job) {
      try {
        db().prepare(`
          INSERT INTO jobs
            (job_id, issuer_reference_id, issuer_id, job_type, input_json, reward_amount, reward_asset, network,
             funding_status, status, proof_requirements_json, claimed_by, lease_expires_at, created_at, updated_at,
             verification_mode, required_access_level, compound_parent_id, funding_rail, escrow_status, escrow_tx_hash,
             funding_source, treasury_tx_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL)
        `).run(
          job.jobId,
          job.issuerReferenceId ?? null,
          job.issuerId,
          job.jobType,
          json(job.input ?? {}),
          String(job.rewardAmount),
          job.rewardAsset || "USDC",
          job.network || "Arc Testnet",
          job.fundingStatus || "reserved",
          job.status || "open",
          json(job.proofRequirements ?? {}),
          job.createdAt,
          job.updatedAt || job.createdAt,
          job.verificationMode || "deterministic",
          job.requiredAccessLevel || "starter",
          job.fundingRail || "direct_treasury",
        );
      } catch (error) {
        throw asUniqueViolation(error);
      }
      return mapJob(db().prepare("SELECT * FROM jobs WHERE job_id = ?").get(job.jobId));
    },

    async getJob(jobId) {
      const row = db().prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId);
      return row ? mapJob(row) : null;
    },

    async claimJob({ jobId, agentId, claimedAt, leaseExpiresAt, access = {} }) {
      const updated = db().prepare(`
        UPDATE jobs
        SET status = 'claimed', claimed_by = ?, lease_expires_at = ?, updated_at = ?
        WHERE job_id = ? AND status = 'open'
      `).run(agentId, leaseExpiresAt, claimedAt, jobId);

      if (updated.changes !== 1) {
        const error = new Error(`Job ${jobId} is not claimable.`);
        error.code = "JOB_NOT_CLAIMABLE";
        throw error;
      }

      db().prepare(`
        INSERT INTO job_claims
          (job_id, agent_id, claimed_at, lease_expires_at, status, claim_access_rail, claim_access_price, claim_access_status, claim_access_tx_hash)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
      `).run(
        jobId,
        agentId,
        claimedAt,
        leaseExpiresAt,
        access.rail || "none",
        access.price || "0",
        access.status || "unpaid",
        access.txHash || null,
      );

      return mapJob(db().prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId));
    },
  };
}

function createPostgresJobsRepository(store) {
  const query = (text, values = []) => store.query(text, values);

  return {
    async createJob(job) {
      try {
        await query(`
          INSERT INTO jobs
            (job_id, issuer_reference_id, issuer_id, job_type, input_json, reward_amount, reward_asset, network,
             funding_status, status, proof_requirements_json, claimed_by, lease_expires_at, created_at, updated_at,
             verification_mode, required_access_level, compound_parent_id, funding_rail, escrow_status, escrow_tx_hash,
             funding_source, treasury_tx_hash)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NULL,$12,$13,$14,$15,NULL,$16,NULL,NULL,NULL,NULL)
        `, [
          job.jobId,
          job.issuerReferenceId ?? null,
          job.issuerId,
          job.jobType,
          json(job.input ?? {}),
          String(job.rewardAmount),
          job.rewardAsset || "USDC",
          job.network || "Arc Testnet",
          job.fundingStatus || "reserved",
          job.status || "open",
          json(job.proofRequirements ?? {}),
          job.createdAt,
          job.updatedAt || job.createdAt,
          job.verificationMode || "deterministic",
          job.requiredAccessLevel || "starter",
          job.fundingRail || "direct_treasury",
        ]);
      } catch (error) {
        throw asUniqueViolation(error);
      }
      return mapJob((await query("SELECT * FROM jobs WHERE job_id = $1", [job.jobId])).rows[0]);
    },

    async getJob(jobId) {
      const result = await query("SELECT * FROM jobs WHERE job_id = $1", [jobId]);
      return result.rows[0] ? mapJob(result.rows[0]) : null;
    },

    async claimJob({ jobId, agentId, claimedAt, leaseExpiresAt, access = {} }) {
      // Conditional update is the atomic claim gate; works with transaction-pinned clients.
      const result = await query(`
        UPDATE jobs
        SET status = 'claimed', claimed_by = $1, lease_expires_at = $2, updated_at = $3
        WHERE job_id = $4 AND status = 'open'
        RETURNING *
      `, [agentId, leaseExpiresAt, claimedAt, jobId]);

      if (result.rowCount !== 1) {
        const error = new Error(`Job ${jobId} is not claimable.`);
        error.code = "JOB_NOT_CLAIMABLE";
        throw error;
      }

      await query(`
        INSERT INTO job_claims
          (job_id, agent_id, claimed_at, lease_expires_at, status, claim_access_rail, claim_access_price, claim_access_status, claim_access_tx_hash)
        VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8)
      `, [
        jobId,
        agentId,
        claimedAt,
        leaseExpiresAt,
        access.rail || "none",
        access.price || "0",
        access.status || "unpaid",
        access.txHash || null,
      ]);

      return mapJob(result.rows[0]);
    },
  };
}

function mapJob(row) {
  return {
    jobId: row.job_id,
    issuerId: row.issuer_id,
    issuerReferenceId: row.issuer_reference_id,
    jobType: row.job_type,
    input: parseJson(row.input_json, {}),
    rewardAmount: row.reward_amount,
    rewardAsset: row.reward_asset,
    network: row.network,
    fundingStatus: row.funding_status,
    status: row.status,
    proofRequirements: parseJson(row.proof_requirements_json, {}),
    claimedBy: row.claimed_by,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    verificationMode: row.verification_mode,
    requiredAccessLevel: row.required_access_level,
    fundingRail: row.funding_rail,
    escrowStatus: row.escrow_status,
    escrowTxHash: row.escrow_tx_hash,
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
