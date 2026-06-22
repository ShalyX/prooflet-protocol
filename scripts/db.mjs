import { DB_PATH, openDatabase } from "../server/db.mjs";
import { DEV_KEYS, seedDatabase } from "../server/seed.mjs";

const reset = process.argv.includes("--reset");
const db = openDatabase({ reset });
seedDatabase(db);

const counts = Object.fromEntries(
  ["schema_migrations", "issuers", "agents", "jobs", "job_claims", "proofs", "settlement_batches", "settlement_transactions", "settlement_failures", "api_keys", "reputation_events", "agent_reputation_summary", "adjudicators", "adjudication_decisions", "issuer_uploads"]
    .map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]),
);

console.log(JSON.stringify({
  database: DB_PATH,
  reset,
  counts,
  developmentKeys: DEV_KEYS,
  warning: "Development keys are local test credentials. Replace them before any public deployment.",
}, null, 2));
db.close();
