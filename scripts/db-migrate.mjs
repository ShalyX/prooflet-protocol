import { DB_PATH, openDatabase } from "../server/db.mjs";

const db = openDatabase();
const migrations = db.prepare("SELECT version,name,applied_at FROM schema_migrations ORDER BY version").all();
console.log(JSON.stringify({ database: DB_PATH, migrated: true, migrations }, null, 2));
db.close();
