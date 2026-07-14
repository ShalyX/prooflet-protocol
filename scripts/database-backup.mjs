import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "../server/db.mjs";
import { backupDatabase, manifestPathFor } from "../server/database-backup.mjs";

const outputFlag = readFlag("--output");
if (process.env.NODE_ENV === "production" && !outputFlag) {
  throw new Error("Production backups require an explicit --output path and an off-service copy/retention policy.");
}
const destination = resolve(outputFlag || `backups/prooflet-${new Date().toISOString().replaceAll(":", "-")}.sqlite`);
const db = new DatabaseSync(DB_PATH, { readOnly: true });
try {
  await backupDatabase(db, destination);
  console.log(JSON.stringify({ ok: true, backup: destination, manifest: manifestPathFor(destination), createdAt: new Date().toISOString() }, null, 2));
} finally {
  db.close();
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
