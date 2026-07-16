import { randomBytes, createHash } from "node:crypto";
import { verifyMessage } from "viem";
import { generateApiKey, storeApiKey, hashApiKey } from "./auth.mjs";

const nonces = new Map(); // address(lower) -> { nonce, expiresAt }

function cleanupNonces() {
  const now = Date.now();
  for (const [k, v] of nonces) {
    if (v.expiresAt <= now) nonces.delete(k);
  }
}

export function createWalletNonce(address) {
  cleanupNonces();
  const addr = String(address || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    const err = new Error("address must be a 0x EVM address");
    err.status = 400;
    err.expose = true;
    throw err;
  }
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  nonces.set(addr, { nonce, expiresAt });
  const message = [
    "Prooflet session",
    `Address: ${addr}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    "Sign this message to restore a browser session. No gas. No transfer.",
  ].join("\n");
  return { address: addr, nonce, message, expiresInSec: 300 };
}

export async function verifyWalletSession(db, { address, message, signature, role }) {
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

  cleanupNonces();
  const entry = nonces.get(addr);
  if (!entry || !String(message).includes(`Nonce: ${entry.nonce}`)) {
    const err = new Error("Unknown or expired wallet nonce. Request a new one.");
    err.status = 401;
    err.code = "wallet_nonce_invalid";
    err.expose = true;
    throw err;
  }
  if (entry.expiresAt <= Date.now()) {
    nonces.delete(addr);
    const err = new Error("Wallet nonce expired. Request a new one.");
    err.status = 401;
    err.code = "wallet_nonce_expired";
    err.expose = true;
    throw err;
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: addr,
      message,
      signature,
    });
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
  nonces.delete(addr);

  let principal = null;
  if (role === "agent") {
    const row = await Promise.resolve(
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
    // Prefer treasury / wallet address fields when present.
    const row = await Promise.resolve(
      db
        .prepare(
          `SELECT issuer_id, name, treasury_address, circle_wallet_id
           FROM issuers
           WHERE lower(coalesce(treasury_address, '')) = ?
              OR lower(coalesce(circle_wallet_id, '')) = ?
           LIMIT 1`,
        )
        .get(addr, addr),
    );
    // Also match if circle_wallets table exists with address
    let issuer = row;
    if (!issuer) {
      try {
        issuer = await Promise.resolve(
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
      const err = new Error(
        "No issuer bound to this wallet. Register first, or restore with session key.",
      );
      err.status = 404;
      err.code = "wallet_principal_not_found";
      err.expose = true;
      throw err;
    }
    principal = {
      role: "issuer",
      id: issuer.issuer_id,
      name: issuer.name,
      address: addr,
    };
  }

  // Mint a fresh tab session key (hash stored; plaintext returned once).
  const apiKey = generateApiKey(role === "agent" ? "agent" : "issuer");
  await storeApiKey(db, principal.role, principal.id, apiKey);
  return {
    ...principal,
    apiKey,
    auth: "wallet_siwe",
    note: "Session key stored for this tab only. Private keys never leave the wallet.",
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
  // Constant-time-ish compare
  const a = createHash("sha256").update(String(apiKey)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}
