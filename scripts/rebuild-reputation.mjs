import { openDatabase } from "../server/db.mjs";
import { backfillReputation } from "../server/reputation.mjs";

const db = openDatabase();
const agents = backfillReputation(db);
console.log(JSON.stringify({ rebuilt: true, agents }, null, 2));
db.close();
