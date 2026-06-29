import express from "express";
import { fileURLToPath } from "node:url";
import { formatUnits, isAddress, parseUnits } from "viem";
import { authenticate, generateApiKey, storeApiKey } from "./auth.mjs";
import { authenticateAdjudicator } from "./auth.mjs";
import { createAgentWallet, getCircleStatus, isCircleConfigured } from "./circle-wallet.mjs";
import { expireLeases, json, openDatabase, parseJson, withTransaction } from "./db.mjs";
import { seedDatabase } from "./seed.mjs";
import { createSettlementBatch, recordSettledBatch, settlementSummary } from "./settlement.mjs";
import { canonicalJson, proofFingerprint, verifyProof } from "./verifiers.mjs";
import { requiredAccessLevel, evaluateJobAccess } from "./access-policy.mjs";
import { appendReputationEvent, backfillReputation, getReputationSummary } from "./reputation.mjs";
import { decideProof, getAdjudicationProof, listPendingAdjudications, pendingManualRequest } from "./adjudication/index.mjs";
import { getGenLayerRequest, getProofGenLayerStatus, routeConfiguredAdjudication, submitGenLayerProof, syncGenLayerRequest } from "./adjudication/genlayer.mjs";
import { confirmUpload, validateUpload } from "./uploads.mjs";
import { createCompoundJob, checkCompoundJobCompletion, checkCompoundJobFailure, listCompoundJobs } from "./compound-jobs.mjs";
import { createPaymentRequest, nanopaymentConfig, verifyNanopayment } from "./circle-nanopayment.mjs";

export function createApp({ db = openDatabase() } = {}) {
  seedDatabase(db);
  backfillReputation(db);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "3mb" }));
  app.use((request, response, next) => {
    response.set({
      "Access-Control-Allow-Origin": request.get("origin") || "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    if (request.method === "OPTIONS") return response.sendStatus(204);
    next();
  });

  app.get("/health", (_request, response) => response.json({ ok: true, protocol: "Prooflet", version: "v0" }));

  app.post("/issuers/register", (request, response) => {
    const { issuerId, name, treasuryAddress = null } = request.body || {};
    requireId(issuerId, "issuerId");
    requireString(name, "name");
    if (treasuryAddress && !isAddress(treasuryAddress)) throw httpError(400, "treasuryAddress must be a valid EVM address.");
    const apiKey = generateApiKey("issuer");
    const now = new Date().toISOString();
    try {
      withTransaction(db, () => {
        db.prepare(`
          INSERT INTO issuers (issuer_id, name, treasury_address, status, created_at)
          VALUES (?, ?, ?, 'active', ?)
        `).run(issuerId, name, treasuryAddress, now);
        storeApiKey(db, "issuer", issuerId, apiKey, now);
      });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw httpError(409, `Issuer ${issuerId} already exists.`);
      throw error;
    }
    response.status(201).json({ issuer: { issuerId, name, treasuryAddress, status: "active" }, apiKey });
  });

  app.post("/agents/register", (request, response) => {
    const { agentId, name, capabilities, payoutAddress, status = "idle", reputationScore = 50 } = request.body || {};
    requireId(agentId, "agentId");
    requireString(name, "name");
    if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.some((item) => typeof item !== "string")) {
      throw httpError(400, "capabilities must be a non-empty string array.");
    }
    if (!isAddress(payoutAddress)) throw httpError(400, "payoutAddress must be a valid EVM address.");
    const score = Number(reputationScore);
    if (!Number.isInteger(score) || score < 0 || score > 100) throw httpError(400, "reputationScore must be an integer from 0 to 100.");
    const apiKey = generateApiKey("agent");
    const now = new Date().toISOString();
    try {
      withTransaction(db, () => {
        db.prepare(`
          INSERT INTO agents
            (agent_id, name, capabilities_json, payout_address, status, reputation_score, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(agentId, name, json([...new Set(capabilities)]), payoutAddress, status, score, now);
        storeApiKey(db, "agent", agentId, apiKey, now);
        appendReputationEvent(db, { eventId: `registered:${agentId}`, agentId, eventType: "agent_registered", createdAt: now });
      });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw httpError(409, `Agent ${agentId} already exists.`);
      throw error;
    }
    response.status(201).json({ agent: { agentId, name, capabilities, payoutAddress, status, reputationScore: score }, apiKey });
  });

  app.post("/agents/register-with-wallet", async (request, response) => {
    const { agentId, name, capabilities, payoutAddress, status = "idle", reputationScore = 50 } = request.body || {};
    requireId(agentId, "agentId");
    requireString(name, "name");
    if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.some((item) => typeof item !== "string")) {
      throw httpError(400, "capabilities must be a non-empty string array.");
    }
    if (!isAddress(payoutAddress)) throw httpError(400, "payoutAddress must be a valid EVM address.");
    const score = Number(reputationScore);
    if (!Number.isInteger(score) || score < 0 || score > 100) throw httpError(400, "reputationScore must be an integer from 0 to 100.");
    const apiKey = generateApiKey("agent");
    const now = new Date().toISOString();
    
    // Create Circle wallet if configured
    let circleWallet = null;
    let circleError = null;
    if (isCircleConfigured()) {
      try {
        circleWallet = await createAgentWallet(agentId, name);
      } catch (walletError) {
        circleError = walletError.message;
        console.error(`Wallet creation for ${agentId} failed: ${walletError.message}`);
      }
    }
    
    try {
      withTransaction(db, () => {
        db.prepare(`
          INSERT INTO agents
            (agent_id, name, capabilities_json, payout_address, status, reputation_score, circle_wallet_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(agentId, name, json([...new Set(capabilities)]), payoutAddress, status, score, circleWallet?.walletId || null, now);
        storeApiKey(db, "agent", agentId, apiKey, now);
        appendReputationEvent(db, { eventId: `registered:${agentId}`, agentId, eventType: "agent_registered", createdAt: now });
      });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw httpError(409, `Agent ${agentId} already exists.`);
      throw error;
    }
    response.status(201).json({
      agent: { agentId, name, capabilities, payoutAddress, status, reputationScore: score },
      circleWallet,
      circleError,
      apiKey,
    });
  });

  app.post("/jobs", (request, response) => {
    const {
      jobId, issuerId, jobType, input, rewardAmount, rewardAsset = "USDC",
      network = "Arc Testnet", fundingStatus = "reserved", status = "open", proofRequirements, verificationMode = "deterministic",
    } = request.body || {};
    requireId(jobId, "jobId");
    requireId(issuerId, "issuerId");
    requireString(jobType, "jobType");
    if (!authenticate(db, request, "issuer", issuerId)) throw httpError(401, "Valid issuer API key required.");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw httpError(400, "input must be an object.");
    validateReward(rewardAmount);
    if (rewardAsset !== "USDC") throw httpError(400, "rewardAsset must be USDC.");
    if (network !== "Arc Testnet") throw httpError(400, "network must be Arc Testnet.");
    if (fundingStatus !== "reserved" || status !== "open") throw httpError(400, "New jobs must be reserved and open.");
    if (!proofRequirements || typeof proofRequirements !== "object") throw httpError(400, "proofRequirements must be an object.");
    if (!["deterministic", "subjective"].includes(verificationMode)) throw httpError(400, "verificationMode must be deterministic or subjective.");
    const accessLevel = requiredAccessLevel(rewardAmount, verificationMode);
    if (!accessLevel) throw httpError(400, "rewardAmount exceeds the v0 maximum of 0.10 USDC.");
    const now = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO jobs
          (job_id, issuer_id, job_type, input_json, reward_amount, reward_asset, network,
           funding_status, status, proof_requirements_json, verification_mode, required_access_level, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'USDC', 'Arc Testnet', 'reserved', 'open', ?, ?, ?, ?, ?)
      `).run(jobId, issuerId, jobType, json(input), normalizedReward(rewardAmount), json(proofRequirements), verificationMode, accessLevel, now, now);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw httpError(409, `Job ${jobId} already exists.`);
      throw error;
    }
    response.status(201).json({ job: serializeJob(db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId)) });
  });

  app.post("/jobs/compound", (request, response) => {
    const {
      jobId, issuerId, subTasks, combinedReward,
      verificationMode = "deterministic",
    } = request.body || {};
    requireId(jobId, "jobId");
    requireId(issuerId, "issuerId");
    if (!authenticate(db, request, "issuer", issuerId)) throw httpError(401, "Valid issuer API key required.");
    if (!Array.isArray(subTasks) || subTasks.length < 2) throw httpError(400, "compound_job: subTasks must be an array with at least 2 items.");
    const result = createCompoundJob(db, { jobId, issuerId, subTasks, combinedReward: String(combinedReward), verificationMode });
    response.status(201).json({ compoundJob: result });
  });

  app.get("/jobs/compound", (_request, response) => {
    response.json({ compoundJobs: listCompoundJobs(db) });
  });

  app.post("/agents/:agentId/claim-job", (request, response) => {
    const { agentId } = request.params;
    if (!authenticate(db, request, "agent", agentId)) throw httpError(401, "Valid agent API key required.");
    const agent = db.prepare("SELECT * FROM agents WHERE agent_id = ?").get(agentId);
    if (!agent) throw httpError(404, `Agent ${agentId} does not exist.`);
    const capabilities = parseJson(agent.capabilities_json, []);
    const requestedJobId = request.body?.jobId;
    const leaseSeconds = Math.min(Math.max(Number(request.body?.leaseSeconds || 60), 5), 3600);
    if (!Number.isFinite(leaseSeconds)) throw httpError(400, "leaseSeconds must be numeric.");

    const claimed = withTransaction(db, () => {
      expireLeasesWithEvents(db);
      const summary = getReputationSummary(db, agentId);
      const activeLeases = db.prepare("SELECT COUNT(*) AS count FROM job_claims WHERE agent_id=? AND status='active'").get(agentId).count;
      let job;
      if (requestedJobId) {
        job = db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(requestedJobId);
        if (!job) throw httpError(404, `Job ${requestedJobId} does not exist.`);
        if (job.status !== "open") throw httpError(409, `Job ${requestedJobId} is not open.`);
        const eligibility = evaluateJobAccess({ capabilities, job, summary, activeLeases });
        if (!eligibility.eligible) throw eligibilityError(409, eligibility.reason, `Agent ${agentId} is not eligible for ${requestedJobId}.`, eligibility);
      } else {
        if (capabilities.length === 0) throw httpError(409, `Agent ${agentId} has no capabilities.`);
        const placeholders = capabilities.map(() => "?").join(",");
        const candidates = db.prepare(`
          SELECT * FROM jobs WHERE status = 'open' AND job_type IN (${placeholders})
          ORDER BY created_at DESC, job_id DESC
        `).all(...capabilities);
        job = candidates.find((candidate) => evaluateJobAccess({ capabilities, job: candidate, summary, activeLeases }).eligible);
        if (!job) throw httpError(404, "No eligible open job is available.");
      }
      const claimedAt = new Date();
      const leaseExpiresAt = new Date(claimedAt.getTime() + leaseSeconds * 1000).toISOString();
      db.prepare(`
        UPDATE jobs SET status = 'claimed', claimed_by = ?, lease_expires_at = ?, updated_at = ?
        WHERE job_id = ? AND status = 'open'
      `).run(agentId, leaseExpiresAt, claimedAt.toISOString(), job.job_id);
      db.prepare(`
        INSERT INTO job_claims (job_id, agent_id, claimed_at, lease_expires_at, status)
        VALUES (?, ?, ?, ?, 'active')
      `).run(job.job_id, agentId, claimedAt.toISOString(), leaseExpiresAt);
      appendReputationEvent(db, { agentId, eventType: "job_claimed", jobId: job.job_id, issuerId: job.issuer_id, createdAt: claimedAt.toISOString() });
      return db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(job.job_id);
    });
    response.json({ job: serializeJob(claimed) });
  });

  app.post("/jobs/:jobId/proof", async (request, response) => {
    const { jobId } = request.params;
    const proof = request.body || {};
    for (const field of ["proofId", "agentId", "jobId", "jobType", "input", "result", "verificationRoute", "proofTimestamp"]) {
      if (proof[field] == null) throw httpError(400, `${field} is required.`);
    }
    if (proof.jobId !== jobId) throw httpError(400, "Proof jobId must match the route jobId.");
    if (!authenticate(db, request, "agent", proof.agentId)) throw httpError(401, "Valid agent API key required.");
    if (Number.isNaN(Date.parse(proof.proofTimestamp))) throw httpError(400, "proofTimestamp must be a valid timestamp.");

    const result = withTransaction(db, () => {
      expireLeasesWithEvents(db);
      const job = db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId);
      if (!job) throw httpError(404, `Job ${jobId} does not exist.`);
      if (job.status !== "claimed" || job.claimed_by !== proof.agentId) throw httpError(409, "Job is not actively claimed by this agent.");
      const claim = db.prepare(`
        SELECT * FROM job_claims WHERE job_id = ? AND agent_id = ? AND status = 'active'
        ORDER BY claim_id DESC LIMIT 1
      `).get(jobId, proof.agentId);
      if (!claim || claim.lease_expires_at <= new Date().toISOString()) throw httpError(409, "Claim lease expired before proof submission.");
      if (db.prepare("SELECT 1 FROM proofs WHERE proof_id = ?").get(proof.proofId)) throw httpError(409, `Proof ${proof.proofId} already exists.`);

      const requirements = parseJson(job.proof_requirements_json, {});
      const fingerprint = proofFingerprint(proof);
      const duplicate = db.prepare("SELECT proof_id, job_id FROM proofs WHERE fingerprint = ? LIMIT 1").get(fingerprint);
      const subjective = job.verification_mode === "subjective";
      const subjectivePreflight = subjective ? verifySubjectivePreflight(job, proof, requirements) : null;
      const verification = duplicate
        ? { approved: false, route: "duplicate_proof_v0", reason: `Duplicate proof payload matches ${duplicate.proof_id} from ${duplicate.job_id}.` }
        : subjective ? (subjectivePreflight || { approved: false, pending: true, route: "manual_adapter", reason: null })
        : verifyProof({ jobType: job.job_type, input: parseJson(job.input_json, {}) }, proof, requirements);
      const outcome = verification.pending ? "pending_adjudication" : verification.approved ? "accepted" : "rejected";
      const fundingStatus = verification.pending ? "pending_adjudication" : verification.approved ? "payable" : "rejected";
      const settlementStatus = verification.pending ? "Pending adjudication · No payout" : verification.approved ? "Awaiting Arc Testnet settlement" : "Rejected · No payout";
      const verificationStatus = verification.pending ? "pending_adjudication" : verification.approved ? "deterministic_verified" : duplicate ? "duplicate_rejected" : "deterministic_rejected";
      const adjudicationStatus = verification.pending ? "pending_adjudication" : "not_required";
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO proofs
          (proof_id, job_id, agent_id, job_type, input_json, result_json, verification_route,
           proof_timestamp, fingerprint, outcome, rejection_reason, funding_status,
           settlement_status, verification_status, adjudication_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        proof.proofId, jobId, proof.agentId, proof.jobType, json(proof.input), json(proof.result),
        verification.route, proof.proofTimestamp, fingerprint, outcome, verification.reason,
        fundingStatus, settlementStatus, verificationStatus, adjudicationStatus, now,
      );
      db.prepare("UPDATE job_claims SET status = 'submitted' WHERE claim_id = ?").run(claim.claim_id);
      db.prepare(`
        UPDATE jobs SET status = ?, funding_status = ?, lease_expires_at = NULL, updated_at = ?
        WHERE job_id = ?
      `).run(verification.pending ? "pending_adjudication" : verification.approved ? "completed" : "rejected", fundingStatus, now, jobId);
      if (!verification.pending) appendReputationEvent(db, { agentId: proof.agentId, eventType: duplicate ? "duplicate_proof_rejected" : verification.approved ? "proof_approved" : "proof_rejected", jobId, proofId: proof.proofId, issuerId: job.issuer_id, createdAt: now });
      if (verification.pending) pendingManualRequest(proof.proofId, now);

      // Check compound job completion or failure
      if (!verification.pending) {
        if (verification.approved) {
          checkCompoundJobCompletion(db, proof);
        } else {
          checkCompoundJobFailure(db, proof);
        }
      }
      return db.prepare("SELECT * FROM proofs WHERE proof_id = ?").get(proof.proofId);
    });
    let adjudication = null;
    if (result.outcome === "pending_adjudication") {
      try {
        adjudication = await routeConfiguredAdjudication(db, result.proof_id);
      } catch (error) {
        adjudication = { route: "genlayer", status: "failed", error: { code: error.code || "genlayer_request_failed", message: error.message } };
      }
    }
    const current = db.prepare("SELECT * FROM proofs WHERE proof_id=?").get(result.proof_id);
    response.status(current.outcome === "accepted" || current.outcome === "pending_adjudication" ? 201 : 422).json({ proof: serializeProof(current), ...(adjudication ? { adjudication } : {}) });
  });

  app.get("/agents/:agentId/reputation", (request, response) => {
    const { agentId } = request.params;
    if (!authenticate(db, request, "agent", agentId)) throw httpError(401, "Valid agent API key required.");
    if (!db.prepare("SELECT 1 FROM agents WHERE agent_id=?").get(agentId)) throw httpError(404, `Agent ${agentId} does not exist.`);
    response.json({ reputation: getReputationSummary(db, agentId) });
  });

  app.get("/adjudication/pending", (request, response) => {
    requireAdjudicator(db, request, "manual_adjudication:read");
    response.json({ proofs: listPendingAdjudications(db) });
  });
  app.get("/adjudication/proofs/:proofId", (request, response) => {
    requireAdjudicator(db, request, "manual_adjudication:read");
    const proof = getAdjudicationProof(db, request.params.proofId);
    if (!proof) throw httpError(404, `Proof ${request.params.proofId} does not exist.`);
    response.json({ proof });
  });
  app.post("/adjudication/proofs/:proofId/decision", (request, response) => {
    const adjudicator = requireAdjudicator(db, request, "manual_adjudication:write");
    response.status(201).json({ decision: decideProof(db, request.params.proofId, adjudicator.adjudicatorId, request.body) });
  });

  app.post("/adjudication/genlayer/proofs/:proofId/submit", async (request, response) => {
    requireAdjudicator(db, request, "genlayer:write");
    response.status(201).json({ request: await submitGenLayerProof(db, request.params.proofId) });
  });
  app.post("/adjudication/genlayer/requests/:requestId/sync", async (request, response) => {
    requireAdjudicator(db, request, "genlayer:write");
    response.json({ request: await syncGenLayerRequest(db, request.params.requestId) });
  });
  app.get("/adjudication/genlayer/requests/:requestId", (request, response) => {
    requireAdjudicator(db, request, "genlayer:read");
    response.json({ request: getGenLayerRequest(db, request.params.requestId) });
  });
  app.get("/adjudication/genlayer/proofs/:proofId", (request, response) => {
    requireAdjudicator(db, request, "genlayer:read");
    response.json({ adjudication: getProofGenLayerStatus(db, request.params.proofId) });
  });
  app.get("/proofs/:proofId/adjudication", (request, response) => {
    const proof = db.prepare("SELECT p.agent_id,j.issuer_id FROM proofs p JOIN jobs j USING(job_id) WHERE p.proof_id=?").get(request.params.proofId);
    if (!proof) throw httpError(404, `Proof ${request.params.proofId} does not exist.`);
    if (!authenticate(db, request, "agent", proof.agent_id) && !authenticate(db, request, "issuer", proof.issuer_id)) throw httpError(403, "Proof owner API key required.");
    response.json({ adjudication: getProofGenLayerStatus(db, request.params.proofId) });
  });

  app.post("/issuers/:issuerId/uploads/validate", (request, response) => {
    const { issuerId } = request.params;
    requireIssuer(db, request, issuerId);
    response.status(201).json({ upload: validateUpload(db, issuerId, request.body) });
  });
  app.post("/issuers/:issuerId/uploads/:uploadId/confirm", (request, response) => {
    const { issuerId, uploadId } = request.params;
    requireIssuer(db, request, issuerId);
    response.status(201).json({ upload: confirmUpload(db, issuerId, uploadId, request.body) });
  });
  app.get("/issuers/:issuerId/overview", (request, response) => issuerView(db, request, response, "overview"));
  app.get("/issuers/:issuerId/jobs", (request, response) => issuerView(db, request, response, "jobs"));
  app.get("/issuers/:issuerId/proofs", (request, response) => issuerView(db, request, response, "proofs"));
  app.get("/issuers/:issuerId/settlements", (request, response) => issuerView(db, request, response, "settlements"));

  app.post("/settlement-batches/export", (request, response) => {
    const issuerId = request.body?.issuerId || "useful_waiting_protocol";
    if (!authenticate(db, request, "issuer", issuerId)) throw httpError(401, "Valid issuer API key required.");
    const proofIds = request.body?.proofIds;
    if (proofIds != null && (!Array.isArray(proofIds) || proofIds.some((proofId) => typeof proofId !== "string"))) throw httpError(400, "proofIds must be an array of proof IDs.");
    const batch = createSettlementBatch(db, { issuerId, batchId: request.body?.batchId, proofIds });
    response.status(201).json({ batch });
  });

  app.post("/settlement-batches/:batchId/receipt", (request, response) => {
    const { batchId } = request.params;
    const issuerId = request.body?.issuerId || "useful_waiting_protocol";
    if (!authenticate(db, request, "issuer", issuerId)) throw httpError(401, "Valid issuer API key required.");
    const batchRow = db.prepare("SELECT * FROM settlement_batches WHERE batch_id = ? AND issuer_id = ?").get(batchId, issuerId);
    if (!batchRow) throw httpError(404, `Settlement batch ${batchId} does not exist for issuer ${issuerId}.`);
    if (batchRow.status === "settled") throw httpError(409, `Settlement batch ${batchId} is already settled.`);
    if (!["prepared", "executing"].includes(batchRow.status)) throw httpError(409, `Settlement batch ${batchId} is ${batchRow.status}, not prepared for receipt recording.`);
    const transactions = validateSettlementReceipt(request.body?.transactions);
    const batch = createSettlementBatch(db, { issuerId, batchId });
    validateReceiptMatchesBatch(batch, transactions);
    recordSettledBatch(db, batch, transactions);
    response.status(201).json({ batchId, status: "settled", transactions, proofs: batch.proofs.map((proof) => ({ ...proof, fundingStatus: "paid", settlementStatus: "Settled on Arc Testnet" })) });
  });

  app.get("/agents/:agentId", (request, response) => {
    const { agentId } = request.params;
    if (!authenticate(db, request, "agent", agentId)) throw httpError(401, "Valid agent API key required.");
    const agent = db.prepare("SELECT * FROM agents WHERE agent_id = ?").get(agentId);
    if (!agent) throw httpError(404, `Agent ${agentId} does not exist.`);
    response.json({ agent: serializeAgent(agent) });
  });
  app.get("/circle/status", (_request, response) => {
    response.json(getCircleStatus());
  });
  app.get("/circle/agents/:agentId/wallet", async (request, response) => {
    const { agentId } = request.params;
    if (!authenticate(db, request, "agent", agentId) && !authenticate(db, request, "issuer", "useful_waiting_protocol")) throw httpError(403, "Agent or issuer API key required.");
    const agent = db.prepare("SELECT circle_wallet_id FROM agents WHERE agent_id=?").get(agentId);
    if (!agent) throw httpError(404, `Agent ${agentId} does not exist.`);
    response.json({ walletId: agent.circle_wallet_id || null });
  });

  app.get("/leaderboard", (_request, response) => {
    const rows = db.prepare(`
      SELECT
        a.agent_id, a.name, a.reputation_score, a.status,
        COALESCE(rs.approved_proofs, 0) AS approved_proofs,
        COALESCE(rs.paid_proofs, 0) AS paid_proofs,
        COALESCE(rs.settled_volume_usdc, '0') AS settled_volume,
        COALESCE(rs.duplicate_rate_30d, 0) AS duplicate_rate,
        COALESCE(rs.current_risk_flag, 'clean') AS risk_flag,
        COALESCE(rs.access_level, 'starter') AS access_level
      FROM agents a
      LEFT JOIN agent_reputation_summary rs ON rs.agent_id = a.agent_id
      ORDER BY rs.approved_proofs DESC, a.reputation_score DESC
    `).all();
    const ranked = rows.map((row, i) => ({
      rank: i + 1,
      agentId: row.agent_id,
      name: row.name,
      score: row.reputation_score,
      approvedProofs: row.approved_proofs,
      paidProofs: row.paid_proofs,
      settledVolume: row.settled_volume,
      duplicateRate: row.duplicate_rate,
      riskFlag: row.risk_flag,
      accessLevel: row.access_level,
      status: row.status,
    }));
    response.json({ leaderboard: ranked });
  });

  app.get("/agents", (_request, response) => response.json({ agents: db.prepare("SELECT * FROM agents ORDER BY agent_id").all().map(serializeAgent) }));
  app.get("/jobs", (_request, response) => {
    expireLeases(db);
    response.json({ jobs: db.prepare("SELECT * FROM jobs ORDER BY created_at DESC, job_id DESC").all().map(serializeJob) });
  });
  app.get("/proofs", (_request, response) => response.json({ proofs: db.prepare("SELECT * FROM proofs ORDER BY created_at DESC").all().map(serializeProof) }));
  app.get("/settlements", (_request, response) => response.json(settlementSummary(db)));
  app.get("/dashboard", (_request, response) => response.json(buildDashboard(db)));

  // ---- Escrow Endpoints ----
  app.post("/escrow/deposit", (request, response) => {
    if (!authenticate(db, request, "issuer", "useful_waiting_protocol")) throw httpError(403, "Issuer API key required.");
    const { jobId, agentAddress, amount, txHash } = request.body || {};
    requireId(jobId, "jobId");
    requireString(agentAddress, "agentAddress");
    requireString(amount, "amount");
    requireString(txHash, "txHash");
    db.prepare("UPDATE jobs SET funding_rail = ?, escrow_status = ?, escrow_tx_hash = ? WHERE job_id = ?")
      .run("arc_usdc_escrow", "funded", txHash, jobId);
    response.json({ ok: true, fundingRail: "arc_usdc_escrow", escrowStatus: "funded", escrowTxHash: txHash });
  });

  app.post("/escrow/release", (request, response) => {
    if (!authenticate(db, request, "issuer", "useful_waiting_protocol")) throw httpError(403, "Issuer API key required.");
    const { jobId, txHash } = request.body || {};
    requireId(jobId, "jobId");
    requireString(txHash, "txHash");
    db.prepare("UPDATE jobs SET escrow_status = 'released', escrow_tx_hash = ? WHERE job_id = ?").run(txHash, jobId);
    response.json({ ok: true, escrowStatus: "released", escrowTxHash: txHash });
  });

  app.post("/escrow/refund", (request, response) => {
    if (!authenticate(db, request, "issuer", "useful_waiting_protocol")) throw httpError(403, "Issuer API key required.");
    const { jobId, txHash } = request.body || {};
    requireId(jobId, "jobId");
    requireString(txHash, "txHash");
    db.prepare("UPDATE jobs SET escrow_status = 'refunded', escrow_tx_hash = ? WHERE job_id = ?").run(txHash, jobId);
    response.json({ ok: true, escrowStatus: "refunded", escrowTxHash: txHash });
  });

  // ---- Nanopayment Endpoints ----
  app.get("/nanopayment/config", (_request, response) => {
    response.json(nanopaymentConfig());
  });

  app.get("/jobs/:jobId/access-fee", (request, response) => {
    const { agentAddress } = request.query;
    response.json(createPaymentRequest(request.params.jobId, agentAddress || "unknown"));
  });

  app.post("/jobs/:jobId/access-fee/verify", async (request, response) => {
    const { agentId, agentAddress } = request.body || {};
    requireId(agentId, "agentId");
    requireString(agentAddress, "agentAddress");
    const result = await verifyNanopayment(agentAddress, request.params.jobId);
    if (result.paid) {
      try {
        db.prepare(`UPDATE job_claims SET claim_access_rail = ?, claim_access_price = ?, claim_access_status = ? WHERE job_id = ? AND agent_id = ? AND status = 'active'`)
          .run("circle_gateway_nanopayments", result.accessFee, "paid", request.params.jobId, agentId);
      } catch { /* claim may not exist yet */ }
    }
    response.json(result);
  });

  app.use((error, _request, response, _next) => {
    const status = error.status || 500;
    if (status >= 500 && !error.code) console.error(error);
    response.status(status).json({ error: error.message || "Internal server error.", ...(error.code ? { code: error.code } : {}), ...(error.eligibility ? { eligibility: error.eligibility } : {}) });
  });
  return { app, db };
}

function buildDashboard(db) {
  expireLeasesWithEvents(db);
  const issuer = db.prepare("SELECT * FROM issuers WHERE issuer_id = 'useful_waiting_protocol'").get();
  const agents = db.prepare("SELECT * FROM agents ORDER BY agent_id").all().map((agent) => ({ ...serializeAgent(agent), reputation: getReputationSummary(db, agent.agent_id) }));
  const jobs = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC, job_id DESC").all().map(serializeJob);
  const proofs = db.prepare("SELECT * FROM proofs ORDER BY created_at DESC").all().map((proof) => withAdjudication(db, serializeProof(proof)));
  const settlements = settlementSummary(db);
  const sum = (status) => db.prepare(`
    SELECT COALESCE(SUM(CAST(j.reward_amount AS REAL)), 0) AS total
    FROM proofs p JOIN jobs j ON j.job_id = p.job_id WHERE p.funding_status = ?
  `).get(status).total;
  const reserved = db.prepare("SELECT COALESCE(SUM(CAST(reward_amount AS REAL)), 0) AS total FROM jobs WHERE funding_status = 'reserved'").get().total;
  return {
    protocol: "Prooflet",
    version: "v0",
    issuer: { issuerId: issuer.issuer_id, name: issuer.name, treasuryAddress: issuer.treasury_address },
    treasury: { network: "Arc Testnet", asset: "USDC", reservedRewards: reserved, pendingPayout: sum("payable"), paidOut: sum("paid") },
    agents,
    jobs,
    proofs,
    settlements,
    circle: getCircleStatus(),
  };
}

function serializeAgent(row) {
  return { agentId: row.agent_id, name: row.name, capabilities: parseJson(row.capabilities_json, []), payoutAddress: row.payout_address, status: row.status, reputationScore: row.reputation_score, circleWalletId: row.circle_wallet_id || null };
}

function serializeJob(row) {
  return {
    jobId: row.job_id, issuerId: row.issuer_id, jobType: row.job_type, input: parseJson(row.input_json, {}),
    rewardAmount: row.reward_amount, rewardAsset: row.reward_asset, network: row.network,
    fundingStatus: row.funding_status, status: row.status, proofRequirements: parseJson(row.proof_requirements_json, {}),
    claimedBy: row.claimed_by, leaseExpiresAt: row.lease_expires_at, verificationMode: row.verification_mode || "deterministic", requiredAccessLevel: row.required_access_level || "starter",
    compoundParentId: row.compound_parent_id || null,
    fundingRail: row.funding_rail || "treasury",
    escrowStatus: row.escrow_status || null,
    escrowTxHash: row.escrow_tx_hash || null,
  };
}

function serializeProof(row) {
  return {
    proofId: row.proof_id, agentId: row.agent_id, jobId: row.job_id, jobType: row.job_type,
    input: parseJson(row.input_json, {}), result: parseJson(row.result_json, {}), verificationRoute: row.verification_route,
    proofTimestamp: row.proof_timestamp, outcome: row.outcome, rejectionReason: row.rejection_reason,
    fundingStatus: row.funding_status, settlementStatus: row.settlement_status, batchId: row.batch_id,
    txHash: row.tx_hash, explorer: row.explorer_url, verificationStatus: row.verification_status || "deterministic_verified", adjudicationStatus: row.adjudication_status || "not_required",
  };
}

function withAdjudication(db, proof) {
  const request = db.prepare("SELECT request_id,status,mode,network,genlayer_tx_hash,error_message FROM genlayer_adjudication_requests WHERE proof_id=?").get(proof.proofId);
  if (!request) return { ...proof, adjudicationRoute: proof.adjudicationStatus === "not_required" ? "deterministic" : "manual_adapter", genlayer: null };
  const decision = db.prepare("SELECT decision,reason,confidence,finalized_at FROM genlayer_adjudication_decisions WHERE request_id=?").get(request.request_id);
  return { ...proof, adjudicationRoute: "genlayer", genlayer: { requestId: request.request_id, status: request.status, mode: request.mode,
    network: request.network, txHash: request.genlayer_tx_hash, errorMessage: request.error_message, decision: decision || null } };
}

function requireId(value, name) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{3,80}$/.test(value)) throw httpError(400, `${name} must be 3-80 letters, numbers, underscores, or hyphens.`);
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw httpError(400, `${name} is required.`);
}

function validateReward(value) {
  try {
    if (parseUnits(String(value), 6) <= 0n) throw new Error();
  } catch {
    throw httpError(400, "rewardAmount must be a positive USDC amount with at most 6 decimals.");
  }
}

function validateSettlementReceipt(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) throw httpError(400, "transactions must be a non-empty array.");
  return transactions.map((transaction, index) => {
    const agentId = transaction?.agentId;
    const to = transaction?.to;
    const amount = transaction?.amount;
    const hash = transaction?.hash;
    const explorer = transaction?.explorer;
    const blockNumber = transaction?.blockNumber;
    const status = transaction?.status;
    requireId(agentId, `transactions[${index}].agentId`);
    if (!isAddress(to)) throw httpError(400, `transactions[${index}].to must be a valid EVM address.`);
    validateReward(amount);
    if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) throw httpError(400, `transactions[${index}].hash must be a transaction hash.`);
    if (typeof explorer !== "string" || !explorer.startsWith("https://testnet.arcscan.app/tx/")) throw httpError(400, `transactions[${index}].explorer must be an Arcscan testnet tx URL.`);
    if (blockNumber == null || String(blockNumber).trim() === "") throw httpError(400, `transactions[${index}].blockNumber is required.`);
    if (status !== "success") throw httpError(400, `transactions[${index}].status must be success.`);
    return { agentId, to, amount: normalizedReward(amount), hash, explorer, blockNumber: String(blockNumber), status };
  });
}

function validateReceiptMatchesBatch(batch, transactions) {
  const txByAgent = new Map(transactions.map((transaction) => [transaction.agentId, transaction]));
  if (txByAgent.size !== transactions.length) throw httpError(400, "transactions must not contain duplicate agentId entries.");
  if (transactions.length !== batch.recipients.length) throw httpError(400, "transactions must match the batch recipient count.");
  for (const recipient of batch.recipients) {
    const tx = txByAgent.get(recipient.agentId);
    if (!tx) throw httpError(400, `Missing transaction for ${recipient.agentId}.`);
    if (tx.to.toLowerCase() !== recipient.payoutAddress.toLowerCase()) throw httpError(400, `Transaction recipient mismatch for ${recipient.agentId}.`);
    if (normalizedReward(tx.amount) !== normalizedReward(recipient.amount)) throw httpError(400, `Transaction amount mismatch for ${recipient.agentId}.`);
  }
}

function normalizedReward(value) {
  return formatUnits(parseUnits(String(value), 6), 6);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function eligibilityError(status, code, message, eligibility) { const error = httpError(status, message); error.code = code; error.eligibility = eligibility; return error; }
function requireIssuer(db, request, issuerId) { if (!authenticate(db, request, "issuer", issuerId)) throw httpError(401, "Valid issuer API key required."); }
function requireAdjudicator(db, request, scope) { const result = authenticateAdjudicator(db, request, scope); if (!result) { const error = httpError(403, `Adjudicator scope ${scope} required.`); error.code = "missing_adjudicator_scope"; throw error; } return result; }
function expireLeasesWithEvents(db) {
  const now = new Date().toISOString();
  const rows = db.prepare(`SELECT c.claim_id,c.job_id,c.agent_id,j.issuer_id FROM job_claims c JOIN jobs j USING(job_id) WHERE c.status='active' AND c.lease_expires_at<=?`).all(now);
  const count = expireLeases(db, now);
  for (const row of rows) appendReputationEvent(db, { eventId: `lease-expired:${row.claim_id}`, agentId: row.agent_id, eventType: "job_lease_expired", jobId: row.job_id, issuerId: row.issuer_id, createdAt: now });
  return count;
}
function issuerView(db, request, response, view) {
  const issuerId = request.params.issuerId; requireIssuer(db, request, issuerId);
  if (!db.prepare("SELECT 1 FROM issuers WHERE issuer_id=?").get(issuerId)) throw httpError(404, `Issuer ${issuerId} does not exist.`);
  const jobs = db.prepare("SELECT * FROM jobs WHERE issuer_id=? ORDER BY created_at DESC").all(issuerId).map(serializeJob);
  const proofs = db.prepare("SELECT p.* FROM proofs p JOIN jobs j USING(job_id) WHERE j.issuer_id=? ORDER BY p.created_at DESC").all(issuerId).map((proof) => withAdjudication(db, serializeProof(proof)));
  const settlements = { batches: db.prepare("SELECT * FROM settlement_batches WHERE issuer_id=? ORDER BY created_at DESC").all(issuerId), transactions: db.prepare("SELECT t.* FROM settlement_transactions t JOIN settlement_batches b USING(batch_id) WHERE b.issuer_id=? ORDER BY t.created_at DESC").all(issuerId) };
  if (view === "jobs") return response.json({ jobs });
  if (view === "proofs") return response.json({ proofs });
  if (view === "settlements") return response.json(settlements);
  return response.json({ issuerId, jobs: jobs.length, proofs: proofs.length, reservedRewards: jobs.filter((job) => job.fundingStatus === "reserved").reduce((sum, job) => sum + Number(job.rewardAmount), 0), payableRewards: proofs.filter((proof) => proof.fundingStatus === "payable").reduce((sum, proof) => sum + Number(jobs.find((job) => job.jobId === proof.jobId)?.rewardAmount || 0), 0), paidProofs: proofs.filter((proof) => proof.fundingStatus === "paid").length, pendingAdjudication: proofs.filter((proof) => proof.adjudicationStatus === "pending_adjudication").length });
}
function verifySubjectivePreflight(job, proof, requirements) {
  if (proof.jobType !== job.job_type) return { approved: false, route: "subjective_preflight", reason: "Proof jobType does not match the claimed job." };
  if (canonicalJson(proof.input) !== canonicalJson(parseJson(job.input_json, {}))) return { approved: false, route: "subjective_preflight", reason: "Proof input does not match the job input." };
  const missing = (requirements.requiredResultFields || []).filter((path) => path.split(".").reduce((value, key) => value?.[key], proof.result) == null);
  return missing.length ? { approved: false, route: "subjective_preflight", reason: `Missing required result field(s): ${missing.join(", ")}.` } : null;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { app } = createApp();
  const port = Number(process.env.PORT || process.env.API_PORT || 8787);
  const host = process.env.API_HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
  app.listen(port, host, () => console.log(`Prooflet API v0 listening at http://${host}:${port}`));
}
