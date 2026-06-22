import { randomUUID } from "node:crypto";
import { json, parseJson, withTransaction } from "../db.mjs";
import { appendReputationEvent } from "../reputation.mjs";
import { ManualAdapter } from "./adapters.mjs";

const manual = new ManualAdapter();

export function listPendingAdjudications(db) {
  return db.prepare(`SELECT p.*,j.issuer_id,j.reward_amount FROM proofs p JOIN jobs j USING(job_id)
    WHERE p.adjudication_status='pending_adjudication' AND p.funding_status='pending_adjudication'
    ORDER BY p.created_at`).all().map(serializeAdjudicationProof);
}

export function getAdjudicationProof(db, proofId) {
  const row = db.prepare(`SELECT p.*,j.issuer_id,j.reward_amount FROM proofs p JOIN jobs j USING(job_id) WHERE p.proof_id=?`).get(proofId);
  return row ? serializeAdjudicationProof(row) : null;
}

export function decideProof(db, proofId, adjudicatorId, payload) {
  const { decision, reason, confidence, evidenceReviewed = {} } = payload || {};
  if (!["approved", "rejected"].includes(decision)) throw adjudicationError(400, "invalid_decision_reason", "decision must be approved or rejected.");
  if (typeof reason !== "string" || reason.trim().length < 3) throw adjudicationError(400, "invalid_decision_reason", "A meaningful decision reason is required.");
  if (!Number.isFinite(Number(confidence)) || Number(confidence) < 0 || Number(confidence) > 1) throw adjudicationError(400, "invalid_decision_reason", "confidence must be between 0 and 1.");
  if (!evidenceReviewed || typeof evidenceReviewed !== "object" || Array.isArray(evidenceReviewed)) throw adjudicationError(400, "invalid_decision_reason", "evidenceReviewed must be an object.");
  return withTransaction(db, () => {
    const proof = db.prepare(`SELECT p.*,j.issuer_id FROM proofs p JOIN jobs j USING(job_id) WHERE p.proof_id=?`).get(proofId);
    if (!proof) throw adjudicationError(404, "proof_not_found", `Proof ${proofId} does not exist.`);
    if (proof.funding_status === "paid" || proof.tx_hash) throw adjudicationError(409, "proof_already_paid", "Paid proofs cannot be adjudicated.");
    if (proof.adjudication_status !== "pending_adjudication") throw adjudicationError(409, "proof_not_pending_adjudication", "Proof is not pending adjudication.");
    const now = new Date().toISOString();
    const decisionId = `decision_${randomUUID()}`;
    db.prepare(`INSERT INTO adjudication_decisions
      (decision_id,proof_id,job_id,agent_id,issuer_id,adjudicator_id,decision,reason,confidence,evidence_reviewed_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(decisionId, proofId, proof.job_id, proof.agent_id, proof.issuer_id, adjudicatorId, decision, reason.trim(), Number(confidence), json(evidenceReviewed), now);
    const approved = decision === "approved";
    db.prepare(`UPDATE proofs SET outcome=?,rejection_reason=?,funding_status=?,settlement_status=?,verification_status=?,adjudication_status=? WHERE proof_id=?`)
      .run(approved ? "accepted" : "rejected", approved ? null : reason.trim(), approved ? "payable" : "rejected", approved ? "Awaiting Arc Testnet settlement" : "Rejected · No payout", approved ? "approved_by_manual_adapter" : "rejected_by_manual_adapter", approved ? "approved" : "rejected", proofId);
    db.prepare("UPDATE jobs SET status=?,funding_status=?,updated_at=? WHERE job_id=?").run(approved ? "completed" : "rejected", approved ? "payable" : "rejected", now, proof.job_id);
    appendReputationEvent(db, { agentId: proof.agent_id, eventType: approved ? "manual_adjudication_approved" : "manual_adjudication_rejected", jobId: proof.job_id, proofId, issuerId: proof.issuer_id, metadata: { decisionId, reason: reason.trim(), confidence: Number(confidence) }, createdAt: now });
    return manual.getDecision({ decision, reason: reason.trim(), confidence: Number(confidence), adjudicatorId, timestamp: now });
  });
}

export function pendingManualRequest(proofId, timestamp) { return manual.submit({ proofId, timestamp }); }

function serializeAdjudicationProof(row) {
  return { proofId: row.proof_id, jobId: row.job_id, agentId: row.agent_id, issuerId: row.issuer_id, jobType: row.job_type, input: parseJson(row.input_json, {}), result: parseJson(row.result_json, {}), rewardAmount: row.reward_amount, verificationStatus: row.verification_status, adjudicationStatus: row.adjudication_status, proofTimestamp: row.proof_timestamp };
}

function adjudicationError(status, code, message) { const error = new Error(message); error.status = status; error.code = code; return error; }
