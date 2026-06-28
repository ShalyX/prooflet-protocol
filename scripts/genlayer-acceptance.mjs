import assert from "node:assert/strict";
import { api, startTestApi } from "./test-helpers.mjs";
import { AgentClient } from "@useful-waiting/agent-sdk";
import { IssuerClient } from "@useful-waiting/issuer-sdk";
import { GenLayerNotConfiguredError, UsefulWaitingClient } from "@useful-waiting/sdk-core";

process.env.ADJUDICATION_MODE = "mock_genlayer";
process.env.GENLAYER_NETWORK = "localnet";
const test = await startTestApi("genlayer-adjudication-check");
const issuerKey = "uwp_issuer_useful_waiting_protocol_dev";
const operatorKey = "uwp_adjudicator_genlayer_operator_dev";

async function createSubjective(suffix, mockDecision) {
  const agentId = `compression_agent_${suffix}`;
  const registered = await api(test.baseUrl, "POST", "/agents/register", { agentId, name: `Compression ${suffix}`,
    capabilities: ["context_compression_quality"], payoutAddress: `0x${String(suffix.length + 70).padStart(40, "0")}` });
  test.db.prepare("UPDATE agent_reputation_summary SET access_level='trusted',current_risk_flag='clean',duplicate_proofs=0 WHERE agent_id=?").run(agentId);
  const jobId = `compression_job_${suffix}`;
  const proofId = `compression_proof_${suffix}`;
  const input = { originalContext: `Important Arc settlement context ${suffix}`, importantFacts: ["Arc Testnet", "USDC"] };
  const created = await api(test.baseUrl, "POST", "/jobs", { jobId, issuerId: "useful_waiting_protocol", jobType: "context_compression_quality", input,
    rewardAmount: "0.01", proofRequirements: { requiredResultFields: ["originalHash", "originalLength", "compressedText", "compressedLength", "claimedRetainedFacts", "compressionRatio"], mockDecision }, verificationMode: "subjective" }, issuerKey);
  assert.equal(created.status, 201);
  assert.equal((await api(test.baseUrl, "POST", `/agents/${agentId}/claim-job`, { jobId }, registered.body.apiKey)).status, 200);
  const result = { originalHash: `sha256:${suffix}`, originalLength: 100, compressedText: `Arc Testnet uses USDC ${suffix}`, compressedLength: 30,
    claimedRetainedFacts: ["Arc Testnet", "USDC"], compressionRatio: 0.3 };
  const submitted = await api(test.baseUrl, "POST", `/jobs/${jobId}/proof`, { proofId, agentId, jobId, jobType: "context_compression_quality", input, result,
    verificationRoute: "adjudication_router", proofTimestamp: new Date().toISOString() }, registered.body.apiKey);
  return { agentId, agentKey: registered.body.apiKey, jobId, proofId, submitted };
}

try {
  const approved = await createSubjective("approved", "approved");
  assert.equal(approved.submitted.body.proof.fundingStatus, "payable");
  assert.equal(approved.submitted.body.adjudication.status, "finalized");
  assert.equal(approved.submitted.body.adjudication.decision.decision, "approved");

  const rejected = await createSubjective("rejected", "rejected");
  assert.equal(rejected.submitted.body.proof.fundingStatus, "rejected");
  assert.equal(rejected.submitted.body.adjudication.decision.decision, "rejected");

  process.env.ADJUDICATION_MODE = "manual";
  const pending = await createSubjective("pending", "approved");
  assert.equal(pending.submitted.body.proof.fundingStatus, "pending_adjudication");

  const unauthorizedIssuer = await api(test.baseUrl, "POST", `/adjudication/genlayer/proofs/${pending.proofId}/submit`, null, issuerKey);
  const unauthorizedAgent = await api(test.baseUrl, "POST", `/adjudication/genlayer/proofs/${pending.proofId}/submit`, null, pending.agentKey);
  assert.equal(unauthorizedIssuer.body.code, "missing_adjudicator_scope");
  assert.equal(unauthorizedAgent.body.code, "missing_adjudicator_scope");

  process.env.ADJUDICATION_MODE = "genlayer";
  delete process.env.GENLAYER_CONTRACT_ADDRESS;
  delete process.env.GENLAYER_PRIVATE_KEY;
  const operator = new UsefulWaitingClient({ baseUrl: test.baseUrl, apiKey: operatorKey });
  await assert.rejects(operator.request(`/adjudication/genlayer/proofs/${pending.proofId}/submit`, { method: "POST" }), GenLayerNotConfiguredError);
  assert.equal(test.db.prepare("SELECT funding_status FROM proofs WHERE proof_id=?").get(pending.proofId).funding_status, "pending_adjudication");

  const paid = await api(test.baseUrl, "POST", "/adjudication/genlayer/proofs/0x72fa/submit", null, operatorKey);
  assert.equal(paid.body.code, "proof_already_paid");

  process.env.ADJUDICATION_MODE = "mock_genlayer";
  const deterministicAgent = await api(test.baseUrl, "POST", "/agents/register", { agentId: "deterministic_gl_agent", name: "Deterministic",
    capabilities: ["link_verification"], payoutAddress: "0x0000000000000000000000000000000000000099" });
  const deterministicInput = { url: "https://genlayer.example.test/unique" };
  await api(test.baseUrl, "POST", "/jobs", { jobId: "deterministic_gl_job", issuerId: "useful_waiting_protocol", jobType: "link_verification", input: deterministicInput,
    rewardAmount: "0.001", proofRequirements: { requiredResultFields: ["status", "responseTimeMs", "contentHash"] } }, issuerKey);
  await api(test.baseUrl, "POST", "/agents/deterministic_gl_agent/claim-job", { jobId: "deterministic_gl_job" }, deterministicAgent.body.apiKey);
  const deterministic = await api(test.baseUrl, "POST", "/jobs/deterministic_gl_job/proof", { proofId: "deterministic_gl_proof", agentId: "deterministic_gl_agent",
    jobId: "deterministic_gl_job", jobType: "link_verification", input: deterministicInput, result: { status: 200, responseTimeMs: 12, contentHash: "0xabc123def456" },
    verificationRoute: "link_verification_v0", proofTimestamp: new Date().toISOString() }, deterministicAgent.body.apiKey);
  assert.equal(deterministic.body.proof.verificationStatus, "deterministic_verified");
  assert.equal(test.db.prepare("SELECT COUNT(*) count FROM genlayer_adjudication_requests WHERE proof_id='deterministic_gl_proof'").get().count, 0);

  const exported = await api(test.baseUrl, "POST", "/settlement-batches/export", { issuerId: "useful_waiting_protocol", batchId: "genlayer_mock_check_batch" }, issuerKey);
  const exportedIds = exported.body.batch.proofs.map((proof) => proof.proofId);
  assert.ok(exportedIds.includes(approved.proofId));
  assert.ok(!exportedIds.includes(rejected.proofId));
  assert.ok(!exportedIds.includes(pending.proofId));
  assert.ok(!exportedIds.includes("0x72fa"));

  const ownerStatus = await new AgentClient({ baseUrl: test.baseUrl, agentId: approved.agentId, apiKey: approved.agentKey }).getAdjudicationStatus(approved.proofId);
  const issuerStatus = await new IssuerClient({ baseUrl: test.baseUrl, issuerId: "useful_waiting_protocol", apiKey: issuerKey }).getProofAdjudication(approved.proofId);
  assert.equal(ownerStatus.request.decision.decision, "approved");
  assert.equal(issuerStatus.request.decision.decision, "approved");
  console.log(JSON.stringify({ ok: true, mockApprovalPayable: true, mockRejectionExcluded: true, pendingExcluded: true,
    missingConfigFailsClosed: true, scopedAuth: true, paidProofProtected: true, deterministicBypass: true }, null, 2));
} finally {
  await test.close();
}
