/**
 * Pure economics helpers for LLM agent profit gate (unit-testable).
 */
export function estimateJobEconomics(job, opts = {}) {
  const usdPer1kIn = Number(opts.usdPer1kIn ?? 0.00015);
  const usdPer1kOut = Number(opts.usdPer1kOut ?? 0.0006);
  const accessFee = Number(opts.accessFeeUsdc ?? 0.000001);
  const minProfitMargin = Number(opts.minProfitMargin ?? 0.2);
  const reward = Number(job.rewardAmount) || 0;
  const inputText = String(
    job.input?.sourceText || job.input?.text || job.input?.article || job.input?.body || job.input?.content || "",
  );
  const estInputTokens = Math.max(200, Math.ceil(inputText.length / 4) + 180);
  const estOutputTokens = job.jobType === "claim_factcheck" ? 450 : 350;
  const modelCost = (estInputTokens / 1000) * usdPer1kIn + (estOutputTokens / 1000) * usdPer1kOut;
  const estimatedCostUsd = modelCost + accessFee;
  const net = reward - estimatedCostUsd;
  const margin = reward > 0 ? net / reward : -1;
  return {
    reward,
    accessFee,
    estInputTokens,
    estOutputTokens,
    modelCostUsd: round6(modelCost),
    estimatedCostUsd: round6(estimatedCostUsd),
    net: round6(net),
    margin: round6(margin),
    profitable: net > 0 && margin >= minProfitMargin,
    minProfitMargin,
  };
}

function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}
