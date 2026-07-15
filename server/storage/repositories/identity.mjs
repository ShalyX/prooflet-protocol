import { hashApiKey } from "../../auth.mjs";
import { json } from "../../db.mjs";

export function createIdentityRepository(store) {
  if (store.dialect === "postgres") return createPostgresIdentityRepository(store);
  if (store.dialect === "sqlite") return createSqliteIdentityRepository(store);
  throw new Error(`Unsupported store dialect: ${store.dialect}`);
}

function createSqliteIdentityRepository(store) {
  const db = () => {
    if (!store.native) throw new Error("SQLite identity repository requires store.native.");
    return store.native;
  };

  return {
    async createIssuer(issuer) {
      try {
        db().prepare(`
          INSERT INTO issuers (issuer_id, name, treasury_address, email, description, status, created_at, circle_wallet_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          issuer.issuerId,
          issuer.name,
          issuer.treasuryAddress ?? null,
          issuer.email ?? null,
          issuer.description ?? null,
          issuer.status || "active",
          issuer.createdAt,
          issuer.circleWalletId ?? null,
        );
      } catch (error) {
        throw asUniqueViolation(error);
      }
    },

    async getIssuer(issuerId) {
      const row = db().prepare("SELECT * FROM issuers WHERE issuer_id = ?").get(issuerId);
      return row ? mapIssuer(row) : null;
    },

    async createAgent(agent) {
      try {
        db().prepare(`
          INSERT INTO agents
            (agent_id, handle, name, capabilities_json, payout_address, status, reputation_score, created_at, circle_wallet_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          agent.agentId,
          agent.handle ?? null,
          agent.name,
          json(agent.capabilities || []),
          agent.payoutAddress,
          agent.status || "idle",
          Number(agent.reputationScore ?? 50),
          agent.createdAt,
          agent.circleWalletId ?? null,
        );
      } catch (error) {
        throw asUniqueViolation(error);
      }
    },

    async getAgent(agentId) {
      const row = db().prepare("SELECT * FROM agents WHERE agent_id = ?").get(agentId);
      return row ? mapAgent(row) : null;
    },

    async storeApiKey({ ownerType, ownerId, apiKey, createdAt = new Date().toISOString() }) {
      try {
        db().prepare(`
          INSERT INTO api_keys (owner_type, owner_id, key_hash, key_prefix, active, created_at)
          VALUES (?, ?, ?, ?, 1, ?)
        `).run(ownerType, ownerId, hashApiKey(apiKey), apiKey.slice(0, 16), createdAt);
      } catch (error) {
        throw asUniqueViolation(error);
      }
    },

    async authenticateApiKey({ ownerType, ownerId, apiKey }) {
      if (!apiKey) return false;
      const row = db().prepare(`
        SELECT owner_type, owner_id FROM api_keys
        WHERE key_hash = ? AND active = 1
      `).get(hashApiKey(apiKey));
      return row?.owner_type === ownerType && row?.owner_id === ownerId;
    },
  };
}

function createPostgresIdentityRepository(store) {
  const query = (text, values = []) => store.query(text, values);

  return {
    async createIssuer(issuer) {
      try {
        await query(`
          INSERT INTO issuers (issuer_id, name, treasury_address, email, description, status, created_at, circle_wallet_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          issuer.issuerId,
          issuer.name,
          issuer.treasuryAddress ?? null,
          issuer.email ?? null,
          issuer.description ?? null,
          issuer.status || "active",
          issuer.createdAt,
          issuer.circleWalletId ?? null,
        ]);
      } catch (error) {
        throw asUniqueViolation(error);
      }
    },

    async getIssuer(issuerId) {
      const result = await query("SELECT * FROM issuers WHERE issuer_id = $1", [issuerId]);
      return result.rows[0] ? mapIssuer(result.rows[0]) : null;
    },

    async createAgent(agent) {
      try {
        await query(`
          INSERT INTO agents
            (agent_id, handle, name, capabilities_json, payout_address, status, reputation_score, created_at, circle_wallet_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          agent.agentId,
          agent.handle ?? null,
          agent.name,
          json(agent.capabilities || []),
          agent.payoutAddress,
          agent.status || "idle",
          Number(agent.reputationScore ?? 50),
          agent.createdAt,
          agent.circleWalletId ?? null,
        ]);
      } catch (error) {
        throw asUniqueViolation(error);
      }
    },

    async getAgent(agentId) {
      const result = await query("SELECT * FROM agents WHERE agent_id = $1", [agentId]);
      return result.rows[0] ? mapAgent(result.rows[0]) : null;
    },

    async storeApiKey({ ownerType, ownerId, apiKey, createdAt = new Date().toISOString() }) {
      try {
        await query(`
          INSERT INTO api_keys (owner_type, owner_id, key_hash, key_prefix, active, created_at)
          VALUES ($1, $2, $3, $4, 1, $5)
        `, [ownerType, ownerId, hashApiKey(apiKey), apiKey.slice(0, 16), createdAt]);
      } catch (error) {
        throw asUniqueViolation(error);
      }
    },

    async authenticateApiKey({ ownerType, ownerId, apiKey }) {
      if (!apiKey) return false;
      const result = await query(`
        SELECT owner_type, owner_id FROM api_keys
        WHERE key_hash = $1 AND active = 1
      `, [hashApiKey(apiKey)]);
      const row = result.rows[0];
      return row?.owner_type === ownerType && row?.owner_id === ownerId;
    },
  };
}

function mapIssuer(row) {
  return {
    issuerId: row.issuer_id,
    name: row.name,
    treasuryAddress: row.treasury_address,
    email: row.email,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    circleWalletId: row.circle_wallet_id,
  };
}

function mapAgent(row) {
  return {
    agentId: row.agent_id,
    handle: row.handle,
    name: row.name,
    capabilities: parseJsonArray(row.capabilities_json),
    payoutAddress: row.payout_address,
    status: row.status,
    reputationScore: Number(row.reputation_score),
    createdAt: row.created_at,
    circleWalletId: row.circle_wallet_id,
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asUniqueViolation(error) {
  const message = String(error?.message || error || "");
  const code = error?.code;
  if (code === "23505" || /unique|UNIQUE/i.test(message)) {
    const unique = new Error(message || "Unique constraint violated.");
    unique.code = "UNIQUE_VIOLATION";
    unique.cause = error;
    return unique;
  }
  return error;
}
