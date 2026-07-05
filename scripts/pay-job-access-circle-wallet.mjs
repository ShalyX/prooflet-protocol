#!/usr/bin/env node
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const env = process.env;
const flags = parseArgs(process.argv.slice(2));
const apiUrl = (flags.apiUrl || env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const jobId = required(flags.jobId || env.JOB_ID, "--job-id");
const agentId = required(flags.agentId || env.AGENT_ID, "--agent-id");
const walletId = required(flags.walletId || env.CIRCLE_AGENT_WALLET_ID, "--wallet-id or CIRCLE_AGENT_WALLET_ID");
const walletAddress = required(flags.walletAddress || env.CIRCLE_AGENT_WALLET_ADDRESS, "--wallet-address or CIRCLE_AGENT_WALLET_ADDRESS");
const maxAmount = BigInt(flags.maxAmountRaw || env.GATEWAY_MAX_AMOUNT_RAW || "1");
const blockchain = flags.blockchain || env.CIRCLE_GATEWAY_SIGN_BLOCKCHAIN || "ARC-TESTNET";
const apiKey = required(env.CIRCLE_API_KEY, "CIRCLE_API_KEY");
const entitySecret = required(env.CIRCLE_ENTITY_SECRET, "CIRCLE_ENTITY_SECRET");

const circle = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
const target = `${apiUrl}/jobs/${encodeURIComponent(jobId)}/gateway-access?agentId=${encodeURIComponent(agentId)}`;
const result = await payWithCircleWallet(target, { walletId, walletAddress, blockchain, maxAmount });
console.log(JSON.stringify({ ok: true, jobId, agentId, walletId, walletAddress, blockchain, target, ...result }, bigintReplacer, 2));

async function payWithCircleWallet(url, { walletId, walletAddress, blockchain, maxAmount }) {
  const initialResponse = await fetch(url, { method: "GET", headers: { "content-type": "application/json" } });
  if (initialResponse.status !== 402) {
    const data = await initialResponse.json().catch(() => ({}));
    if (initialResponse.ok) return { status: initialResponse.status, amount: 0n, formattedAmount: "0", transaction: "", data };
    throw new Error(`Initial request failed with HTTP ${initialResponse.status}: ${JSON.stringify(data)}`);
  }

  const paymentRequiredHeader = initialResponse.headers.get("PAYMENT-REQUIRED");
  if (!paymentRequiredHeader) throw new Error("Missing PAYMENT-REQUIRED header in 402 response.");
  const paymentRequired = JSON.parse(Buffer.from(paymentRequiredHeader, "base64").toString("utf8"));
  const accepts = Array.isArray(paymentRequired.accepts) ? paymentRequired.accepts : [];
  const batchingOption = accepts.find((option) => option?.network === "eip155:5042002" && option?.extra?.name === "GatewayWalletBatched" && option?.extra?.version === "1" && typeof option?.extra?.verifyingContract === "string");
  if (!batchingOption) throw new Error("No Arc Testnet GatewayWalletBatched payment option found in PAYMENT-REQUIRED.");

  const amount = BigInt(batchingOption.amount);
  if (amount > maxAmount) throw new Error(`Payment amount ${amount} raw USDC exceeds max ${maxAmount}.`);

  const signer = createCircleWalletSigner({ walletId, walletAddress, blockchain });
  const scheme = new BatchEvmScheme(signer);
  const x402Version = paymentRequired.x402Version ?? 2;
  const paymentPayload = await scheme.createPaymentPayload(x402Version, batchingOption);
  const paymentHeader = Buffer.from(JSON.stringify({ ...paymentPayload, resource: paymentRequired.resource, accepted: batchingOption }, bigintReplacer)).toString("base64");
  const paidResponse = await fetch(url, { method: "GET", headers: { "content-type": "application/json", "Payment-Signature": paymentHeader } });
  const paymentResponseHeader = paidResponse.headers.get("PAYMENT-RESPONSE");
  const settleResponse = paymentResponseHeader ? JSON.parse(Buffer.from(paymentResponseHeader, "base64").toString("utf8")) : null;
  const data = await paidResponse.json().catch(() => ({}));
  if (!paidResponse.ok) throw new Error(`Circle-wallet Gateway payment failed with HTTP ${paidResponse.status}: ${JSON.stringify({ data, settleResponse })}`);
  return { status: paidResponse.status, amount, formattedAmount: formatUsdc(amount), transaction: settleResponse?.transaction || data?.payment?.gatewayTransactionId || "", data, settleResponse };
}

function createCircleWalletSigner({ walletId, walletAddress, blockchain }) {
  return {
    address: walletAddress,
    async signTypedData(params) {
      const payload = normalizeTypedData(params);
      const response = await circle.signTypedData({
        walletId,
        data: JSON.stringify(payload, bigintReplacer),
        memo: "Prooflet Gateway x402 job-access fee",
      });
      const signature = response?.data?.signature || response?.signature;
      if (!signature) throw new Error(`Circle signTypedData returned no signature: ${JSON.stringify(response)}`);
      return signature;
    },
  };
}

function normalizeTypedData(params) {
  return {
    domain: params.domain,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...params.types,
    },
    primaryType: params.primaryType,
    message: params.message,
  };
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const match = argument.match(/^--(api-url|job-id|agent-id|wallet-id|wallet-address|blockchain|max-amount-raw)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${argument}.`);
    const value = match[2] ?? args[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${match[1]} requires a value.`);
    parsed[match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return parsed;
}

function formatUsdc(raw) {
  const whole = raw / 1_000_000n;
  const frac = String(raw % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function required(value, label) {
  if (!value) throw new Error(`${label} is required.`);
  return value;
}
