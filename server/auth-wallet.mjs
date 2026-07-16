import { randomBytes, createHash } from "node:crypto";
import { verifyMessage } from "viem";
import { generateApiKey, storeApiKey } from "./auth.mjs";

const NONCE_TTL_MS = 5 * 60 * 1000;
let tableReady = false;

async function q(value) {
  return value && typeof value.then === "function" ? await value : value;
}

async function ensureWalletNonceTable(db) {
  if (tableReady) return;
  await q(
    db
      .prepare(
        `CREATE TABLE IF NOT EXISTS wallet_auth_nonces (
      address TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      message TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
      )
      .run(),
  );
  // Best-effort index; ignore if dialect complains on re-run.
  try {
    await q(db.prepare(`CREATE INDEX IF NOT EXISTS idx_wallet_auth_nonces_expires ON wallet_auth_nonces(expires_at)`).run());
  } catch {
    /* sqlite/pg both support IF NOT EXISTS; ignore rare races */
  }
  tableReady = true;
}

async function purgeExpiredNonces(db) {
  const now = new Date().toISOString();
  await q(db.prepare(`DELETE FROM wallet_auth_nonces WHERE expires_at < ?`).run(now));
}

export async function createWalletNonce(db, address) {
  await ensureWalletNonceTable(db);
  await purgeExpiredNonces(db);

  const addr = String(address || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    const err = new Error("address must be a 0x EVM address");
    err.status = 400;
    err.expose = true;
    throw err;
  }

  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS).toISOString();
  const message = [
    "Prooflet session",
    `Address: ${addr}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    "Sign this message to restore a browser session. No gas. No transfer.",
  ].join("\n");

  // Upsert: one active nonce per address
  await q(db.prepare(`DELETE FROM wallet_auth_nonces WHERE address = ?`).run(addr));
  await q(
    db
      .prepare(
        `INSERT INTO wallet_auth_nonces (address, nonce, message, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(addr, nonce, message, expiresAt, issuedAt),
  );

  return { address: addr, nonce, message, expiresInSec: Math.floor(NONCE_TTL_MS / 1000) };
}

export async function verifyWalletSession(db, { address, message, signature, role }) {
  await ensureWalletNonceTable(db);
  await purgeExpiredNonces(db);

  const addr = String(address || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    const err = new Error("address must be a 0x EVM address");
    err.status = 400;
    err.expose = true;
    throw err;
  }
  if (!message || !signature) {
    const err = new Error("message and signature required");
    err.status = 400;
    err.expose = true;
    throw err;
  }
  if (!["issuer", "agent"].includes(role)) {
    const err = new Error("role must be issuer or agent");
    err.status = 400;
    err.expose = true;
    throw err;
  }

  const entry = await q(db.prepare(`SELECT * FROM wallet_auth_nonces WHERE address = ?`).get(addr));
  if (!entry || entry.nonce !== extractNonce(message) || entry.message !== message) {
    // Also accept if message embeds stored nonce (clients may only send signed message)
    if (!entry || !String(message).includes(`Nonce: ${entry.nonce}`)) {
      const err = new Error("Unknown or expired wallet nonce. Request a new one.");
      err.status = 401;
      err.code = "wallet_nonce_invalid";
      err.expose = true;
      throw err;
    }
  }
  if (new Date(entry.expires_at).getTime() <= Date.now()) {
    await q(db.prepare(`DELETE FROM wallet_auth_nonces WHERE address = ?`).run(addr));
    const err = new Error("Wallet nonce expired. Request a new one.");
    err.status = 401;
    err.code = "wallet_nonce_expired";
    err.expose = true;
    throw err;
  }

  let valid = false;
  try {
    valid = await verifyMessage({ address: addr, message, signature });
  } catch {
    valid = false;
  }
  if (!valid) {
    const err = new Error("Signature verification failed.");
    err.status = 401;
    err.code = "wallet_signature_invalid";
    err.expose = true;
    throw err;
  }

  // One-time use
  await q(db.prepare(`DELETE FROM wallet_auth_nonces WHERE address = ?`).run(addr));

  let principal = null;
  if (role === "agent") {
    const row = await q(
      db
        .prepare(
          `SELECT agent_id, name, payout_address FROM agents
           WHERE lower(payout_address) = ? LIMIT 1`,
        )
        .get(addr),
    );
    if (!row) {
      const err = new Error("No agent registered with this payout address.");
      err.status = 404;
      err.code = "wallet_principal_not_found";
      err.expose = true;
      throw err;
    }
    principal = { role: "agent", id: row.agent_id, name: row.name, address: row.payout_address };
  } else {
    let issuer = await q(
      db
        .prepare(
          `SELECT issuer_id, name, treasury_address
           FROM issuers
           WHERE lower(coalesce(treasury_address, '')) = ?
           LIMIT 1`,
        )
        .get(addr),
    );
    if (!issuer) {
      try {
        issuer = await q(
          db
            .prepare(
              `SELECT i.issuer_id, i.name, i.treasury_address
               FROM issuers i
               JOIN circle_wallets w ON w.issuer_id = i.issuer_id
               WHERE lower(w.address) = ?
               LIMIT 1`,
            )
            .get(addr),
        );
      } catch {
        issuer = null;
      }
    }
    if (!issuer) {
      const err = new Error("No issuer bound to this wallet. Register first, or restore with session key.");
      err.status = 404;
      err.code = "wallet_principal_not_found";
      err.expose = true;
      throw err;
    }
    principal = { role: "issuer", id: issuer.issuer_id, name: issuer.name, address: addr };
  }

  const apiKey = generateApiKey(role === "agent" ? "agent" : "issuer");
  await storeApiKey(db, principal.role, principal.id, apiKey);
  return {
    ...principal,
    apiKey,
    auth: "wallet_siwe",
    note: "Session key stored for this tab only. Private keys never leave the wallet. Nonce was durable (DB).",
  };
}

export function isEscrowOperatorRequest(request) {
  const header = request.get?.("authorization") || request.headers?.authorization || "";
  const apiKey = header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : request.get?.("x-api-key") || request.headers?.["x-api-key"];
  const expected =
    process.env.ESCROW_OPERATOR_API_KEY ||
    process.env.OPERATOR_API_KEY ||
    process.env.ADJUDICATOR_API_KEY ||
    "";
  if (!expected || !apiKey) return false;
  const a = createHash("sha256").update(String(apiKey)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}

function extractNonce(message) {
  const m = String(message || "").match(/Nonce:\s*([a-f0-9]+)/i);
  return m ? m[1] : null;
}
