import { randomUUID } from "node:crypto";
import { json, parseJson } from "./db.mjs";

export async function appendReputationEvent(db, event) {
  const createdAt = event.createdAt || new Date().toISOString();
  const eventId = event.eventId || `rep_${randomUUID()}`;
  // SQLite: INSERT OR IGNORE; Postgres: ON CONFLICT DO NOTHING
  await Promise.resolve(db.prepare(`
    INSERT INTO reputation_events
      (event_id, agent_id, event_type, job_id, proof_id, issuer_id, batch_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (event_id) DO NOTHING
  `).run(
    eventId,
    event.agentId,
    event.eventType,
    event.jobId || null,
    event.proofId || null,
    event.issuerId || null,
    event.batchId || null,
    json(event.metadata || {}),
    createdAt,
  ));
  await rebuildAgentReputation(db, event.agentId);
  return eventId;
}

export async function backfillReputation(db) {
  for (const agent of await Promise.resolve(db.prepare("SELECT * FROM agents").all())) {
    await appendReputationEvent(db, {
      eventId: `backfill:registered:${agent.agent_id}`,
      agentId: agent.agent_id,
      eventType: "agent_registered",
      createdAt: agent.created_at,
    });
  }
  for (const claim of await Promise.resolve(
    db.prepare("SELECT c.*, j.issuer_id FROM job_claims c JOIN jobs j ON j.job_id=c.job_id").all(),
  )) {
    await appendReputationEvent(db, {
      eventId: `backfill:claim:${claim.claim_id}`,
      agentId: claim.agent_id,
      eventType: claim.status === "expired" ? "job_lease_expired" : "job_claimed",
      jobId: claim.job_id,
      issuerId: claim.issuer_id,
      createdAt: claim.claimed_at,
    });
  }
  for (const proof of await Promise.resolve(
    db.prepare("SELECT p.*, j.issuer_id, j.reward_amount FROM proofs p JOIN jobs j ON j.job_id=p.job_id").all(),
  )) {
    if (proof.outcome === "pending_adjudication") continue;
    const recorded = await Promise.resolve(db.prepare(`SELECT 1 FROM reputation_events WHERE proof_id=? AND event_type IN
      ('proof_approved','proof_rejected','duplicate_proof_rejected','manual_adjudication_approved','manual_adjudication_rejected','genlayer_adjudication_approved','genlayer_adjudication_rejected') LIMIT 1`).get(proof.proof_id));
    if (recorded) continue;
    const duplicate = proof.verification_route === "duplicate_proof_v0";
    const fixture = proof.job_type === "duplicate_proof";
    await appendReputationEvent(db, {
      eventId: `backfill:proof:${proof.proof_id}`,
      agentId: proof.agent_id,
      eventType: duplicate ? "duplicate_proof_rejected" : proof.outcome === "accepted" ? "proof_approved" : "proof_rejected",
      jobId: proof.job_id,
      proofId: proof.proof_id,
      issuerId: proof.issuer_id,
      metadata: fixture ? { fixture: true, excludeFromReputation: true } : {},
      createdAt: proof.created_at,
    });
    if (fixture) {
      await Promise.resolve(
        db.prepare("UPDATE reputation_events SET metadata_json=? WHERE event_id=?")
          .run(json({ fixture: true, excludeFromReputation: true }), `backfill:proof:${proof.proof_id}`),
      );
    }
    if (proof.funding_status === "paid") {
      await appendReputationEvent(db, {
        eventId: `backfill:paid:${proof.proof_id}`,
        agentId: proof.agent_id,
        eventType: "proof_paid",
        jobId: proof.job_id,
        proofId: proof.proof_id,
        issuerId: proof.issuer_id,
        batchId: proof.batch_id,
        metadata: { amount: proof.reward_amount },
        createdAt: proof.created_at,
      });
    }
  }
  return rebuildAllReputation(db);
}

export async function rebuildAllReputation(db) {
  for (const row of await Promise.resolve(db.prepare("SELECT agent_id FROM agents").all())) {
    await rebuildAgentReputation(db, row.agent_id);
  }
  return (await Promise.resolve(db.prepare("SELECT COUNT(*) AS count FROM agent_reputation_summary").get())).count;
}

export async function rebuildAgentReputation(db, agentId) {
  const events = await Promise.resolve(
    db.prepare("SELECT * FROM reputation_events WHERE agent_id=? ORDER BY created_at,event_id").all(agentId),
  );
  const scoringEvents = events.filter((event) => !parseJson(event.metadata_json, {}).excludeFromReputation);
  const count = (type) => scoringEvents.filter((event) => event.event_type === type).length;
  const approved = count("proof_approved") + count("manual_adjudication_approved") + count("genlayer_adjudication_approved");
  const rejected = count("proof_rejected") + count("duplicate_proof_rejected") + count("manual_adjudication_rejected") + count("genlayer_adjudication_rejected");
  const duplicate = count("duplicate_proof_rejected");
  const paid = count("proof_paid");
  const timeout = count("job_lease_expired");
  const settled = scoringEvents.filter((event) => event.event_type === "proof_paid")
    .reduce((sum, event) => sum + Number(parseJson(event.metadata_json, {}).amount || 0), 0);
  const cutoff = Date.now() - 30 * 86400000;
  const recent = scoringEvents.filter((event) => Date.parse(event.created_at) >= cutoff);
  const recentApproved = recent.filter((event) => ["proof_approved", "manual_adjudication_approved", "genlayer_adjudication_approved"].includes(event.event_type)).length;
  const recentRejected = recent.filter((event) => ["proof_rejected", "duplicate_proof_rejected", "manual_adjudication_rejected", "genlayer_adjudication_rejected"].includes(event.event_type)).length;
  const recentDuplicates = recent.filter((event) => event.event_type === "duplicate_proof_rejected").length;
  const denominator = recentApproved + recentRejected;
  const activeFraud = events.reduce((active, event) => event.event_type === "fraud_flag_added" ? true : event.event_type === "fraud_flag_cleared" ? false : active, false);
  const risk = activeFraud || duplicate >= 2 ? "blocked" : duplicate === 1 ? "watch" : "clean";
  const approvalRate = denominator ? recentApproved / denominator : 0;
  const duplicateRate = denominator ? recentDuplicates / denominator : 0;
  let access = "starter";
  if (risk === "blocked") access = "blocked";
  else if (approved >= 10 && paid >= 5 && approvalRate >= .9 && duplicate === 0 && timeout <= 2 && settled >= .05 && risk === "clean") access = "trusted";
  else if (approved >= 3 && paid >= 1 && approvalRate >= .75 && duplicate === 0 && risk === "clean") access = "standard";
  const lastEventAt = events.at(-1)?.created_at || null;
  const now = new Date().toISOString();
  await Promise.resolve(db.prepare(`INSERT INTO agent_reputation_summary
    (agent_id,approved_proofs,rejected_proofs,duplicate_proofs,paid_proofs,timeout_count,settled_volume_usdc,approval_rate_30d,duplicate_rate_30d,last_event_at,current_risk_flag,access_level,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET
    approved_proofs=excluded.approved_proofs,rejected_proofs=excluded.rejected_proofs,duplicate_proofs=excluded.duplicate_proofs,
    paid_proofs=excluded.paid_proofs,timeout_count=excluded.timeout_count,settled_volume_usdc=excluded.settled_volume_usdc,
    approval_rate_30d=excluded.approval_rate_30d,duplicate_rate_30d=excluded.duplicate_rate_30d,last_event_at=excluded.last_event_at,
    current_risk_flag=excluded.current_risk_flag,access_level=excluded.access_level,updated_at=excluded.updated_at`)
    .run(agentId, approved, rejected, duplicate, paid, timeout, settled.toFixed(6), approvalRate, duplicateRate, lastEventAt, risk, access, now));
  return getReputationSummary(db, agentId);
}

export async function getReputationSummary(db, agentId) {
  const row = await Promise.resolve(db.prepare("SELECT * FROM agent_reputation_summary WHERE agent_id=?").get(agentId));
  if (!row) {
    return {
      agentId,
      approvedProofs: 0,
      rejectedProofs: 0,
      duplicateProofs: 0,
      paidProofs: 0,
      timeoutCount: 0,
      settledVolumeUSDC: "0.000000",
      approvalRate30d: 0,
      duplicateRate30d: 0,
      lastEventAt: null,
      currentRiskFlag: "clean",
      accessLevel: "starter",
    };
  }
  return {
    agentId: row.agent_id,
    approvedProofs: row.approved_proofs,
    rejectedProofs: row.rejected_proofs,
    duplicateProofs: row.duplicate_proofs,
    paidProofs: row.paid_proofs,
    timeoutCount: row.timeout_count,
    settledVolumeUSDC: row.settled_volume_usdc,
    approvalRate30d: row.approval_rate_30d,
    duplicateRate30d: row.duplicate_rate_30d,
    lastEventAt: row.last_event_at,
    currentRiskFlag: row.current_risk_flag,
    accessLevel: row.access_level,
  };
}
