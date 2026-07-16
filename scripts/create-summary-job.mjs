#!/usr/bin/env node
/**
 * Create a content_summary job for the LLM analyst worker.
 * Usage:
 *   node scripts/create-summary-job.mjs --issuer-id X --api-key Y --reward 0.02
 */
const flags = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) => (a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : [])),
);
const api = (flags["api-url"] || process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const issuerId = flags["issuer-id"] || process.env.ISSUER_ID;
const apiKey = flags["api-key"] || process.env.ISSUER_API_KEY;
const reward = flags.reward || "0.02";
if (!issuerId || !apiKey) {
  console.error("issuer-id and api-key required");
  process.exit(1);
}

const sourceText = flags.text || `
Arc Testnet is an open L1 built for stablecoin-native applications. USDC can act as gas.
Prooflet funds tiny agent jobs on Arc Testnet, verifies structured proofs, and settles approved
rewards in USDC via operator-controlled Escrow V2 release. Circle Gateway provides sub-cent x402
access fees before claim. Open-market funding lets issuers fund jobs before an agent is known.
`.trim();

const body = {
  issuerId,
  jobType: "content_summary",
  rewardAmount: reward,
  verificationMode: "deterministic",
  fundingStatus: "reserved",
  status: "open",
  input: {
    title: "Prooflet + Arc Testnet context",
    sourceText,
    url: "https://www.prooflet.xyz",
  },
  proofRequirements: {
    requiredResultFields: ["summary", "model", "confidence", "tokenUsage", "contentHash"],
  },
};

const res = await fetch(`${api}/jobs`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
  body: JSON.stringify(body),
});
const json = await res.json();
if (!res.ok) {
  console.error(json);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, job: json.job }, null, 2));
