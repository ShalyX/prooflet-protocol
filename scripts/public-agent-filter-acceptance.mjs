/**
 * Unit tests for public agent junk filter + durable SIWE nonce table.
 */
import assert from "node:assert/strict";
import { isJunkPublicAgent, filterPublicAgents } from "../server/public-agent-filter.mjs";
import { createWalletNonce } from "../server/auth-wallet.mjs";
import { openDatabase } from "../server/db.mjs";

assert.equal(isJunkPublicAgent({ name: "Close4", agentId: "agent_x" }), true);
assert.equal(isJunkPublicAgent({ name: "Close Agent 2", agentId: "agent_y" }), true);
assert.equal(isJunkPublicAgent({ name: "test", agentId: "agent_z" }), true);
assert.equal(isJunkPublicAgent({ name: "QA Agent 1784217677", agentId: "agent_qa" }), true);
assert.equal(isJunkPublicAgent({ name: "probe", agentId: "agent_probe_x" }), true);
assert.equal(isJunkPublicAgent({ name: "LLM Analyst Hosted", agentId: "agent_llm_1" }), false);
assert.equal(isJunkPublicAgent({ name: "GL Hosted LLM Agent", agentId: "agent_gl_host" }), false);

const ranked = filterPublicAgents([
  { rank: 1, name: "Close4", agentId: "a1" },
  { rank: 2, name: "LLM Analyst Hosted", agentId: "a2" },
  { rank: 3, name: "test", agentId: "a3" },
]);
assert.equal(ranked.length, 1);
assert.equal(ranked[0].name, "LLM Analyst Hosted");
assert.equal(ranked[0].rank, 1);

const path = `data/siwe-nonce-${Date.now()}.sqlite`;
const db = openDatabase({ path, reset: true });
const n1 = await createWalletNonce(db, "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4");
assert.ok(n1.nonce);
assert.ok(n1.message.includes(n1.nonce));
const row = db.prepare("SELECT * FROM wallet_auth_nonces WHERE address=?").get("0xc2094270dc7d17c1578a975dd1aa50578c034be4");
assert.ok(row);
assert.equal(row.nonce, n1.nonce);
// overwrite durable
const n2 = await createWalletNonce(db, "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4");
const row2 = db.prepare("SELECT * FROM wallet_auth_nonces WHERE address=?").get("0xc2094270dc7d17c1578a975dd1aa50578c034be4");
assert.equal(row2.nonce, n2.nonce);
assert.notEqual(n1.nonce, n2.nonce);
db.close?.();

console.log(JSON.stringify({ ok: true, filter: true, durableNonce: true }, null, 2));
