const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS issuers (issuer_id TEXT PRIMARY KEY, name TEXT NOT NULL, treasury_address TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS agents (agent_id TEXT PRIMARY KEY, name TEXT NOT NULL, capabilities_json TEXT NOT NULL, payout_address TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle', reputation_score INTEGER NOT NULL DEFAULT 50, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS api_keys (api_key_id INTEGER PRIMARY KEY AUTOINCREMENT, owner_type TEXT NOT NULL CHECK (owner_type IN ('agent', 'issuer')), owner_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS jobs (job_id TEXT PRIMARY KEY, issuer_id TEXT NOT NULL REFERENCES issuers(issuer_id), job_type TEXT NOT NULL, input_json TEXT NOT NULL, reward_amount TEXT NOT NULL, reward_asset TEXT NOT NULL DEFAULT 'USDC', network TEXT NOT NULL DEFAULT 'Arc Testnet', funding_status TEXT NOT NULL DEFAULT 'reserved', status TEXT NOT NULL DEFAULT 'open', proof_requirements_json TEXT NOT NULL, claimed_by TEXT REFERENCES agents(agent_id), lease_expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS job_claims (claim_id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(job_id), agent_id TEXT NOT NULL REFERENCES agents(agent_id), claimed_at TEXT NOT NULL, lease_expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');
  CREATE TABLE IF NOT EXISTS settlement_batches (batch_id TEXT PRIMARY KEY, issuer_id TEXT NOT NULL REFERENCES issuers(issuer_id), network TEXT NOT NULL, chain_id INTEGER NOT NULL, asset TEXT NOT NULL, total_payout TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, settled_at TEXT);
  CREATE TABLE IF NOT EXISTS proofs (proof_id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(job_id), agent_id TEXT NOT NULL REFERENCES agents(agent_id), job_type TEXT NOT NULL, input_json TEXT NOT NULL, result_json TEXT NOT NULL, verification_route TEXT NOT NULL, proof_timestamp TEXT NOT NULL, fingerprint TEXT NOT NULL, outcome TEXT NOT NULL, rejection_reason TEXT, funding_status TEXT NOT NULL, settlement_status TEXT NOT NULL, batch_id TEXT REFERENCES settlement_batches(batch_id), tx_hash TEXT, explorer_url TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settlement_transactions (settlement_transaction_id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL REFERENCES settlement_batches(batch_id), proof_id TEXT REFERENCES proofs(proof_id), agent_id TEXT NOT NULL REFERENCES agents(agent_id), recipient_address TEXT NOT NULL, amount TEXT NOT NULL, tx_hash TEXT NOT NULL UNIQUE, explorer_url TEXT NOT NULL, block_number TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settlement_failures (settlement_failure_id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL REFERENCES settlement_batches(batch_id), agent_id TEXT NOT NULL REFERENCES agents(agent_id), proof_ids_json TEXT NOT NULL, amount TEXT NOT NULL, tx_hash TEXT, error_message TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_jobs_claimable ON jobs(status, job_type);
  CREATE INDEX IF NOT EXISTS idx_claims_active ON job_claims(job_id, status);
  CREATE INDEX IF NOT EXISTS idx_proofs_fingerprint ON proofs(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_proofs_payable ON proofs(funding_status, batch_id);
`;

export const migrations = [
  {
    version: 1,
    name: "adopt_v0_schema",
    up(db) { db.exec(BASE_SCHEMA); },
  },
  {
    version: 2,
    name: "reputation_and_adjudication",
    up(db) {
      addColumn(db, "jobs", "verification_mode", "TEXT NOT NULL DEFAULT 'deterministic'");
      addColumn(db, "jobs", "required_access_level", "TEXT NOT NULL DEFAULT 'starter'");
      addColumn(db, "proofs", "verification_status", "TEXT NOT NULL DEFAULT 'deterministic_verified'");
      addColumn(db, "proofs", "adjudication_status", "TEXT NOT NULL DEFAULT 'not_required'");
      db.exec(`
        CREATE TABLE IF NOT EXISTS reputation_events (
          event_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(agent_id), event_type TEXT NOT NULL,
          job_id TEXT, proof_id TEXT, issuer_id TEXT, batch_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reputation_agent_time ON reputation_events(agent_id, created_at);
        CREATE TABLE IF NOT EXISTS agent_reputation_summary (
          agent_id TEXT PRIMARY KEY REFERENCES agents(agent_id), approved_proofs INTEGER NOT NULL DEFAULT 0,
          rejected_proofs INTEGER NOT NULL DEFAULT 0, duplicate_proofs INTEGER NOT NULL DEFAULT 0,
          paid_proofs INTEGER NOT NULL DEFAULT 0, timeout_count INTEGER NOT NULL DEFAULT 0,
          settled_volume_usdc TEXT NOT NULL DEFAULT '0', approval_rate_30d REAL NOT NULL DEFAULT 0,
          duplicate_rate_30d REAL NOT NULL DEFAULT 0, last_event_at TEXT, current_risk_flag TEXT NOT NULL DEFAULT 'clean',
          access_level TEXT NOT NULL DEFAULT 'starter', updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS adjudicators (
          adjudicator_id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS adjudicator_api_keys (
          api_key_id INTEGER PRIMARY KEY AUTOINCREMENT, adjudicator_id TEXT NOT NULL REFERENCES adjudicators(adjudicator_id),
          key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, scopes_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS adjudication_decisions (
          decision_id TEXT PRIMARY KEY, proof_id TEXT NOT NULL UNIQUE REFERENCES proofs(proof_id), job_id TEXT NOT NULL,
          agent_id TEXT NOT NULL, issuer_id TEXT NOT NULL, adjudicator_id TEXT NOT NULL REFERENCES adjudicators(adjudicator_id),
          decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')), reason TEXT NOT NULL, confidence REAL NOT NULL,
          evidence_reviewed_json TEXT NOT NULL, created_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 3,
    name: "issuer_uploads",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS issuer_uploads (
          upload_id TEXT PRIMARY KEY, issuer_id TEXT NOT NULL REFERENCES issuers(issuer_id), filename TEXT NOT NULL,
          format TEXT NOT NULL, status TEXT NOT NULL, total_rows INTEGER NOT NULL, valid_rows INTEGER NOT NULL,
          invalid_rows INTEGER NOT NULL, total_reward TEXT NOT NULL, content_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
          confirmation_mode TEXT, created_job_ids_json TEXT, created_at TEXT NOT NULL, confirmed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS issuer_upload_rows (
          upload_row_id INTEGER PRIMARY KEY AUTOINCREMENT, upload_id TEXT NOT NULL REFERENCES issuer_uploads(upload_id),
          row_number INTEGER NOT NULL, job_json TEXT, errors_json TEXT NOT NULL, valid INTEGER NOT NULL,
          UNIQUE(upload_id, row_number)
        );
      `);
    },
  },
  {
    version: 4,
    name: "genlayer_adjudication",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS genlayer_adjudication_requests (
          request_id TEXT PRIMARY KEY, proof_id TEXT NOT NULL UNIQUE REFERENCES proofs(proof_id),
          job_id TEXT NOT NULL REFERENCES jobs(job_id), issuer_id TEXT NOT NULL REFERENCES issuers(issuer_id),
          agent_id TEXT NOT NULL REFERENCES agents(agent_id), evidence_hash TEXT NOT NULL,
          evidence_json TEXT NOT NULL, mode TEXT NOT NULL, network TEXT NOT NULL,
          contract_address TEXT, genlayer_tx_hash TEXT,
          status TEXT NOT NULL CHECK(status IN ('prepared','submitted','pending','finalized','failed')),
          error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_genlayer_requests_status ON genlayer_adjudication_requests(status, created_at);
        CREATE TABLE IF NOT EXISTS genlayer_adjudication_decisions (
          decision_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE REFERENCES genlayer_adjudication_requests(request_id),
          proof_id TEXT NOT NULL UNIQUE REFERENCES proofs(proof_id), verifier TEXT NOT NULL DEFAULT 'genlayer',
          decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')), reason TEXT NOT NULL,
          confidence REAL, raw_decision_json TEXT NOT NULL, genlayer_tx_hash TEXT, finalized_at TEXT NOT NULL
 );
 `);
 },
 },
 {
     version: 5,
     name: "circle_wallet_support",
     up(db) {
       addColumn(db, "agents", "circle_wallet_id", "TEXT");
     },
   },
   {
     version: 6,
     name: "compound_jobs",
     up(db) {
       addColumn(db, "jobs", "compound_parent_id", "TEXT REFERENCES jobs(job_id)");
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
     },
   },
     {
       version: 7,
       name: "escrow_and_nanopayment_metadata",
       up(db) {
         // Escrow funding metadata
         addColumn(db, "jobs", "funding_rail", "TEXT NOT NULL DEFAULT 'direct_treasury'");
         addColumn(db, "jobs", "escrow_status", "TEXT");
         addColumn(db, "jobs", "escrow_tx_hash", "TEXT");
         // Nanopayment claim metadata
         addColumn(db, "job_claims", "claim_access_rail", "TEXT NOT NULL DEFAULT 'none'");
         addColumn(db, "job_claims", "claim_access_price", "TEXT NOT NULL DEFAULT '0'");
         addColumn(db, "job_claims", "claim_access_status", "TEXT NOT NULL DEFAULT 'unpaid'");
         addColumn(db, "job_claims", "claim_access_tx_hash", "TEXT");
       },
     },
     {
       version: 8,
       name: "external_issuer_funding",
       up(db) {
         addColumn(db, "issuers", "circle_wallet_id", "TEXT");
         addColumn(db, "jobs", "funding_source", "TEXT");
         addColumn(db, "jobs", "treasury_tx_hash", "TEXT");
       },
     },
     {
       version: 9,
       name: "issuer_registration_fields",
       up(db) {
         addColumn(db, "issuers", "email", "TEXT");
         addColumn(db, "issuers", "description", "TEXT");
       },
     },
     {
       version: 10,
       name: "prooflet_generated_identity_metadata",
       up(db) {
         addColumn(db, "agents", "handle", "TEXT");
         addColumn(db, "jobs", "issuer_reference_id", "TEXT");
         db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_issuer_reference ON jobs(issuer_id, issuer_reference_id)");
       },
     },
     {
       version: 11,
       name: "gateway_job_access_payments",
       up(db) {
         db.exec(`
           CREATE TABLE IF NOT EXISTS job_access_payments (
             access_payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
             job_id TEXT NOT NULL REFERENCES jobs(job_id),
             agent_id TEXT NOT NULL REFERENCES agents(agent_id),
             rail TEXT NOT NULL,
             amount TEXT NOT NULL,
             payer_address TEXT,
             tx_hash TEXT,
             gateway_transaction_id TEXT,
             network TEXT NOT NULL,
             status TEXT NOT NULL CHECK(status IN ('paid','failed','refunded')),
             metadata_json TEXT NOT NULL DEFAULT '{}',
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             UNIQUE(job_id, agent_id)
           );
           CREATE INDEX IF NOT EXISTS idx_access_payments_agent ON job_access_payments(agent_id, status, created_at);
           CREATE UNIQUE INDEX IF NOT EXISTS idx_access_payments_tx_hash_unique ON job_access_payments(tx_hash) WHERE tx_hash IS NOT NULL;
           CREATE UNIQUE INDEX IF NOT EXISTS idx_access_payments_gateway_tx_unique ON job_access_payments(gateway_transaction_id) WHERE gateway_transaction_id IS NOT NULL;
         `);
       },
     },
    {
      version: 12,
      name: "unique_access_payment_transactions",
      up(db) {
        db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_access_payments_tx_hash_unique ON job_access_payments(tx_hash) WHERE tx_hash IS NOT NULL;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_access_payments_gateway_tx_unique ON job_access_payments(gateway_transaction_id) WHERE gateway_transaction_id IS NOT NULL;
        `);
      },
    },
      ];

export function runMigrations(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function addColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
