import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { formatUnits, isAddress, parseUnits } from "viem";
import { authenticate, generateApiKey, storeApiKey } from "./auth.mjs";
import { authenticateAdjudicator } from "./auth.mjs";
import { createAgentWallet, createIssuerWallet, getCircleStatus, isCircleConfigured, getWalletBalance, sendUsdc, getWalletDetails } from "./circle-wallet.mjs";
import { databaseStorageStatus, expireLeases, json, openDatabase, parseJson, withTransaction } from "./db.mjs";
import { createSqliteStoreFromDatabase } from "./storage/index.mjs";
import { seedDatabase } from "./seed.mjs";
import { createSettlementBatch, recordSettledBatch, settlementSummary } from "./settlement.mjs";
import { canonicalJson, proofFingerprint, verifyProof } from "./verifiers.mjs";
import { requiredAccessLevel, evaluateJobAccess } from "./access-policy.mjs";
import { appendReputationEvent, backfillReputation, getReputationSummary } from "./reputation.mjs";
import { decideProof, getAdjudicationProof, listPendingAdjudications, pendingManualRequest } from "./adjudication/index.mjs";
import { getGenLayerRequest, getProofGenLayerStatus, routeConfiguredAdjudication, submitGenLayerProof, syncGenLayerRequest } from "./adjudication/genlayer.mjs";
import { confirmUpload, validateUpload } from "./uploads.mjs";
import { createCompoundJob, checkCompoundJobCompletion, checkCompoundJobFailure, listCompoundJobs } from "./compound-jobs.mjs";
import {
  createPaymentRequest, gatewayConfig, gatewayPrice, getAccessPayment, hasPaidAccess,
  nanopaymentConfig, recordAccessPayment, serializeAccessPayment, verifyNanopayment,
} from "./circle-nanopayment.mjs";

export function createApp({
  db = openDatabase(),
  store,
  walletService = { createAgentWallet, createIssuerWallet, getCircleStatus, isCircleConfigured, getWalletBalance, sendUsdc, getWalletDetails },
  gatewayMiddleware = createGatewayMiddleware(gatewayConfig()),
  seedDemoData = shouldSeedDemoData(),
} = {}) {
  const appStore = store || createSqliteStoreFromDatabase(db, { ownsConnection: false });
  const circle = walletService;
  if (seedDemoData) {
    seedDatabase(db);
    backfillReputation(db);
  }
  const app = express();
  const gateway = gatewayMiddleware;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "3mb" }));
  app.use((request, response, next) => {
    const suppliedRequestId = request.get("x-request-id");
    const clientRequestId = suppliedRequestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedRequestId)
      ? suppliedRequestId
      : null;
    const requestId = randomUUID();
    request.requestId = requestId;
    request.clientRequestId = clientRequestId;
    response.set({
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Request-Id",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "X-Request-Id": requestId,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    const origin = request.get("origin");
    if (origin) {
      response.vary("Origin");
      if (allowedOrigins().has(origin)) response.set("Access-Control-Allow-Origin", origin);
    }
    if (request.method === "OPTIONS") return response.sendStatus(204);
    next();
  });

  app.get("/health", (request, response) => {
    response.set("Cache-Control", "no-store");
    const migrationVersion = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version;
    const foreignKeys = db.prepare("PRAGMA foreign_keys").get().foreign_keys === 1;
    response.json({
      ok: true,
      protocol: "Prooflet",
      version: "v0",
      requestId: request.requestId,
      database: { connected: true, migrationVersion, foreignKeys },
      storage: databaseStorageStatus(),
    });
  });

  app.post("/issuers/register", async (request, response) => {
    let { issuerId, name, treasuryAddress = null, email = null, description = null } = request.body || {};
    requireString(name, "name");
    if (!issuerId) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const suffix = Math.random().toString(36).substring(2, 6);
      issuerId = slug ? `${slug}_${suffix}` : `issuer_${suffix}`;
    }
    requireId(issuerId, "issuerId");
    if (treasuryAddress && !isAddress(treasuryAddress)) throw httpError(400, "treasuryAddress must be a valid EVM address.");
    const apiKey = generateApiKey("issuer");
    const now = new Date().toISOString();
    
    let walletCreated = null;
    let walletProvisioning = null;
    try {
      walletCreated = await circle.createIssuerWallet(issuerId);
      walletProvisioning = { status: "success" };
    } catch (err) {
      walletProvisioning = {
        status: "failed",
        code: err.code || "CIRCLE_WALLET_CREATE_FAILED",
        message: "Circle issuer wallet could not be created. Check server Circle configuration."
      };
    }

    try {
      await appStore.transaction(async (tx) => {
        await tx.identity.createIssuer({
          issuerId,
          name,
          treasuryAddress,
          email,
          description,
          status: "active",
          createdAt: now,
          circleWalletId: walletCreated ? walletCreated.walletId : null,
        });
        await tx.identity.storeApiKey({
          ownerType: "issuer",
          ownerId: issuerId,
          apiKey,
          createdAt: now,
        });
      });
    } catch (error) {
      if (error?.code === "UNIQUE_VIOLATION" || String(error.message).includes("UNIQUE")) {
        throw httpError(409, `Issuer ${issuerId} already exists.`);
      }
      throw error;
    }
    
    const resPayload = { ok: true, issuer: { issuerId, name, treasuryAddress, email, description }, apiKey };
    if (walletCreated) {
      resPayload.wallet = { walletId: walletCreated.walletId, address: walletCreated.address, balance: "0" };
      resPayload.walletProvisioning = { status: "success" };
    } else {
      resPayload.wallet = null;
      resPayload.walletProvisioning = walletProvisioning;
    }
    response.status(201).json(resPayload);
  });

  app.get("/issuers/:issuerId/wallet", async (request, response) => {
    const { issuerId } = request.params;
    if (!authenticate(db, request, "issuer", issuerId)) throw httpError(401, "Valid issuer API key required.");
    const issuer = db.prepare("SELECT * FROM issuers WHERE issuer_id = ?").get(issuerId);
    if (!issuer) throw httpError(404, "Issuer not found");
    
    if (!issuer.circle_wallet_id) {
       try {
         const wallet = await circle.createIssuerWallet(issuerId);
         db.prepare("UPDATE issuers SET circle_wallet_id = ? WHERE issuer_id = ?").run(wallet.walletId, issuerId);
         issuer.circle_wallet_id = wallet.walletId;
         return response.json({ wallet: { walletId: wallet.walletId, address: wallet.address, balance: "0" }, walletProvisioning: { status: "success" } });
       } catch (e) {
         return response.json({ wallet: null, walletProvisioning: { status: "failed", code: e.code || "CIRCLE_WALLET_CREATE_FAILED", message: "Circle issuer wallet could not be created. Check server Circle configuration." } });
       }
    }

    const balance = await circle.getWalletBalance(issuer.circle_wallet_id);
    const details = await circle.getWalletDetails(issuer.circle_wallet_id);
    response.json({ wallet: { walletId: issuer.circle_wallet_id, balance: balance?.amount || "0", address: details?.address || null } });
  });

  app.post("/issuers/:issuerId/wallet", async (request, response) => {
    const { issuerId } = request.params;
    if (!authenticate(db, request, "issuer", issuerId)) throw httpError(401, "Valid issuer API key required.");
    const issuer = db.prepare("SELECT * FROM issuers WHERE issuer_id = ?").get(issuerId);
    if (!issuer) throw httpError(404, "Issuer not found");
    if (issuer.circle_wallet_id) throw httpError(400, "Wallet already exists");
    
    try {
      const wallet = await circle.createIssuerWallet(issuerId);
      db.prepare("UPDATE issuers SET circle_wallet_id = ? WHERE issuer_id = ?").run(wallet.walletId, issuerId);
      response.json({ wallet: { walletId: wallet.walletId, address: wallet.address, balance: "0" }, walletProvisioning: { status: "success" } });
    } catch (e) {
      response.json({ wallet: null, walletProvisioning: { status: "failed", code: e.code || "CIRCLE_WALLET_CREATE_FAILED", message: "Circle issuer wallet could not be created. Check server Circle configuration." } });
    }
  });

  app.post("/jobs/:jobId/fund-escrow", async (request, response) => {
    const { jobId } = request.params;
    const { issuerId } = request.body || {};
    requireId(issuerId, "issuerId");
    verifyApiKey(request, db, "issuer", issuerId);

    const job = db.prepare("SELECT * FROM jobs WHERE job_id = ? AND issuer_id = ?").get(jobId, issuerId);
    if (!job) throw httpError(404, "Job not found");
    if (job.funding_status !== "awaiting_wallet_funding") throw httpError(400, "Job is not awaiting wallet funding");

    throw httpError(400, "Open marketplace funding requires ProofletEscrowV2. Coming soon.");
  });

  app.post("/agents/register", async (request, response) => {
    const { agentId: requestedAgentId, handle = null, name, capabilities, payoutAddress, status = "idle", reputationScore = 50 } = request.body || {};
    const agentId = requestedAgentId || generateCanonicalId("agent", db, "agents", "agent_id");
    requireId(agentId, "agentId");
    const normalizedHandle = normalizeOptionalHandle(handle, "handle");
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
      await appStore.transaction(async (tx) => {
        await tx.identity.createAgent({
          agentId,
          handle: normalizedHandle,
          name,
          capabilities: [...new Set(capabilities)],
          payoutAddress,
          status,
          reputationScore: score,
          createdAt: now,
          circleWalletId: null,
        });
        await tx.identity.storeApiKey({
          ownerType: "agent",
          ownerId: agentId,
          apiKey,
          createdAt: now,
        });
        appendReputationEvent(db, { eventId: `registered:${agentId}`, agentId, eventType: "agent_registered", createdAt: now });
      });
    } catch (error) {
      if (error?.code === "UNIQUE_VIOLATION" || String(error.message).includes("UNIQUE")) {
        throw httpError(409, `Agent ${agentId} already exists.`);
      }
      throw error;
    }
    response.status(201).json({ agent: { agentId, handle: normalizedHandle, name, capabilities, payoutAddress, status, reputationScore: score }, apiKey });
  });

  app.post("/agents/register-with-wallet", async (request, response) => {
    const { agentId: requestedAgentId, handle = null, name, capabilities, payoutAddress, status = "idle", reputationScore = 50 } = request.body || {};
    const agentId = requestedAgentId || generateCanonicalId("agent", db, "agents", "agent_id");
    requireId(agentId, "agentId");
    const normalizedHandle = normalizeOptionalHandle(handle, "handle");
    requireString(name, "name");
    if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.some((item) => typeof item !== "string")) {
      throw httpError(400, "capabilities must be a non-empty string array.");
    }
    const hasFallbackPayout = typeof payoutAddress === "string" && payoutAddress.length > 0;
    if (hasFallbackPayout && !isAddress(payoutAddress)) throw httpError(400, "payoutAddress must be a valid EVM address.");
    const score = Number(reputationScore);
    if (!Number.isInteger(score) || score < 0 || score > 100) throw httpError(400, "reputationScore must be an integer from 0 to 100.");
    const apiKey = generateApiKey("agent");
    const now = new Date().toISOString();

    let circleWallet = null;
    let walletProvisioning = null;
    let finalPayoutAddress = payoutAddress || null;

    if (circle.isCircleConfigured()) {
      try {
        circleWallet = await circle.createAgentWallet(agentId, name);
        if (!circleWallet?.address || !isAddress(circleWallet.address)) throw new Error("Circle wallet response did not include a valid address.");
        finalPayoutAddress = circleWallet.address;
        walletProvisioning = { status: "success" };
      } catch (walletError) {
        walletProvisioning = {
          status: "failed",
          code: walletError.code || "CIRCLE_WALLET_CREATE_FAILED",
          message: "Circle wallet could not be created. Check server Circle configuration.",
        };
        circleWallet = null;
        if (!hasFallbackPayout) {
          throw httpError(400, "Circle wallet provisioning failed and no fallback payoutAddress was provided.", walletProvisioning);
        }
      }
    } else {
      walletProvisioning = { status: "not_configured", code: "CIRCLE_CONFIG_MISSING", message: "Circle wallet provisioning is not configured." };
      if (!hasFallbackPayout) throw httpError(400, "Circle wallet provisioning is not configured and payoutAddress is required.", walletProvisioning);
    }

    try {
      await appStore.transaction(async (tx) => {
        await tx.identity.createAgent({
          agentId,
          handle: normalizedHandle,
          name,
          capabilities: [...new Set(capabilities)],
          payoutAddress: finalPayoutAddress,
          status,
          reputationScore: score,
          createdAt: now,
          circleWalletId: circleWallet?.walletId || null,
        });
        await tx.identity.storeApiKey({
          ownerType: "agent",
          ownerId: agentId,
          apiKey,
          createdAt: now,
        });
        appendReputationEvent(db, { eventId: `registered:${agentId}`, agentId, eventType: "agent_registered", createdAt: now });
      });
    } catch (error) {
      if (error?.code === "UNIQUE_VIOLATION" || String(error.message).includes("UNIQUE")) {
        throw httpError(409, `Agent ${agentId} already exists.`);
      }
      throw error;
    }
    response.status(201).json({
      agent: { agentId, handle: normalizedHandle, name, capabilities, payoutAddress: finalPayoutAddress, status, reputationScore: score, circleWalletId: circleWallet?.walletId || null },
      circleWallet,
      walletProvisioning,
      apiKey,
    });
  });

  app.post("/jobs", async (request, response) => {
    const {
      jobId: requestedJobId, issuerReferenceId = null, issuerId, jobType, input, rewardAmount, rewardAsset = "USDC",
      network = "Arc Testnet", fundingStatus = "reserved", status = "open", proofRequirements, verificationMode = "deterministic",
      fundingRail = "direct_treasury"
    } = request.body || {};
    const jobId = requestedJobId || generateCanonicalId("job", db, "jobs", "job_id");
    requireId(jobId, "jobId");
    const normalizedIssuerReferenceId = normalizeOptionalReference(issuerReferenceId, "issuerReferenceId");
    requireId(issuerId, "issuerId");
    requireString(jobType, "jobType");
    if (!authenticate(db, request, "issuer", issuerId)) throw httpError(401, "Valid issuer API key required.");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw httpError(400, "input must be an object.");
    validateReward(rewardAmount);
    if (rewardAsset !== "USDC") throw httpError(400, "rewardAsset must be USDC.");
    if (network !== "Arc Testnet") throw httpError(400, "network must be Arc Testnet.");
    if (!["reserved", "awaiting_wallet_funding"].includes(fundingStatus) || !["open", "draft"].includes(status)) throw httpError(400, "New jobs must be reserved/awaiting_wallet_funding and open/draft.");
    if (!proofRequirements || typeof proofRequirements !== "object") throw httpError(400, "proofRequirements must be an object.");
    if (!["deterministic", "subjective"].includes(verificationMode)) throw httpError(400, "verificationMode must be deterministic or subjective.");
    const accessLevel = requiredAccessLevel(rewardAmount, verificationMode);
    if (!accessLevel) throw httpError(400, "rewardAmount exceeds the v0 maximum of 0.10 USDC.");
    const now = new Date().toISOString();
    try {
      await appStore.transaction(async (tx) => {
        await tx.jobs.createJob({
          jobId,
          issuerReferenceId: normalizedIssuerReferenceId,
          issuerId,
          jobType,
          input,
          rewardAmount: normalizedReward(rewardAmount),
          rewardAsset: "USDC",
          network: "Arc Testnet",
          fundingStatus,
          status,
          proofRequirements,
          verificationMode,
          requiredAccessLevel: accessLevel,
          createdAt: now,
          updatedAt: now,
        });
        if (fundingRail && fundingRail !== "direct_treasury") {
          db.prepare("UPDATE jobs SET funding_rail = ? WHERE job_id = ?").run(fundingRail, jobId);
        }
      });
    } catch (error) {
      if (error?.code === "UNIQUE_VIOLATION" || String(error.message).includes("UNIQUE")) {
        throw httpError(409, `Job ${jobId} already exists.`);
      }
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

  app.post("/agents/:agentId/claim-job", async (request, response) => {
    const { agentId } = request.params;
    if (!authenticate(db, request, "agent", agentId)) throw httpError(401, "Valid agent API key required.");
    const agent = db.prepare("SELECT * FROM agents WHERE agent_id = ?").get(agentId);
    if (!agent) throw httpError(404, `Agent ${agentId} does not exist.`);
    const capabilities = parseJson(agent.capabilities_json, []);
    const requestedJobId = request.body?.jobId;
    const leaseSeconds = Math.min(Math.max(Number(request.body?.leaseSeconds || 60), 5), 3600);
    if (!Number.isFinite(leaseSeconds)) throw httpError(400, "leaseSeconds must be numeric.");

    const claimed = await appStore.transaction(async (tx) => {
      expireLeasesWithEvents(db);
      const summary = getReputationSummary(db, agentId);
      const activeLeases = db.prepare("SELECT COUNT(*) AS count FROM job_claims WHERE agent_id=? AND status='active'").get(agentId).count;
      let job;
      if (requestedJobId) {
        job = db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(requestedJobId);
        if (!job) throw httpError(404, `Job ${requestedJobId} does not exist.`);
        if (job.status !== "open") throw httpError(409, `Job ${requestedJobId} is not open.`);
        if (!["reserved", "funded"].includes(job.funding_status)) throw httpError(409, `Job ${requestedJobId} requires funding before it can be claimed.`);
        const eligibility = evaluateJobAccess({ capabilities, job, summary, activeLeases });
        if (!eligibility.eligible) throw eligibilityError(409, eligibility.reason, `Agent ${agentId} is not eligible for ${requestedJobId}.`, eligibility);
        requirePaidJobAccess(db, job, agentId);
      } else {
        if (capabilities.length === 0) throw httpError(409, `Agent ${agentId} has no capabilities.`);
        const placeholders = capabilities.map(() => "?").join(",");
        const candidates = db.prepare(`
          SELECT * FROM jobs WHERE status = 'open' AND funding_status IN ('reserved', 'funded') AND job_type IN (${placeholders})
          ORDER BY created_at DESC, job_id DESC
        `).all(...capabilities);
        job = candidates.find((candidate) => evaluateJobAccess({ capabilities, job: candidate, summary, activeLeases }).eligible && hasPaidAccess(db, candidate.job_id, agentId));
        if (!job) throw accessRequiredError("No eligible open job with paid access is available.");
      }
      const claimedAt = new Date();
      const leaseExpiresAt = new Date(claimedAt.getTime() + leaseSeconds * 1000).toISOString();
      const accessPayment = getAccessPayment(db, job.job_id, agentId);
      try {
        await tx.jobs.claimJob({
          jobId: job.job_id,
          agentId,
          claimedAt: claimedAt.toISOString(),
          leaseExpiresAt,
          access: {
            rail: accessPayment?.rail || "circle_gateway_x402",
            price: accessPayment?.amount || "0.000001",
            status: "paid",
            txHash: accessPayment?.tx_hash || accessPayment?.gateway_transaction_id || null,
          },
        });
      } catch (error) {
        if (error?.code === "JOB_NOT_CLAIMABLE") {
          throw httpError(409, `Job ${job.job_id} is not open.`);
        }
        throw error;
      }
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

    const result = await appStore.transaction(async (tx) => {
      expireLeasesWithEvents(db);
      const job = db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId);
      if (!job) throw httpError(404, `Job ${jobId} does not exist.`);
      if (job.status !== "claimed" || job.claimed_by !== proof.agentId) throw httpError(409, "Job is not actively claimed by this agent.");
      const claim = db.prepare(`
        SELECT * FROM job_claims WHERE job_id = ? AND agent_id = ? AND status = 'active'
        ORDER BY claim_id DESC LIMIT 1
      `).get(jobId, proof.agentId);
      if (!claim || claim.lease_expires_at <= new Date().toISOString()) throw httpError(409, "Claim lease expired before proof submission.");
      if (await tx.proofs.getProof(proof.proofId)) throw httpError(409, `Proof ${proof.proofId} already exists.`);

      const requirements = parseJson(job.proof_requirements_json, {});
      const fingerprint = proofFingerprint(proof);
      const duplicate = await tx.proofs.findByFingerprint(fingerprint);
      const subjective = job.verification_mode === "subjective";
      const subjectivePreflight = subjective ? verifySubjectivePreflight(job, proof, requirements) : null;
      const verification = duplicate
        ? { approved: false, route: "duplicate_proof_v0", reason: `Duplicate proof payload matches ${duplicate.proofId} from ${duplicate.jobId}.` }
        : subjective ? (subjectivePreflight || { approved: false, pending: true, route: "manual_adapter", reason: null })
        : verifyProof({ jobType: job.job_type, input: parseJson(job.input_json, {}) }, proof, requirements);
      const outcome = verification.pending ? "pending_adjudication" : verification.approved ? "accepted" : "rejected";
      const fundingStatus = verification.pending ? "pending_adjudication" : verification.approved ? "payable" : "rejected";
      const settlementStatus = verification.pending ? "Pending adjudication · No payout" : verification.approved ? "Awaiting Arc Testnet settlement" : "Rejected · No payout";
      const verificationStatus = verification.pending ? "pending_adjudication" : verification.approved ? "deterministic_verified" : duplicate ? "duplicate_rejected" : "deterministic_rejected";
      const adjudicationStatus = verification.pending ? "pending_adjudication" : "not_required";
      const now = new Date().toISOString();
      let created;
      try {
        created = await tx.proofs.createProof({
          proofId: proof.proofId,
          jobId,
          agentId: proof.agentId,
          jobType: proof.jobType,
          input: proof.input,
          result: proof.result,
          verificationRoute: verification.route,
          proofTimestamp: proof.proofTimestamp,
          fingerprint,
          outcome,
          rejectionReason: verification.reason,
          fundingStatus,
          settlementStatus,
          verificationStatus,
          adjudicationStatus,
          createdAt: now,
        });
      } catch (error) {
        if (error?.code === "UNIQUE_VIOLATION") throw httpError(409, `Proof ${proof.proofId} already exists.`);
        throw error;
      }
      await tx.proofs.markClaimSubmitted(claim.claim_id);
      await tx.proofs.completeJobAfterProof({
        jobId,
        jobStatus: verification.pending ? "pending_adjudication" : verification.approved ? "completed" : "rejected",
        fundingStatus,
        updatedAt: now,
      });
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
    response.json(circle.getCircleStatus());
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
  app.get("/dashboard", (_request, response) => response.json(buildDashboard(db, circle)));

  // ---- Escrow Endpoints ----
  // Legacy/pre-assigned V1 escrow path only. Open marketplace external funding
  // requires ProofletEscrowV2 and must not use deposit-on-claim.
  app.post("/escrow/deposit", (request, response) => {
    if (!authenticate(db, request, "issuer", "useful_waiting_protocol")) throw httpError(403, "Demo issuer API key required for legacy Escrow V1 record path.");
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

  app.get("/jobs/:jobId/access-fee/status", (request, response) => {
    const agentId = String(request.query.agentId || request.get("x-agent-id") || "");
    requireId(agentId, "agentId");
    if (!authenticate(db, request, "agent", agentId) && !authenticate(db, request, "issuer", "useful_waiting_protocol")) throw httpError(403, "Agent or demo issuer API key required.");
    const job = db.prepare("SELECT 1 FROM jobs WHERE job_id=?").get(request.params.jobId);
    if (!job) throw httpError(404, `Job ${request.params.jobId} does not exist.`);
    const payment = getAccessPayment(db, request.params.jobId, agentId);
    response.json({ paid: payment?.status === "paid", payment: serializeAccessPayment(payment), config: nanopaymentConfig() });
  });

  app.get("/jobs/:jobId/gateway-access", validateGatewayAccessTarget(db), gateway.require(gatewayPrice()), async (request, response) => {
    const agentId = String(request.query.agentId || request.get("x-agent-id") || "");
    requireId(agentId, "agentId");
    const job = db.prepare("SELECT * FROM jobs WHERE job_id=?").get(request.params.jobId);
    if (!job) throw httpError(404, `Job ${request.params.jobId} does not exist.`);
    const agent = db.prepare("SELECT payout_address FROM agents WHERE agent_id=?").get(agentId);
    if (!agent) throw httpError(404, `Agent ${agentId} does not exist.`);
    const payerAddress = request.payment?.payer || null;
    if (!payerAddress || !isAddress(payerAddress)) throw httpError(403, "Gateway payment payer address is required.");
    if (!agent.payout_address || agent.payout_address.toLowerCase() !== payerAddress.toLowerCase()) throw httpError(403, "Gateway payment payer must match the registered agent payout address.");
    if (request.payment?.transaction) {
      const existing = await appStore.accessPayments.findByGatewayTransactionId(request.payment.transaction);
      if (existing && (existing.jobId !== request.params.jobId || existing.agentId !== agentId)) {
        throw httpError(409, "Gateway payment transaction was already used for another job or agent.");
      }
    }
    let payment;
    try {
      payment = await appStore.accessPayments.recordPaidAccess({
        jobId: request.params.jobId,
        agentId,
        rail: "circle_gateway_x402",
        amount: nanopaymentConfig().accessFee,
        payerAddress,
        gatewayTransactionId: request.payment?.transaction || null,
        network: request.payment?.network || nanopaymentConfig().network,
        metadata: { payment: request.payment || null, resource: "job_access" },
      });
    } catch (error) {
      if (error?.code === "UNIQUE_VIOLATION") throw httpError(409, "Gateway payment transaction was already used for another job or agent.");
      throw error;
    }
    response.json({ ok: true, access: "granted", jobId: request.params.jobId, agentId, payment: serializeAccessPaymentRow(payment) });
  });

  app.post("/jobs/:jobId/access-fee/verify", async (request, response) => {
    const { agentId, agentAddress } = request.body || {};
    requireId(agentId, "agentId");
    requireString(agentAddress, "agentAddress");
    const agent = db.prepare("SELECT payout_address FROM agents WHERE agent_id=?").get(agentId);
    if (!agent) throw httpError(404, `Agent ${agentId} does not exist.`);
    if (!authenticate(db, request, "agent", agentId)) throw httpError(403, "Agent API key required to verify fallback access payment.");
    if (!isAddress(agentAddress)) throw httpError(400, "agentAddress must be a valid EVM address.");
    if (!agent.payout_address || agent.payout_address.toLowerCase() !== agentAddress.toLowerCase()) throw httpError(403, "agentAddress must match the registered agent payout address.");
    const result = await verifyNanopayment(agentAddress, request.params.jobId);
    if (result.paid) {
      if (result.txHash) {
        const existing = await appStore.accessPayments.findByTxHash(result.txHash);
        if (existing && (existing.jobId !== request.params.jobId || existing.agentId !== agentId)) {
          throw httpError(409, "Fallback access payment transaction was already used for another job or agent.");
        }
      }
      try {
        await appStore.accessPayments.recordPaidAccess({
          jobId: request.params.jobId,
          agentId,
          rail: "arc_usdc_event_scan",
          amount: result.accessFee,
          payerAddress: agentAddress,
          txHash: result.txHash || null,
          network: nanopaymentConfig().network,
          metadata: { verifier: "arc_usdc_transfer_event", transferCount: result.transferCount || 0 },
        });
      } catch (error) {
        if (error?.code === "UNIQUE_VIOLATION") throw httpError(409, "Fallback access payment transaction was already used for another job or agent.");
        throw error;
      }
    }
    const payment = result.paid ? await appStore.accessPayments.getPaidAccess(request.params.jobId, agentId) : null;
    response.json({ ...result, payment: result.paid ? serializeAccessPaymentRow(payment) : null });
  });

  app.use((error, request, response, _next) => {
    const status = error.status || 500;
    if (status >= 500 && error.expose !== true) {
      console.error(`[${request.requestId}]`, error.stack || error);
      return response.status(status).json({ error: "Internal server error.", code: "internal_error", requestId: request.requestId });
    }
    if (status >= 500) console.error(`[${request.requestId}]`, error.stack || error);
    response.status(status).json({ error: error.message || "Request failed.", requestId: request.requestId, ...(error.code ? { code: error.code } : {}), ...(error.payment ? { payment: error.payment } : {}), ...(error.eligibility ? { eligibility: error.eligibility } : {}), ...(error.walletProvisioning ? { walletProvisioning: error.walletProvisioning } : {}) });
  });
  return { app, db, store: appStore };
}

function allowedOrigins(env = process.env) {
  const configured = env["PROOFLET_ALLOWED_ORIGINS"] || "https://prooflet.xyz,https://www.prooflet.xyz,http://127.0.0.1:5173,http://localhost:5173";
  return new Set(configured.split(",").map((item) => item.trim()).filter(Boolean));
}

function shouldSeedDemoData(env = process.env) {
  if (env["PROOFLET_SEED_DEMO_DATA"] !== undefined) return env["PROOFLET_SEED_DEMO_DATA"] === "true";
  return env["NODE_ENV"] !== "production";
}

function buildDashboard(db, circle) {
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
    issuer: issuer ? { issuerId: issuer.issuer_id, name: issuer.name, treasuryAddress: issuer.treasury_address } : null,
    treasury: { network: "Arc Testnet", asset: "USDC", reservedRewards: reserved, pendingPayout: sum("payable"), paidOut: sum("paid") },
    agents,
    jobs,
    proofs,
    settlements,
    circle: circle.getCircleStatus(),
  };
}

function serializeAgent(row) {
  const circleWalletId = row.circle_wallet_id || null;
  return {
    agentId: row.agent_id,
    handle: row.handle || null,
    name: row.name,
    capabilities: parseJson(row.capabilities_json, []),
    payoutAddress: row.payout_address,
    status: row.status,
    reputationScore: row.reputation_score,
    circleWalletId,
    walletSource: circleWalletId ? "circle_wallet" : "manual_payout",
  };
}

function serializeJob(row) {
  return {
    jobId: row.job_id, issuerReferenceId: row.issuer_reference_id || null, issuerId: row.issuer_id, jobType: row.job_type, input: parseJson(row.input_json, {}),
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

function serializeAccessPaymentRow(payment) {
  if (!payment) return null;
  if (payment.jobId) {
    return {
      jobId: payment.jobId,
      agentId: payment.agentId,
      rail: payment.rail,
      amount: payment.amount,
      payerAddress: payment.payerAddress,
      txHash: payment.txHash,
      gatewayTransactionId: payment.gatewayTransactionId,
      network: payment.network,
      status: payment.status,
      metadata: payment.metadata || {},
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
  return serializeAccessPayment(payment);
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

function normalizeOptionalHandle(value, name) {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/.test(normalized)) throw httpError(400, `${name} must be 3-64 lowercase letters, numbers, underscores, or hyphens.`);
  return normalized;
}

function normalizeOptionalReference(value, name) {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim();
  if (normalized.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(normalized)) throw httpError(400, `${name} must be 1-120 letters, numbers, dots, colons, underscores, or hyphens.`);
  return normalized;
}

function generateCanonicalId(prefix, db, table, column) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const id = `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`).get(id)) return id;
  }
  throw httpError(503, `Could not allocate ${prefix} ID. Try again.`);
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

function httpError(status, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.expose = status < 500;
  if (details) error.walletProvisioning = details;
  return error;
}

function eligibilityError(status, code, message, eligibility) { const error = httpError(status, message); error.code = code; error.eligibility = eligibility; return error; }
function accessRequiredError(message, jobId = null) { const error = httpError(402, message); error.code = "claim_access_payment_required"; error.payment = { ...nanopaymentConfig(), ...(jobId ? { jobId } : {}) }; return error; }
function validateGatewayAccessTarget(db) { return (request, _response, next) => { try { const agentId = String(request.query.agentId || request.get("x-agent-id") || ""); requireId(agentId, "agentId"); if (!db.prepare("SELECT 1 FROM jobs WHERE job_id=?").get(request.params.jobId)) throw httpError(404, `Job ${request.params.jobId} does not exist.`); if (!db.prepare("SELECT 1 FROM agents WHERE agent_id=?").get(agentId)) throw httpError(404, `Agent ${agentId} does not exist.`); next(); } catch (error) { next(error); } }; }
function requirePaidJobAccess(db, job, agentId) { if (!hasPaidAccess(db, job.job_id, agentId)) throw accessRequiredError(`Circle Gateway x402 access payment required before claiming ${job.job_id}.`, job.job_id); }
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
