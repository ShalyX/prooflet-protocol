import { createHash, randomUUID } from "node:crypto";
import { json, parseJson, withTransaction } from "../db.mjs";
import { appendReputationEvent } from "../reputation.mjs";
import { canonicalJson } from "../verifiers.mjs";

const MODES = new Set(["manual", "genlayer", "mock_genlayer"]);
const NETWORKS = new Set(["localnet", "studionet", "testnet-bradbury"]);

export function adjudicationConfig(env = process.env) {
  const mode = env.ADJUDICATION_MODE || "manual";
  const network = env.GENLAYER_NETWORK || "localnet";
  if (!MODES.has(mode)) throw genLayerError(500, "genlayer_not_configured", `Unsupported ADJUDICATION_MODE ${mode}.`);
  if (!NETWORKS.has(network)) throw genLayerError(500, "genlayer_not_configured", `Unsupported GENLAYER_NETWORK ${network}.`);
  return {
    mode, network, contractAddress: env.GENLAYER_CONTRACT_ADDRESS || null,
    privateKey: env.GENLAYER_PRIVATE_KEY || env.TREASURY_PRIVATE_KEY || null, endpoint: env.GENLAYER_RPC_OR_API_URL || null,
    requestTimeoutMs: positiveInt(env.GENLAYER_REQUEST_TIMEOUT_MS, 15000),
    pollIntervalMs: positiveInt(env.GENLAYER_POLL_INTERVAL_MS, 5000),
    maxWaitMs: positiveInt(env.GENLAYER_MAX_WAIT_MS, 120000),
  };
}

export function buildGenLayerEvidence(db, proofId) {
  const row = db.prepare(`SELECT p.*,j.issuer_id,j.input_json AS job_input_json,j.proof_requirements_json,
    j.reward_amount,j.reward_asset,j.network,j.verification_mode FROM proofs p JOIN jobs j USING(job_id) WHERE p.proof_id=?`).get(proofId);
  if (!row) throw genLayerError(404, "proof_not_found", `Proof ${proofId} does not exist.`);
  if (row.job_type !== "context_compression_quality" || row.verification_mode !== "subjective") {
    throw genLayerError(409, "proof_not_subjective", "Only subjective context_compression_quality proofs can use GenLayer.");
  }
  return {
    protocol: "Prooflet", proofId: row.proof_id, jobId: row.job_id,
    issuerId: row.issuer_id, agentId: row.agent_id, jobType: row.job_type,
    jobInput: parseJson(row.job_input_json, {}), proofResult: parseJson(row.result_json, {}),
    issuerRequirements: parseJson(row.proof_requirements_json, {}),
    reward: { amount: row.reward_amount, asset: row.reward_asset, network: row.network },
    question: "Did the agent satisfy the subjective requirements well enough to earn payout?",
    decisionOptions: ["approved", "rejected"],
  };
}

export async function routeConfiguredAdjudication(db, proofId) {
  const config = adjudicationConfig();
  if (config.mode === "manual") return { route: "manual_adapter", status: "pending" };
  return submitGenLayerProof(db, proofId, config);
}

export async function submitGenLayerProof(db, proofId, config = adjudicationConfig()) {
  const proof = requirePendingProof(db, proofId);
  const existing = db.prepare("SELECT * FROM genlayer_adjudication_requests WHERE proof_id=?").get(proofId);
  if (existing) return serializeRequest(existing, getDecisionByRequest(db, existing.request_id));
  const evidence = buildGenLayerEvidence(db, proofId);
  const now = new Date().toISOString();
  const requestId = `glr_${randomUUID()}`;
  const evidenceJson = canonicalJson(evidence);
  db.prepare(`INSERT INTO genlayer_adjudication_requests
    (request_id,proof_id,job_id,issuer_id,agent_id,evidence_hash,evidence_json,mode,network,contract_address,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'prepared',?,?)`).run(requestId, proofId, proof.job_id, proof.issuer_id, proof.agent_id,
      `sha256:${createHash("sha256").update(evidenceJson).digest("hex")}`, evidenceJson, config.mode, config.network, config.contractAddress, now, now);

  if (config.mode === "mock_genlayer") return finalizeMockRequest(db, requestId);
  try {
    validateLiveConfig(config);
    const { client, account } = await createGenLayerClient(config, true);
    const txHash = await withTimeout(client.writeContract({
      account, address: config.contractAddress, functionName: "adjudicate",
      args: [requestId, evidenceJson], value: 0n,
    }), config.requestTimeoutMs, "GenLayer submission timed out.");
    const updatedAt = new Date().toISOString();
    db.prepare("UPDATE genlayer_adjudication_requests SET status='submitted',genlayer_tx_hash=?,updated_at=? WHERE request_id=?").run(txHash, updatedAt, requestId);
    db.prepare("UPDATE proofs SET verification_route='genlayer',verification_status='genlayer_submitted',adjudication_status='genlayer_submitted' WHERE proof_id=? AND funding_status='pending_adjudication'").run(proofId);
    return getGenLayerRequest(db, requestId);
  } catch (error) {
    markFailed(db, requestId, proofId, error);
    throw normalizeGenLayerError(error);
  }
}

export async function syncGenLayerRequest(db, requestId, config = adjudicationConfig()) {
  const request = db.prepare("SELECT * FROM genlayer_adjudication_requests WHERE request_id=?").get(requestId);
  if (!request) throw genLayerError(404, "genlayer_request_not_found", `GenLayer request ${requestId} does not exist.`);
  if (request.status === "finalized" || request.status === "failed") return serializeRequest(request, getDecisionByRequest(db, requestId));
  if (request.mode === "mock_genlayer") return finalizeMockRequest(db, requestId);
  try {
    validateLiveConfig(config, false);
    if (!request.genlayer_tx_hash) throw genLayerError(409, "genlayer_request_failed", "GenLayer request has no transaction hash.");
    const { client } = await createGenLayerClient(config, false);
    const transaction = await withTimeout(client.getTransaction({ hash: request.genlayer_tx_hash }), config.requestTimeoutMs, "GenLayer status request timed out.");
    const status = String(transaction?.statusName || transaction?.status || "").toLowerCase();
    if (!status.includes("finalized") && !status.includes("accepted")) {
      updatePending(db, requestId, request.proof_id);
      return getGenLayerRequest(db, requestId);
    }
    if (String(transaction?.txExecutionResultName || "").toLowerCase().includes("error")) {
      throw genLayerError(502, "genlayer_request_failed", "GenLayer transaction finalized with an execution error.");
    }
    const rawDecision = await withTimeout(client.readContract({
      address: request.contract_address || config.contractAddress, functionName: "get_decision", args: [requestId], stateStatus: "accepted",
    }), config.requestTimeoutMs, "GenLayer decision read timed out.");
    const decision = parseNetworkDecision(rawDecision);
    if (!decision) {
      updatePending(db, requestId, request.proof_id);
      return getGenLayerRequest(db, requestId);
    }
    return finalizeDecision(db, requestId, decision, rawDecision);
  } catch (error) {
    markFailed(db, requestId, request.proof_id, error);
    throw normalizeGenLayerError(error);
  }
}

export function getGenLayerRequest(db, requestId) {
  const row = db.prepare("SELECT * FROM genlayer_adjudication_requests WHERE request_id=?").get(requestId);
  if (!row) throw genLayerError(404, "genlayer_request_not_found", `GenLayer request ${requestId} does not exist.`);
  return serializeRequest(row, getDecisionByRequest(db, requestId));
}

export function getProofGenLayerStatus(db, proofId) {
  const proof = db.prepare(`SELECT p.*,j.issuer_id,j.verification_mode FROM proofs p JOIN jobs j USING(job_id) WHERE p.proof_id=?`).get(proofId);
  if (!proof) throw genLayerError(404, "proof_not_found", `Proof ${proofId} does not exist.`);
  const request = db.prepare("SELECT * FROM genlayer_adjudication_requests WHERE proof_id=?").get(proofId);
  return {
    proofId, route: proof.verification_mode === "deterministic" ? "deterministic" : request ? "genlayer" : "manual_adapter",
    verificationStatus: proof.verification_status, adjudicationStatus: proof.adjudication_status,
    fundingStatus: proof.funding_status, settlementStatus: proof.settlement_status,
    request: request ? serializeRequest(request, getDecisionByRequest(db, request.request_id)) : null,
  };
}

function finalizeMockRequest(db, requestId) {
  const row = db.prepare("SELECT * FROM genlayer_adjudication_requests WHERE request_id=?").get(requestId);
  const evidence = parseJson(row.evidence_json, {});
  const forced = evidence.issuerRequirements?.mockDecision;
  const result = evidence.proofResult || {};
  const structurallyValid = typeof result.compressedText === "string" && result.compressedText.trim().length > 0
    && Number(result.originalLength) > Number(result.compressedLength) && Number(result.compressionRatio) > 0;
  const decision = forced === "rejected" || !structurallyValid ? "rejected" : "approved";
  return finalizeDecision(db, requestId, {
    decision, reason: decision === "approved" ? "Mock GenLayer verifier found the required compression evidence complete." : "Mock GenLayer verifier found the subjective compression evidence insufficient.",
    confidence: 0.99,
  }, { mode: "mock_genlayer", deterministic: true, decision });
}

function finalizeDecision(db, requestId, decision, rawDecision) {
  return withTransaction(db, () => {
    const request = db.prepare("SELECT * FROM genlayer_adjudication_requests WHERE request_id=?").get(requestId);
    if (!request) throw genLayerError(404, "genlayer_request_not_found", `GenLayer request ${requestId} does not exist.`);
    const existing = getDecisionByRequest(db, requestId);
    if (existing) return serializeRequest(request, existing);
    const proof = requirePendingProof(db, request.proof_id);
    const now = new Date().toISOString();
    const approved = decision.decision === "approved";
    const decisionId = `gld_${randomUUID()}`;
    db.prepare(`INSERT INTO genlayer_adjudication_decisions
      (decision_id,request_id,proof_id,verifier,decision,reason,confidence,raw_decision_json,genlayer_tx_hash,finalized_at)
      VALUES (?,?,?,'genlayer',?,?,?,?,?,?)`).run(decisionId, requestId, proof.proof_id, decision.decision, decision.reason,
        decision.confidence ?? null, json(rawDecision), request.genlayer_tx_hash, now);
    db.prepare("UPDATE genlayer_adjudication_requests SET status='finalized',error_message=NULL,updated_at=? WHERE request_id=?").run(now, requestId);
    const mock = request.mode === "mock_genlayer";
    db.prepare(`UPDATE proofs SET outcome=?,rejection_reason=?,funding_status=?,settlement_status=?,verification_route='genlayer',
      verification_status=?,adjudication_status=? WHERE proof_id=? AND funding_status='pending_adjudication' AND tx_hash IS NULL`)
      .run(approved ? "accepted" : "rejected", approved ? null : decision.reason, approved ? "payable" : "rejected",
        approved ? "Awaiting Arc Testnet settlement" : "Rejected · No payout",
        mock ? (approved ? "approved_by_mock_genlayer" : "rejected_by_mock_genlayer") : (approved ? "genlayer_approved" : "genlayer_rejected"),
        approved ? "approved" : "rejected", proof.proof_id);
    db.prepare("UPDATE jobs SET status=?,funding_status=?,updated_at=? WHERE job_id=?").run(approved ? "completed" : "rejected", approved ? "payable" : "rejected", now, proof.job_id);
    appendReputationEvent(db, { agentId: proof.agent_id, eventType: approved ? "genlayer_adjudication_approved" : "genlayer_adjudication_rejected",
      jobId: proof.job_id, proofId: proof.proof_id, issuerId: proof.issuer_id, metadata: { requestId, decisionId }, createdAt: now });
    return getGenLayerRequest(db, requestId);
  });
}

function requirePendingProof(db, proofId) {
  const proof = db.prepare(`SELECT p.*,j.issuer_id,j.verification_mode FROM proofs p JOIN jobs j USING(job_id) WHERE p.proof_id=?`).get(proofId);
  if (!proof) throw genLayerError(404, "proof_not_found", `Proof ${proofId} does not exist.`);
  if (proof.funding_status === "paid" || proof.tx_hash) throw genLayerError(409, "proof_already_paid", "Paid proofs cannot be adjudicated.");
  if (proof.funding_status === "rejected" || proof.outcome === "rejected") throw genLayerError(409, "proof_already_rejected", "Rejected proofs require an explicit appeal flow and cannot be resubmitted.");
  if (proof.funding_status !== "pending_adjudication") throw genLayerError(409, "proof_not_pending_adjudication", "Proof is not pending adjudication.");
  return proof;
}

function validateLiveConfig(config, requireKey = true) {
  const missing = [!config.contractAddress && "GENLAYER_CONTRACT_ADDRESS", requireKey && !config.privateKey && "GENLAYER_PRIVATE_KEY"].filter(Boolean);
  if (missing.length) throw genLayerError(503, "genlayer_not_configured", `Missing GenLayer configuration: ${missing.join(", ")}.`);
}

async function createGenLayerClient(config, write) {
  const [{ createClient, createAccount }, chains] = await Promise.all([import("genlayer-js"), import("genlayer-js/chains")]);
  const chain = { localnet: chains.localnet, studionet: chains.studionet, "testnet-bradbury": chains.testnetBradbury }[config.network];
  const account = write ? createAccount(config.privateKey) : undefined;
  return { client: createClient({ chain, ...(config.endpoint ? { endpoint: config.endpoint } : {}), ...(account ? { account } : {}) }), account };
}

function parseNetworkDecision(raw) {
  let value = raw;
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { value = { decision: value }; } }
  if (Array.isArray(value)) value = { decision: value[0], reason: value[1], confidence: value[2] };
  if (!value || !["approved", "rejected"].includes(value.decision)) return null;
  return { decision: value.decision, reason: String(value.reason || "GenLayer consensus decision."), confidence: value.confidence == null ? null : Number(value.confidence) };
}

function updatePending(db, requestId, proofId) {
  const now = new Date().toISOString();
  db.prepare("UPDATE genlayer_adjudication_requests SET status='pending',updated_at=? WHERE request_id=?").run(now, requestId);
  db.prepare("UPDATE proofs SET verification_status='genlayer_pending',adjudication_status='genlayer_pending' WHERE proof_id=? AND funding_status='pending_adjudication'").run(proofId);
}

function markFailed(db, requestId, proofId, error) {
  const message = String(error?.message || error).slice(0, 1000);
  db.prepare("UPDATE genlayer_adjudication_requests SET status='failed',error_message=?,updated_at=? WHERE request_id=?").run(message, new Date().toISOString(), requestId);
  db.prepare("UPDATE proofs SET verification_status='genlayer_failed',adjudication_status='genlayer_failed' WHERE proof_id=? AND funding_status='pending_adjudication'").run(proofId);
}

function getDecisionByRequest(db, requestId) { return db.prepare("SELECT * FROM genlayer_adjudication_decisions WHERE request_id=?").get(requestId); }
function serializeRequest(row, decision) {
  return { requestId: row.request_id, proofId: row.proof_id, jobId: row.job_id, issuerId: row.issuer_id, agentId: row.agent_id,
    evidenceHash: row.evidence_hash, evidence: parseJson(row.evidence_json, {}), mode: row.mode, network: row.network,
    contractAddress: row.contract_address, genlayerTxHash: row.genlayer_tx_hash, status: row.status, errorMessage: row.error_message,
    createdAt: row.created_at, updatedAt: row.updated_at, decision: decision ? { decisionId: decision.decision_id, verifier: decision.verifier,
      decision: decision.decision, reason: decision.reason, confidence: decision.confidence, rawDecision: parseJson(decision.raw_decision_json, {}),
      genlayerTxHash: decision.genlayer_tx_hash, finalizedAt: decision.finalized_at } : null };
}
function positiveInt(value, fallback) { const number = Number(value || fallback); return Number.isInteger(number) && number > 0 ? number : fallback; }
function withTimeout(promise, timeoutMs, message) { return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))]); }
function genLayerError(status, code, message) { const error = new Error(message); error.status = status; error.code = code; return error; }
function normalizeGenLayerError(error) { return error?.code ? error : genLayerError(502, "genlayer_request_failed", String(error?.message || error)); }
