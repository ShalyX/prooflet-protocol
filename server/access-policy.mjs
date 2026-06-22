import { parseUnits } from "viem";

export const ACCESS_POLICY = Object.freeze({
  starter: { maxReward: "0.005", maxActiveLeases: 1 },
  standard: { maxReward: "0.025", maxActiveLeases: 3 },
  trusted: { maxReward: "0.10", maxActiveLeases: 5 },
});

export function requiredAccessLevel(rewardAmount, verificationMode = "deterministic") {
  const reward = parseUnits(String(rewardAmount), 6);
  if (reward > parseUnits("0.10", 6)) return null;
  if (verificationMode === "subjective") return "trusted";
  if (reward <= parseUnits(ACCESS_POLICY.starter.maxReward, 6)) return "starter";
  if (reward <= parseUnits(ACCESS_POLICY.standard.maxReward, 6)) return "standard";
  return "trusted";
}

export function evaluateJobAccess({ capabilities, job, summary, activeLeases }) {
  if (!capabilities.includes(job.job_type)) return denial("capability_mismatch");
  if (summary.currentRiskFlag === "blocked" || summary.accessLevel === "blocked") return denial("blocked_agent");
  if (summary.duplicateProofs > 0) return denial("duplicate_proof_risk");
  if (job.verification_mode === "subjective" && summary.accessLevel !== "trusted") return denial("subjective_job_requires_trusted");
  const policy = ACCESS_POLICY[summary.accessLevel] || ACCESS_POLICY.starter;
  if (parseUnits(job.reward_amount, 6) > parseUnits(policy.maxReward, 6)) return denial("reward_above_access_limit");
  if (activeLeases >= policy.maxActiveLeases) return denial("max_active_leases_reached");
  return { eligible: true, reason: "eligible", accessLevel: summary.accessLevel };
}

function denial(reason) { return { eligible: false, reason }; }
