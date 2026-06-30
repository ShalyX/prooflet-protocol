/**
 * Multi-agent orchestration: compound jobs that require MULTIPLE agents
 * to complete sub-tasks before the combined payout is released.
 *
 * Escrow pattern: rewards held until ALL sub-proofs are accepted.
 * Failure of any sub-task = compound job fails, no payout.
 */
import { json, withTransaction } from "./db.mjs";

/**
 * Create a compound job with sub-tasks.
 * Returns the parent job and an array of created sub-jobs.
 */
export function createCompoundJob(db, {
  jobId, issuerId, subTasks, combinedReward,
  verificationMode = "deterministic",
}) {
  if (!Array.isArray(subTasks) || subTasks.length < 2) {
    throw new Error("compound_job: subTasks must be an array with at least 2 items.");
  }
  if (subTasks.length > 4) {
    throw new Error("compound_job: maximum 4 sub-tasks per compound job.");
  }

  const now = new Date().toISOString();
  const subJobIds = [];

  return withTransaction(db, () => {
    // 1. Create the parent compound job
    const parentInput = json({ subTasks, compoundJobId: jobId });
    db.prepare(`
      INSERT INTO jobs
        (job_id, issuer_id, job_type, input_json, reward_amount, reward_asset, network,
         funding_status, status, proof_requirements_json, verification_mode, required_access_level, created_at, updated_at)
      VALUES (?, ?, 'compound_job', ?, ?, 'USDC', 'Arc Testnet',
              'reserved', 'compound_pending', ?, ?, ?, ?, ?)
    `).run(jobId, issuerId, parentInput, combinedReward, json({ requiresSubProofs: subTasks.length }), verificationMode, "starter", now, now);

    // 2. Create sub-jobs, each linked to the parent
    const insertSub = db.prepare(`
      INSERT INTO jobs
        (job_id, issuer_id, job_type, input_json, reward_amount, reward_asset, network,
         funding_status, status, proof_requirements_json, verification_mode, required_access_level, compound_parent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'USDC', 'Arc Testnet',
              'reserved', 'open', ?, 'deterministic', 'starter', ?, ?, ?)
    `);

    const splitReward = (Number(combinedReward) / subTasks.length).toFixed(6);

    for (let i = 0; i < subTasks.length; i++) {
      const subTask = subTasks[i];
      const subJobId = `${jobId}_sub_${i + 1}`;
      subJobIds.push(subJobId);

      const requirements = {
        requiredResultFields: subTask.requiredResultFields || [],
        parentJob: jobId,
        subTaskIndex: i,
      };

      insertSub.run(
        subJobId, issuerId, subTask.type, json(subTask.input), splitReward,
        json(requirements), jobId, now, now
      );
    }

    // 3. Create compound tracking record
    db.exec(`
      CREATE TABLE IF NOT EXISTS compound_jobs (
        parent_job_id TEXT PRIMARY KEY,
        issuer_id TEXT NOT NULL,
        combined_reward TEXT NOT NULL,
        sub_job_ids_json TEXT NOT NULL,
        sub_task_types_json TEXT NOT NULL,
        completed_sub_proofs INTEGER NOT NULL DEFAULT 0,
        total_sub_jobs INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        completed_at TEXT
      )
    `);

    db.prepare(`
      INSERT OR IGNORE INTO compound_jobs
        (parent_job_id, issuer_id, combined_reward, sub_job_ids_json, sub_task_types_json,
         completed_sub_proofs, total_sub_jobs, status, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', ?)
    `).run(
      jobId, issuerId, combinedReward,
      json(subJobIds),
      json(subTasks.map((t) => t.type)),
      subTasks.length,
      now,
    );

    return { parentJobId: jobId, subJobIds, totalReward: combinedReward, subTaskCount: subTasks.length };
  });
}

/**
 * Check if a proof completion completes a compound job.
 * If all sub-proofs are accepted, mark the compound job as payable.
 * Returns { compoundComplete: boolean, compoundStatus: string }.
 */
export function checkCompoundJobCompletion(db, proof) {
  // Find the parent job via the proof's job_id -> check if job has compound_parent_id
  const job = db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(proof.jobId);
  if (!job || !job.compound_parent_id) return { compoundComplete: false, compoundStatus: null };

  const parentId = job.compound_parent_id;
  const compound = db.prepare("SELECT * FROM compound_jobs WHERE parent_job_id = ?").get(parentId);
  if (!compound) return { compoundComplete: false, compoundStatus: null };

  if (compound.status !== "pending") {
    return { compoundComplete: compound.status === "completed", compoundStatus: compound.status };
  }

  // Count accepted proofs across all sub-jobs
  const subJobIds = JSON.parse(compound.sub_job_ids_json);
  const acceptedCount = db.prepare(`
    SELECT COUNT(*) AS count FROM proofs
    WHERE job_id IN (${subJobIds.map(() => "?").join(",")})
    AND outcome = 'accepted'
  `).get(...subJobIds).count;

  const allAccepted = acceptedCount >= compound.total_sub_jobs;

  if (allAccepted) {
    const now = new Date().toISOString();

    // Called from proof submission, which already owns the surrounding transaction.
    // Do not open a nested SQLite transaction here.
    db.prepare(`
      UPDATE compound_jobs SET status = 'completed', completed_sub_proofs = ?, completed_at = ?
      WHERE parent_job_id = ?
    `).run(acceptedCount, now, parentId);

    db.prepare(`
      UPDATE jobs SET status = 'completed', funding_status = 'payable', updated_at = ?
      WHERE job_id = ?
    `).run(now, parentId);

    // Parent compound job is marked payable when all sub-proofs pass.
    // Do not insert a synthetic parent proof here: proofs.agent_id has a real-agent FK,
    // and inserting a fake "system" proof would also risk double-counting settlement.

    return { compoundComplete: true, compoundStatus: "completed" };
  }

  // Update progress
  db.prepare(`
    UPDATE compound_jobs SET completed_sub_proofs = ? WHERE parent_job_id = ?
  `).run(acceptedCount, parentId);

  return { compoundComplete: false, compoundStatus: "pending", completedSubProofs: acceptedCount, totalSubJobs: compound.total_sub_jobs };
}

/**
 * Check if a rejected proof should fail the entire compound job.
 */
export function checkCompoundJobFailure(db, proof) {
  const job = db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(proof.jobId);
  if (!job || !job.compound_parent_id) return false;

  const parentId = job.compound_parent_id;
  const compound = db.prepare("SELECT * FROM compound_jobs WHERE parent_job_id = ?").get(parentId);
  if (!compound || compound.status !== "pending") return false;

  // If any sub-job proof is rejected, the entire compound job fails
  const now = new Date().toISOString();
  // Called from proof submission, which already owns the surrounding transaction.
  // Do not open a nested SQLite transaction here.
  db.prepare("UPDATE compound_jobs SET status = 'failed', completed_at = ? WHERE parent_job_id = ?")
    .run(now, parentId);
  db.prepare("UPDATE jobs SET status = 'rejected', funding_status = 'rejected', updated_at = ? WHERE job_id = ?")
    .run(now, parentId);

  return true;
}

/**
 * List all compound jobs with their status.
 */
export function listCompoundJobs(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS compound_jobs (
      parent_job_id TEXT PRIMARY KEY,
      issuer_id TEXT NOT NULL,
      combined_reward TEXT NOT NULL,
      sub_job_ids_json TEXT NOT NULL,
      sub_task_types_json TEXT NOT NULL,
      completed_sub_proofs INTEGER NOT NULL DEFAULT 0,
      total_sub_jobs INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      completed_at TEXT
    )
  `);

  return db.prepare("SELECT * FROM compound_jobs ORDER BY created_at DESC").all().map((row) => ({
    parentJobId: row.parent_job_id,
    issuerId: row.issuer_id,
    combinedReward: row.combined_reward,
    subJobIds: JSON.parse(row.sub_job_ids_json),
    subTaskTypes: JSON.parse(row.sub_task_types_json),
    completedSubProofs: row.completed_sub_proofs,
    totalSubJobs: row.total_sub_jobs,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}