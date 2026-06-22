import { randomUUID } from "node:crypto";
import { IssuerClient } from "@useful-waiting/issuer-sdk";

try {
  await main();
} catch (error) {
  console.error(`create-link-job: ${error.message}`);
  process.exitCode = 1;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const apiUrl = (process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  const issuerId = process.env.ISSUER_ID || "useful_waiting_protocol";
  const issuerApiKey = process.env.ISSUER_API_KEY || "uwp_issuer_useful_waiting_protocol_dev";
  const linkUrl = requiredFlag(flags.url, "--url", flags.useDefaults ? process.env.LINK_URL || "https://example.com/" : null);
  const rewardAmount = requiredFlag(flags.reward, "--reward", flags.useDefaults ? process.env.LINK_REWARD_AMOUNT || "0.003" : null);
  const jobId = flags.jobId || process.env.JOB_ID || `job_link_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const client = new IssuerClient({ issuerId, apiKey: issuerApiKey, baseUrl: apiUrl });

  assertHttpUrl(linkUrl);
  const health = await client.health();
  if (!health.ok) throw new Error("Prooflet API health check failed.");

  const job = await client.createJob({
    jobId,
    issuerId,
    jobType: "link_verification",
    input: { url: linkUrl },
    rewardAmount,
    rewardAsset: "USDC",
    network: "Arc Testnet",
    fundingStatus: "reserved",
    status: "open",
    proofRequirements: {
      verifier: "link_verification_v0",
      requiredResultFields: ["status", "responseTimeMs", "contentHash", "checkedAt"],
    },
  });

  console.log(JSON.stringify({
    created: true,
    fundedBy: issuerId,
    job,
    next: "Run npm run agent:link -- --once to claim and complete this job.",
  }, null, 2));
}

function assertHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error("--url must be a valid http:// or https:// URL.");
  }
}

export function parseArgs(args) {
  const parsed = { useDefaults: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--use-defaults") { parsed.useDefaults = true; continue; }
    const match = argument.match(/^--(url|reward|job-id)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${argument}. Expected --url, --reward, --job-id, or --use-defaults.`);
    const value = match[2] ?? args[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${match[1]} requires a value.`);
    const key = match[1] === "job-id" ? "jobId" : match[1];
    parsed[key] = value;
  }
  return parsed;
}

function requiredFlag(value, flag, fallback) {
  if (value) return value;
  if (fallback) return fallback;
  throw new Error(`${flag} is required. Pass it explicitly or use --use-defaults to opt into configured defaults.`);
}
