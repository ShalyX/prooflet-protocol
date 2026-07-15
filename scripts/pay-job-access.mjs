#!/usr/bin/env node
/**
 * Pay Circle Gateway x402 access fee for a job.
 * Surfaces facilitator rejection reasons (e.g. self_transfer).
 *
 * Optional auto-deposit into GatewayWallet when buyer gateway balance is 0:
 *   GATEWAY_AUTO_DEPOSIT=0.01
 */
import { GatewayClient } from "@circle-fin/x402-batching/client";

const flags = parseArgs(process.argv.slice(2));
const apiUrl = (flags.apiUrl || process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const jobId = required(flags.jobId || process.env.JOB_ID, "--job-id");
const agentId = required(flags.agentId || process.env.AGENT_ID, "--agent-id");
const privateKey = required(flags.privateKey || process.env.PRIVATE_KEY || process.env.GATEWAY_PRIVATE_KEY, "--private-key or PRIVATE_KEY");
const chain = flags.chain || process.env.GATEWAY_CHAIN || "arcTestnet";
const maxAmount = flags.maxAmount || process.env.GATEWAY_MAX_AMOUNT || "0.000001";
const autoDeposit = flags.autoDeposit || process.env.GATEWAY_AUTO_DEPOSIT || null;

const client = new GatewayClient({ chain, privateKey });
const buyer = client.account.address;
const target = `${apiUrl}/jobs/${encodeURIComponent(jobId)}/gateway-access?agentId=${encodeURIComponent(agentId)}`;

// Preflight config: seller must differ from buyer or Gateway returns self_transfer.
const config = await fetch(`${apiUrl}/nanopayment/config`).then((r) => r.json()).catch(() => null);
if (config?.sellerAddress && config.sellerAddress.toLowerCase() === buyer.toLowerCase()) {
  throw new Error(
    `self_transfer risk: buyer ${buyer} equals seller ${config.sellerAddress}. ` +
      "Set CIRCLE_GATEWAY_SELLER_ADDRESS to a dedicated fee recipient distinct from agent payout addresses.",
  );
}
if (config?.selfSellerRisk) {
  console.warn(JSON.stringify({ warning: config.selfSellerNote }, null, 2));
}

const balances = await client.getBalances();
if (autoDeposit && balances.gateway.available < 1n) {
  console.log(JSON.stringify({ autoDeposit, gatewayAvailable: balances.gateway.formattedAvailable }, null, 2));
  const dep = await client.deposit(String(autoDeposit));
  console.log(JSON.stringify({
    deposited: true,
    approvalTxHash: dep.approvalTxHash,
    depositTxHash: dep.depositTxHash || dep.txHash,
  }, null, 2));
  await new Promise((r) => setTimeout(r, 4000));
}

const support = await client.supports(target);
if (!support.supported) throw new Error(`Target does not advertise Circle Gateway x402 support: ${target}`);

try {
  const paid = await client.pay(target, { maxAmount });
  console.log(JSON.stringify({
    ok: true,
    jobId,
    agentId,
    buyer,
    seller: config?.sellerAddress || null,
    chain,
    target,
    status: paid.status,
    data: paid.data,
    transaction: paid.transaction,
  }, null, 2));
} catch (error) {
  // Re-probe once to capture facilitator reason body if pay() stripped it.
  const detail = await capturePayFailureDetail(client, target, maxAmount).catch(() => null);
  const reason = detail?.reason || null;
  const message = reason
    ? `Payment failed: ${detail.error || error.message} (${reason})`
    : error.message;
  if (reason === "self_transfer") {
    throw new Error(
      `${message}. Fix: set CIRCLE_GATEWAY_SELLER_ADDRESS != agent payout/payer address.`,
    );
  }
  throw new Error(message);
}

async function capturePayFailureDetail(client, url, maxAmount) {
  // Manual 402 → sign → retry to read JSON body with reason.
  const initial = await fetch(url);
  if (initial.status !== 402) return null;
  const paymentRequiredHeader = initial.headers.get("PAYMENT-REQUIRED") || initial.headers.get("payment-required");
  if (!paymentRequiredHeader) return null;
  const paymentRequired = JSON.parse(Buffer.from(paymentRequiredHeader, "base64").toString("utf-8"));
  const batchingOption = (paymentRequired.accepts || []).find((opt) => opt.extra?.name === "GatewayWalletBatched");
  if (!batchingOption) return null;
  const payload = await client.batchScheme.createPaymentPayload(paymentRequired.x402Version ?? 2, batchingOption);
  const paymentHeader = Buffer.from(JSON.stringify({
    ...payload,
    resource: paymentRequired.resource,
    accepted: batchingOption,
  })).toString("base64");
  const paidResponse = await fetch(url, { headers: { "Payment-Signature": paymentHeader } });
  const body = await paidResponse.json().catch(() => ({}));
  return { status: paidResponse.status, error: body.error, reason: body.reason, body };
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const match = argument.match(/^--(api-url|job-id|agent-id|private-key|chain|max-amount|auto-deposit)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${argument}.`);
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
