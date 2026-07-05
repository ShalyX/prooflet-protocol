#!/usr/bin/env node
import assert from "node:assert/strict";
import { createPaymentRequest, nanopaymentConfig } from "../server/circle-nanopayment.mjs";

const env = globalThis.process?.env ?? {};
const flags = parseArgs(globalThis.process?.argv?.slice(2) || []);
const apiUrl = (flags.apiUrl || env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");

const config = nanopaymentConfig();
assert.equal(config.enabled, true);
assert.equal(config.rail, "circle_gateway_x402");
assert.equal(config.mode, "gateway_x402_required");
assert.equal(config.accessFee, "0.000001");
assert.equal(config.accessFeeRaw, 1);
assert.equal(config.network, "eip155:5042002");
assert.equal(config.chainId, 5042002);
assert.match(config.usdcAddress, /^0x[0-9a-fA-F]{40}$/);
assert.match(config.sellerAddress, /^0x[0-9a-fA-F]{40}$/);
assert.match(config.treasuryAddress, /^0x[0-9a-fA-F]{40}$/);
assert.equal(config.x402.header, "PAYMENT-SIGNATURE");
assert.equal(config.x402.paymentRequiredHeader, "PAYMENT-REQUIRED");

const sampleJobId = flags.jobId || "nanopayment_check_job";
const sampleAgentAddress = flags.agentAddress || "0x3333333333333333333333333333333333333333";
const paymentRequest = createPaymentRequest(sampleJobId, sampleAgentAddress);
assert.equal(paymentRequest.jobId, sampleJobId);
assert.equal(paymentRequest.agentAddress, sampleAgentAddress);
assert.equal(paymentRequest.amount, config.accessFee);
assert.equal(paymentRequest.amountRaw, String(config.accessFeeRaw));
assert.equal(paymentRequest.caip2Network, config.network);
assert.equal(paymentRequest.rail, config.rail);
assert.equal(paymentRequest.fallbackRail, "arc_usdc_event_scan");

const live = await checkLiveApi({ apiUrl, flags, env }).catch((error) => ({ checked: false, error: error.message }));

console.log(JSON.stringify({
  ok: true,
  config: {
    rail: config.rail,
    mode: config.mode,
    accessFee: config.accessFee,
    accessFeeRaw: config.accessFeeRaw,
    network: config.network,
    chainId: config.chainId,
    sellerAddress: config.sellerAddress,
    treasuryAddress: config.treasuryAddress,
    usdcAddress: config.usdcAddress,
    facilitatorUrl: config.facilitatorUrl,
    fallbackRail: config.fallbackRail,
  },
  paymentRequest: {
    jobId: paymentRequest.jobId,
    amount: paymentRequest.amount,
    amountRaw: paymentRequest.amountRaw,
    gatewayAccessUrl: paymentRequest.gatewayAccessUrl,
    fallbackRail: paymentRequest.fallbackRail,
  },
  live,
}, null, 2));

async function checkLiveApi({ apiUrl, flags, env }) {
  const health = await fetchJson(`${apiUrl}/health`, { timeoutMs: 1500 });
  const remoteConfig = await fetchJson(`${apiUrl}/nanopayment/config`, { timeoutMs: 1500 });
  assert.equal(remoteConfig.rail, config.rail);
  assert.equal(remoteConfig.accessFee, config.accessFee);
  assert.equal(remoteConfig.network, config.network);

  const result = {
    checked: true,
    apiUrl,
    health: `${health.protocol || "Prooflet"} ${health.version || "unknown"}`,
    configMatches: true,
  };

  if (flags.jobId && flags.agentId) {
    const agentKey = flags.agentKey || env.AGENT_API_KEY || null;
    if (!agentKey) {
      result.accessStatus = "skipped_missing_agent_key";
    } else {
      const status = await fetchJson(`${apiUrl}/jobs/${encodeURIComponent(flags.jobId)}/access-fee/status?agentId=${encodeURIComponent(flags.agentId)}`, {
        timeoutMs: 1500,
        headers: { "x-api-key": agentKey },
      });
      result.accessStatus = { paid: Boolean(status.paid), rail: status.config?.rail || remoteConfig.rail };
    }
  }
  return result;
}

async function fetchJson(url, { timeoutMs, headers = {} }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(`${url} returned ${response.status}: ${body.error || text}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const match = argument.match(/^--(api-url|job-id|agent-id|agent-address|agent-key)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${argument}. Expected --api-url, --job-id, --agent-id, --agent-address, or --agent-key.`);
    const value = match[2] ?? args[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${match[1]} requires a value.`);
    parsed[match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return parsed;
}
