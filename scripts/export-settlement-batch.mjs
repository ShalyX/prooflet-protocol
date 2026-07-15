import { openDatabase } from "../server/db.mjs";

import { createSettlementBatch } from "../server/settlement.mjs";

const outputPath = process.env.BATCH_FILE || "work/settlement-batch.json";
const issuerId = process.env.ISSUER_ID || "useful_waiting_protocol";
const batchIdArg = process.argv.find((arg) => arg.startsWith("--batch-id="));
const db = openDatabase();
const batch = await createSettlementBatch(db, {
  issuerId,
  batchId: batchIdArg?.slice("--batch-id=".length),
  outputPath,
});
console.log(JSON.stringify({ outputPath, batch }, null, 2));
db.close();
