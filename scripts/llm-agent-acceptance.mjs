/**
 * Acceptance: LLM profit gate rejects underwater jobs; schema verifiers accept good proofs.
 */
import assert from "node:assert/strict";
import { estimateJobEconomics } from "../workers/lib/llm-economics.mjs";
import { verifyProof } from "../server/verifiers.mjs";

const cheap = estimateJobEconomics({
  jobType: "content_summary",
  rewardAmount: "0.05",
  input: { sourceText: "x".repeat(800) },
}, { usdPer1kIn: 0.00015, usdPer1kOut: 0.0006, accessFeeUsdc: 0.000001, minProfitMargin: 0.2 });
assert.equal(cheap.profitable, true, "decent reward should clear profit gate");

const underwater = estimateJobEconomics({
  jobType: "content_summary",
  rewardAmount: "0.00001",
  input: { sourceText: "x".repeat(50_000) },
}, { usdPer1kIn: 0.5, usdPer1kOut: 1.5, accessFeeUsdc: 0.000001, minProfitMargin: 0.2 });
assert.equal(underwater.profitable, false, "tiny reward + huge input must reject");

const summaryOk = verifyProof(
  { jobType: "content_summary", input: { sourceText: "hello world ".repeat(20) } },
  {
    jobType: "content_summary",
    input: { sourceText: "hello world ".repeat(20) },
    result: {
      summary: "A".repeat(50),
      model: "test-model",
      confidence: 0.7,
      tokenUsage: { totalTokens: 120 },
      contentHash: "0xabc123",
    },
  },
  { requiredResultFields: ["summary", "model", "confidence", "tokenUsage", "contentHash"] },
);
assert.equal(summaryOk.approved, true);
assert.equal(summaryOk.route, "content_summary_schema_v0");

const factOk = verifyProof(
  { jobType: "claim_factcheck", input: { claim: "x", sourceText: "y".repeat(40) } },
  {
    jobType: "claim_factcheck",
    input: { claim: "x", sourceText: "y".repeat(40) },
    result: {
      verdict: "supported",
      confidence: 0.8,
      rationale: "Matches source.",
      model: "test-model",
      tokenUsage: { totalTokens: 90 },
    },
  },
  { requiredResultFields: ["verdict", "confidence", "rationale", "model", "tokenUsage"] },
);
assert.equal(factOk.approved, true);

console.log(JSON.stringify({
  ok: true,
  profitGateRejectsUnderwater: true,
  contentSummarySchema: true,
  claimFactcheckSchema: true,
}, null, 2));
