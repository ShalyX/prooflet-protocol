import { createHash, randomBytes } from "node:crypto";

export function generateApiKey(kind) {
  return `uwp_${kind}_${randomBytes(24).toString("hex")}`;
}

export function hashApiKey(apiKey) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export async function storeApiKey(db, ownerType, ownerId, apiKey, createdAt = new Date().toISOString()) {
  await Promise.resolve(
    db.prepare(`
    INSERT INTO api_keys (owner_type, owner_id, key_hash, key_prefix, active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(ownerType, ownerId, hashApiKey(apiKey), apiKey.slice(0, 16), createdAt),
  );
}

export async function authenticate(db, request, ownerType, ownerId) {
  const header = request.get("authorization") || "";
  const apiKey = header.startsWith("Bearer ") ? header.slice(7).trim() : request.get("x-api-key");
  if (!apiKey) return false;
  const row = await Promise.resolve(
    db.prepare(`
    SELECT owner_type, owner_id FROM api_keys
    WHERE key_hash = ? AND active = 1
  `).get(hashApiKey(apiKey)),
  );
  return row?.owner_type === ownerType && row?.owner_id === ownerId;
}

export async function storeAdjudicatorApiKey(db, adjudicatorId, apiKey, scopes, createdAt = new Date().toISOString()) {
  await Promise.resolve(
    db.prepare(`INSERT INTO adjudicator_api_keys
    (adjudicator_id,key_hash,key_prefix,scopes_json,active,created_at) VALUES (?,?,?,?,1,?)`)
      .run(adjudicatorId, hashApiKey(apiKey), apiKey.slice(0, 20), JSON.stringify(scopes), createdAt),
  );
}

export async function authenticateAdjudicator(db, request, requiredScope) {
  const apiKey = readApiKey(request);
  if (!apiKey) return null;
  const row = await Promise.resolve(
    db.prepare(`SELECT k.*,a.status FROM adjudicator_api_keys k JOIN adjudicators a USING(adjudicator_id)
    WHERE k.key_hash=? AND k.active=1`).get(hashApiKey(apiKey)),
  );
  if (!row || row.status !== "active") return null;
  const scopes = JSON.parse(row.scopes_json);
  return scopes.includes(requiredScope) ? { adjudicatorId: row.adjudicator_id, scopes } : null;
}

function readApiKey(request) {
  const header = request.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : request.get("x-api-key");
}
