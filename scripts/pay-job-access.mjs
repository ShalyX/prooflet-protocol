#!/usr/bin/env node
import { GatewayClient } from "@circle-fin/x402-batching/client";

const flags = parseArgs(process.argv.slice(2));
const apiUrl = (flags.apiUrl || process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const jobId = required(flags.jobId || process.env.JOB_ID, "--job-id");
const agentId = required(flags.agentId || process.env.AGENT_ID, "--agent-id");
const privateKey = required(flags.privateKey || process.env.PRIVATE_KEY || process.env.GATEWAY_PRIVATE_KEY, "--private-key or PRIVATE_KEY");
const chain = flags.chain || process.env.GATEWAY_CHAIN || "arcTestnet";
const maxAmount = flags.maxAmount || process.env.GATEWAY_MAX_AMOUNT || "0.000001";

const client = new GatewayClient({ chain, privateKey });
const target = `${apiUrl}/jobs/${encodeURIComponent(jobId)}/gateway-access?agentId=${encodeURIComponent(agentId)}`;
const support = await client.supports(target);
if (!support.supported) throw new Error(`Target does not advertise Circle Gateway x402 support: ${target}`);
const paid = await client.pay(target, { maxAmount });
console.log(JSON.stringify({ ok: true, jobId, agentId, chain, target, status: paid.status, data: paid.data }, null, 2));

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const match = argument.match(/^--(api-url|job-id|agent-id|private-key|chain|max-amount)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${argument}. Expected --api-url, --job-id, --agent-id, --private-key, --chain, or --max-amount.`);
    const value = match[2] ?? args[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${match[1]} requires a value.`);
    parsed[match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return parsed;
}

function required(value, label) {
  if (!value) throw new Error(`${label} is required.`);
  return value;
}
