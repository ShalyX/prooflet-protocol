import { hashApiKey } from "./auth.mjs";
import { json, withTransaction } from "./db.mjs";

export const DEV_KEYS = {
  issuer: "uwp_issuer_useful_waiting_protocol_dev",
  agent_lynx: "uwp_agent_lynx_dev",
  agent_mira: "uwp_agent_mira_dev",
  agent_byte: "uwp_agent_byte_dev",
  agent_vera: "uwp_agent_vera_dev",
  adjudicator: "uwp_adjudicator_local_review_dev",
  genlayerOperator: "uwp_adjudicator_genlayer_operator_dev",
};

const CREATED_AT = "2026-06-17T14:00:00.000Z";
const SETTLED_AT = "2026-06-17T23:38:28.762Z";

export function seedDatabase(db, { env = process.env } = {}) {
  if (env["NODE_ENV"] === "production") {
    throw new Error("Demo database seeding is disabled in production.");
  }
  withTransaction(db, () => {
    seedIssuer(db);
    seedAgents(db);
    seedJobs(db);
    seedSettlement(db);
    seedRejectedProof(db);
    seedKeys(db);
    seedAdjudicator(db);
  });
}

function seedAdjudicator(db) {
  db.prepare("INSERT OR IGNORE INTO adjudicators (adjudicator_id,name,status,created_at) VALUES ('local_reviewer','Local Protocol Reviewer','active',?)").run(CREATED_AT);
  db.prepare(`INSERT OR IGNORE INTO adjudicator_api_keys
    (adjudicator_id,key_hash,key_prefix,scopes_json,active,created_at) VALUES (?,?,?,?,1,?)`)
    .run("local_reviewer", hashApiKey(DEV_KEYS.adjudicator), DEV_KEYS.adjudicator.slice(0, 20), json(["manual_adjudication:read", "manual_adjudication:write"]), CREATED_AT);
  db.prepare("INSERT OR IGNORE INTO adjudicators (adjudicator_id,name,status,created_at) VALUES ('genlayer_operator','GenLayer Protocol Operator','active',?)").run(CREATED_AT);
  db.prepare(`INSERT OR IGNORE INTO adjudicator_api_keys
    (adjudicator_id,key_hash,key_prefix,scopes_json,active,created_at) VALUES (?,?,?,?,1,?)`)
    .run("genlayer_operator", hashApiKey(DEV_KEYS.genlayerOperator), DEV_KEYS.genlayerOperator.slice(0, 20), json(["genlayer:read", "genlayer:write"]), CREATED_AT);
}

function seedIssuer(db) {
  db.prepare(`
    INSERT OR IGNORE INTO issuers (issuer_id, name, treasury_address, status, created_at)
    VALUES (?, ?, ?, 'active', ?)
  `).run("useful_waiting_protocol", "Prooflet", "0x709F18F797347FbB8D53Fb60567892751dd14B11", CREATED_AT);
}

function seedAgents(db) {
  const agents = [
    ["agent_lynx", "Link Sentinel", ["link_verification"], "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4", 97],
    ["agent_mira", "Freshness Clerk", ["freshness_check"], "0x1DcB045123730e606A88380BCe534332F50332d2", 94],
    ["agent_byte", "Context Press", ["context_compression"], "0x110997DF4d76895ce37B64Bc2665ba2A8e639b1e", 99],
    ["agent_vera", "Label Judge", ["eval_labeling"], "0xE6cDb25252E0f07AE50560ee6F104d48Cfc33667", 91],
  ];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO agents
      (agent_id, name, capabilities_json, payout_address, status, reputation_score, created_at)
    VALUES (?, ?, ?, ?, 'idle', ?, ?)
  `);
  for (const [id, name, capabilities, address, reputation] of agents) {
    insert.run(id, name, json(capabilities), address, reputation, CREATED_AT);
  }
}

function seedJobs(db) {
  const jobs = [
    {
      id: "job_0001", type: "link_verification", input: { url: "https://developers.circle.com/stablecoins" },
      amount: "0.016", funding: "paid", status: "completed", claimedBy: "agent_lynx",
      requirements: { requiredResultFields: ["status", "responseTimeMs", "contentHash"] },
    },
    {
      id: "job_0002", type: "context_compression", input: { traceId: "trace_arc_demo_019", maxTokens: 1500 },
      amount: "0.024", funding: "paid", status: "completed", claimedBy: "agent_byte",
      requirements: { requiredResultFields: ["originalTokens", "compressedTokens", "semanticChecksum"] },
    },
    {
      id: "job_1043", type: "freshness_check", input: { sourceUrl: "https://docs.arc.network", maxAgeHours: 24 },
      amount: "0.014", funding: "paid", status: "completed", claimedBy: "agent_mira",
      requirements: { requiredResultFields: ["lastModified", "stale", "cacheTtlHours"] },
    },
    {
      id: "job_2001", type: "link_verification", input: { url: "https://developers.circle.com/cctp" },
      amount: "0.018", funding: "reserved", status: "open", claimedBy: null,
      requirements: { requiredResultFields: ["status", "responseTimeMs", "contentHash"] },
    },
    {
      id: "job_2002", type: "freshness_check", input: { sourceUrl: "https://docs.arc.network", maxAgeHours: 24 },
      amount: "0.014", funding: "reserved", status: "open", claimedBy: null,
      requirements: { requiredResultFields: ["lastModified", "stale", "cacheTtlHours"] },
    },
  ];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO jobs
      (job_id, issuer_id, job_type, input_json, reward_amount, reward_asset, network,
       funding_status, status, proof_requirements_json, claimed_by, created_at, updated_at)
    VALUES (?, 'useful_waiting_protocol', ?, ?, ?, 'USDC', 'Arc Testnet', ?, ?, ?, ?, ?, ?)
  `);
  for (const job of jobs) {
    insert.run(job.id, job.type, json(job.input), job.amount, job.funding, job.status, json(job.requirements), job.claimedBy, CREATED_AT, CREATED_AT);
  }
}

function seedSettlement(db) {
  db.prepare(`
    INSERT OR IGNORE INTO settlement_batches
      (batch_id, issuer_id, network, chain_id, asset, total_payout, status, created_at, settled_at)
    VALUES ('uwp_arc_20260618_001', 'useful_waiting_protocol', 'Arc Testnet', 5042002, 'USDC', '0.054', 'settled', ?, ?)
  `).run(CREATED_AT, SETTLED_AT);

  const proofs = [
    {
      id: "0x9b31", jobId: "job_0002", agentId: "agent_byte", type: "context_compression", amount: "0.024",
      input: { traceId: "trace_arc_demo_019", maxTokens: 1500 },
      result: { originalTokens: 9142, compressedTokens: 1478, semanticChecksum: "0x9c24b8f3" },
      tx: "0x9ad7d702921178fc1c396bd6e0db2e862a0d3f6c87223a20d018237aeb6cde3d", block: "47501959",
      address: "0x110997DF4d76895ce37B64Bc2665ba2A8e639b1e",
    },
    {
      id: "0x72fa", jobId: "job_0001", agentId: "agent_lynx", type: "link_verification", amount: "0.016",
      input: { url: "https://developers.circle.com/stablecoins" },
      result: { status: 200, responseTimeMs: 183, contentHash: "0x31a9d4e7" },
      tx: "0x3a68ec718ca3390f10a44a7435a78431dda0549ad14be1cc48088d5e91fa4e0a", block: "47501962",
      address: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4",
    },
    {
      id: "0xseed", jobId: "job_1043", agentId: "agent_mira", type: "freshness_check", amount: "0.014",
      input: { sourceUrl: "https://docs.arc.network", maxAgeHours: 24 },
      result: { lastModified: "2026-06-17T13:42:00Z", stale: false, cacheTtlHours: 24 },
      tx: "0x3732ce1d02eebb97c213bd88c1d169f6f01eb79fdd6c527f0e19ca9854751552", block: "47501957",
      address: "0x1DcB045123730e606A88380BCe534332F50332d2",
    },
  ];
  const insertProof = db.prepare(`
    INSERT OR IGNORE INTO proofs
      (proof_id, job_id, agent_id, job_type, input_json, result_json, verification_route,
       proof_timestamp, fingerprint, outcome, funding_status, settlement_status, batch_id,
       tx_hash, explorer_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'historical_settlement_v0', ?, ?, 'accepted', 'paid',
      'Settled on Arc Testnet', 'uwp_arc_20260618_001', ?, ?, ?)
  `);
  const insertTx = db.prepare(`
    INSERT OR IGNORE INTO settlement_transactions
      (batch_id, proof_id, agent_id, recipient_address, amount, tx_hash, explorer_url, block_number, status, created_at)
    VALUES ('uwp_arc_20260618_001', ?, ?, ?, ?, ?, ?, ?, 'success', ?)
  `);
  for (const proof of proofs) {
    const explorer = `https://testnet.arcscan.app/tx/${proof.tx}`;
    insertProof.run(proof.id, proof.jobId, proof.agentId, proof.type, json(proof.input), json(proof.result), SETTLED_AT, `seed:${proof.id}`, proof.tx, explorer, SETTLED_AT);
    insertTx.run(proof.id, proof.agentId, proof.address, proof.amount, proof.tx, explorer, proof.block, SETTLED_AT);
  }
}

function seedRejectedProof(db) {
  db.prepare(`
    INSERT OR IGNORE INTO jobs
      (job_id, issuer_id, job_type, input_json, reward_amount, reward_asset, network,
       funding_status, status, proof_requirements_json, claimed_by, created_at, updated_at)
    VALUES ('job_0003', 'useful_waiting_protocol', 'duplicate_proof', ?, '0.000', 'USDC',
      'Arc Testnet', 'rejected', 'rejected', ?, 'agent_lynx', ?, ?)
  `).run(
    json({ url: "https://developers.circle.com/stablecoins" }),
    json({ requiredResultFields: ["duplicateOf", "contentHash"] }),
    CREATED_AT,
    CREATED_AT,
  );
  db.prepare(`
    INSERT OR IGNORE INTO proofs
      (proof_id, job_id, agent_id, job_type, input_json, result_json, verification_route,
       proof_timestamp, fingerprint, outcome, rejection_reason, funding_status,
       settlement_status, created_at)
    VALUES ('reject_01', 'job_0003', 'agent_lynx', 'duplicate_proof', ?, ?,
      'duplicate_proof_v0', ?, 'seed:reject_01', 'rejected', ?, 'rejected',
      'Rejected · No payout', ?)
  `).run(
    json({ url: "https://developers.circle.com/stablecoins" }),
    json({ duplicateOf: "job_0001", contentHash: "0x31a9d4e7" }),
    "2026-06-17T14:59:00.000Z",
    "Proof reused contentHash from job_0001 without rerunning measurement.",
    "2026-06-17T14:59:00.000Z",
  );
}

function seedKeys(db) {
  const keys = [
    ["issuer", "useful_waiting_protocol", DEV_KEYS.issuer],
    ["agent", "agent_lynx", DEV_KEYS.agent_lynx],
    ["agent", "agent_mira", DEV_KEYS.agent_mira],
    ["agent", "agent_byte", DEV_KEYS.agent_byte],
    ["agent", "agent_vera", DEV_KEYS.agent_vera],
  ];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO api_keys (owner_type, owner_id, key_hash, key_prefix, active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `);
  for (const [type, id, key] of keys) insert.run(type, id, hashApiKey(key), key.slice(0, 16), CREATED_AT);
}
