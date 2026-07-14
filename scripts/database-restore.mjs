import { resolve } from "node:path";
import { DB_PATH } from "../server/db.mjs";
import { restoreDatabase } from "../server/database-backup.mjs";

const source = readFlag("--input");
if (!source) throw new Error("Usage: npm run db:restore -- --input /path/to/backup.sqlite --confirm-api-stopped");
if (!process.argv.includes("--confirm-api-stopped")) throw new Error("Restore requires --confirm-api-stopped because the API and workers must be stopped.");

const destination = resolve(readFlag("--destination") || DB_PATH);
restoreDatabase({ sourcePath: resolve(source), destinationPath: destination });
console.log(JSON.stringify({ ok: true, restored: destination, restoredAt: new Date().toISOString() }, null, 2));

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
