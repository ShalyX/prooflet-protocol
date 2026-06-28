import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DEV_KEYS } from "../server/seed.mjs";
import { createSettlementBatch } from "../server/settlement.mjs";

export async function runGenLayerDemo({ decision = readDecision(), quiet = false } = {}) {
  if (!["approved", "rejected"].includes(decision)) throw new Error("--decision must be approved or rejected.");

  const previousMode = process.env.ADJUDICATION_MODE;
  process.env.ADJUDICATION_MODE = "manual";
  const suffix = `${Date.now()}_${randomBytes(3).toString("hex")}`;
  const agentId = `genlayer_demo_agent_${suffix}`;
  const jobId = `genlayer_demo_job_${suffix}`;
  const proofId = `genlayer_demo_proof_${suffix}`;
  const originalContext = `Prooflet verifies tiny agent jobs individually, updates reputation from auditable events, and pays only approved proofs with Arc Testnet USDC. Fixture ${suffix}.`;
  const input = {
    demoFixture: true,
    demoLabel: "Mock GenLayer demo fixture",
    originalContext,
    importantFacts: ["proofs are verified individually", "approved proofs use Arc Testnet USDC", "reputation is event based"],
  };
  const compressedText = "Prooflet verifies micro-work, updates event-based reputation, and pays approved proofs in Arc Testnet USDC.";
  const result = {
    demoFixture: true,
    originalHash: `sha256:${createHash("sha256").update(originalContext).digest("hex")}`,
    originalLength: originalContext.length,
    compressedText,
    compressedLength: compressedText.length,
    claimedRetainedFacts: input.importantFacts,
    compressionRatio: Number((compressedText.length / originalContext.length).toFixed(4)),
  };

  const { createApp } = await import(`../server/api.mjs?genlayer-demo=${suffix}`);
  const { app, db } = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const registered = await request(baseUrl, "POST", "/agents/register", {
      agentId, name: "GenLayer Compression Fixture", capabilities: ["context_compression_quality"],
      payoutAddress: `0x${createHash("sha256").update(agentId).digest("hex").slice(0, 40)}`,
    });
    db.prepare("UPDATE agent_reputation_summary SET access_level='trusted',current_risk_flag='clean',duplicate_proofs=0 WHERE agent_id=?").run(agentId);

    await request(baseUrl, "POST", "/jobs", {
      jobId, issuerId: "useful_waiting_protocol", jobType: "context_compression_quality", input,
      rewardAmount: "0.001", rewardAsset: "USDC", network: "Arc Testnet",
      verificationMode: "subjective",
      proofRequirements: {
        requiredResultFields: ["originalHash", "originalLength", "compressedText", "compressedLength", "claimedRetainedFacts", "compressionRatio"],
        preserveImportantFacts: true,
        mockDecision: decision,
      },
    }, DEV_KEYS.issuer);
    await request(baseUrl, "POST", `/agents/${agentId}/claim-job`, { jobId, leaseSeconds: 120 }, registered.apiKey);

    const pending = await request(baseUrl, "POST", `/jobs/${jobId}/proof`, {
      proofId, agentId, jobId, jobType: "context_compression_quality", input, result,
      verificationRoute: "adjudication_router", proofTimestamp: new Date().toISOString(),
    }, registered.apiKey);
    if (pending.proof.fundingStatus !== "pending_adjudication") throw new Error("Demo proof did not enter pending_adjudication before mock routing.");

    process.env.ADJUDICATION_MODE = process.env.GENLAYER_ENABLED === "true" ? "genlayer" : "mock_genlayer";
    const routed = await request(baseUrl, "POST", `/adjudication/genlayer/proofs/${proofId}/submit`, null, DEV_KEYS.genlayerOperator);
    const status = await request(baseUrl, "GET", `/adjudication/genlayer/proofs/${proofId}`, null, DEV_KEYS.genlayerOperator);
    const proof = db.prepare("SELECT funding_status,settlement_status,verification_status FROM proofs WHERE proof_id=?").get(proofId);
    const preparedBatch = proof.funding_status === "payable"
      ? createSettlementBatch(db, { issuerId: "useful_waiting_protocol", batchId: `genlayer_demo_batch_${suffix}`, proofIds: [proofId] })
      : null;
    const includedInSettlement = Boolean(db.prepare(`SELECT 1 FROM proofs WHERE proof_id=? AND outcome='accepted'
      AND funding_status='payable' AND settlement_status!='Settled on Arc Testnet' AND tx_hash IS NULL`).get(proofId));
    const summary = {
      jobId, proofId, requestId: routed.request.requestId,
      verifier: routed.request.decision?.verifier || "genlayer",
      decision: routed.request.decision?.decision,
      reason: routed.request.decision?.reason,
      verificationStatus: proof.verification_status,
      fundingStatus: proof.funding_status,
      settlementStatus: proof.settlement_status,
      settlementEligibility: includedInSettlement ? "included: payable in next dry-run batch" : "excluded: no payout",
      settlementBatchId: preparedBatch?.batchId || null,
      evidenceHash: status.adjudication.request.evidenceHash,
      networkCallPerformed: false,
      arcSettlementPerformed: false,
    };
    if (!quiet) console.log(JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    if (previousMode == null) delete process.env.ADJUDICATION_MODE;
    else process.env.ADJUDICATION_MODE = previousMode;
  }
}

function readDecision() {
  const exactIndex = process.argv.indexOf("--decision");
  const equalsArg = process.argv.find((value) => value.startsWith("--decision="));
  return exactIndex >= 0 ? process.argv[exactIndex + 1] : equalsArg?.slice("--decision=".length) || "approved";
}

async function request(baseUrl, method, path, body, apiKey) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${payload.code || response.status}: ${payload.error || "Demo API request failed."}`);
  return payload;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) await runGenLayerDemo();
