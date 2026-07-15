import assert from "node:assert/strict";
import { tempDatabase, cleanupDatabase } from "./test-helpers.mjs";

const path = tempDatabase("settlement-check");
const { openDatabase, json } = await import("../server/db.mjs");
const { seedDatabase } = await import("../server/seed.mjs");
const { createSettlementBatch } = await import("../server/settlement.mjs");
const db = openDatabase();
try {
  seedDatabase(db);
  const historical = db.prepare("SELECT * FROM settlement_batches WHERE batch_id='uwp_arc_20260618_001'").get();
  assert.equal(historical.status, "settled"); assert.equal(historical.total_payout, "0.054");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM proofs WHERE batch_id=? AND funding_status='paid'").get(historical.batch_id).count, 3);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO jobs (job_id,issuer_id,job_type,input_json,reward_amount,proof_requirements_json,created_at,updated_at) VALUES ('settlement_check_job','useful_waiting_protocol','link_verification',?,'0.001',?,?,?)").run(json({url:"https://example.com"}),json({}),now,now);
  db.prepare(`INSERT INTO proofs (proof_id,job_id,agent_id,job_type,input_json,result_json,verification_route,proof_timestamp,fingerprint,outcome,funding_status,settlement_status,created_at) VALUES ('settlement_check_proof','settlement_check_job','agent_lynx','link_verification',?,?,?,?,'settlement-check-fingerprint','accepted','payable','Awaiting Arc Testnet settlement',?)`).run(json({url:"https://example.com"}),json({status:200}),"link_verification_v0",now,now);
  const batch = await createSettlementBatch(db,{batchId:"settlement_check_batch"});
  assert.deepEqual(batch.proofs.map((proof)=>proof.proofId),["settlement_check_proof"]);
  assert.ok(!batch.proofs.some((proof)=>["paid","rejected"].includes(proof.fundingStatus)));
  const first=db.prepare("UPDATE settlement_batches SET status='executing' WHERE batch_id=? AND status='prepared'").run(batch.batchId);
  const second=db.prepare("UPDATE settlement_batches SET status='executing' WHERE batch_id=? AND status='prepared'").run(batch.batchId);
  assert.equal(first.changes,1); assert.equal(second.changes,0);
  console.log(JSON.stringify({ok:true,historicalBatch:historical.batch_id,totalPayout:historical.total_payout,concurrentLockProtected:true},null,2));
} finally { db.close(); cleanupDatabase(path); }
