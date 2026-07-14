import { DB_PATH, openDatabase } from "../server/db.mjs";
import { DEV_KEYS, seedDatabase } from "../server/seed.mjs";

const reset = process.argv.includes("--reset");
const seedDemo = process.argv.includes("--seed-demo");
const db = openDatabase({ reset });
if (seedDemo) seedDatabase(db);

const counts = Object.fromEntries(
  ["schema_migrations", "issuers", "agents", "jobs", "job_claims", "proofs", "settlement_batches", "settlement_transactions", "settlement_failures", "api_keys", "reputation_events", "agent_reputation_summary", "adjudicators", "adjudication_decisions", "issuer_uploads"]
    .map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]),
);

console.log(JSON.stringify({
  database: DB_PATH,
  reset,
  counts,
  seedDemo,
  ...(seedDemo ? { developmentKeys: DEV_KEYS, warning: "Development keys are local test credentials and must never be used in production." } : {}),
}, null, 2));
db.close();
