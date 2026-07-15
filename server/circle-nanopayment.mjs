/**
 * Prooflet — Circle Gateway / x402 access-fee module
 *
 * Jobs require a 0.000001 USDC access fee before claim. The preferred path is
 * Circle Gateway Nanopayments: x402 returns HTTP 402, the buyer signs an
 * offchain authorization, and Gateway settles the batched USDC payment.
 *
 * A direct Arc Testnet USDC event-scan verifier remains as a compatibility path
 * for existing demos, but user-facing copy should distinguish it from Gateway.
 */
import { createPublicClient, http, parseAbi } from "viem";

const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const CHAIN_ID = 5042002;
const NETWORK = `eip155:${CHAIN_ID}`;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || "0x709F18F797347FbB8D53Fb60567892751dd14B11";
const GATEWAY_API_BASE = process.env.CIRCLE_GATEWAY_API_URL || "https://gateway-api-testnet.circle.com";
const GATEWAY_SELLER_ADDRESS = process.env.CIRCLE_GATEWAY_SELLER_ADDRESS || TREASURY_ADDRESS;
const ACCESS_FEE_USDC = "0.000001";
const ACCESS_FEE_RAW = "1";

const usdcAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

export function nanopaymentConfig() {
  return {
    enabled: true,
    rail: "circle_gateway_x402",
    mode: "gateway_x402_required",
    accessFee: ACCESS_FEE_USDC,
    accessFeeRaw: Number(ACCESS_FEE_RAW),
    sellerAddress: GATEWAY_SELLER_ADDRESS,
    treasuryAddress: TREASURY_ADDRESS,
    facilitatorUrl: GATEWAY_API_BASE,
    usdcAddress: USDC_ADDRESS,
    network: NETWORK,
    chainId: CHAIN_ID,
    x402: {
      version: 2,
      resourceTemplate: "/jobs/:jobId/gateway-access",
      header: "PAYMENT-SIGNATURE",
      paymentRequiredHeader: "PAYMENT-REQUIRED",
    },
    fallbackRail: "arc_usdc_event_scan",
  };
}

export function createPaymentRequest(jobId, agentAddress) {
  return {
    jobId,
    agentAddress,
    sellerAddress: GATEWAY_SELLER_ADDRESS,
    treasuryAddress: TREASURY_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    amount: ACCESS_FEE_USDC,
    amountRaw: ACCESS_FEE_RAW,
    network: "Arc Testnet",
    caip2Network: NETWORK,
    chainId: CHAIN_ID,
    rail: "circle_gateway_x402",
    gatewayAccessUrl: `/jobs/${encodeURIComponent(jobId)}/gateway-access?agentId=<agentId>`,
    fallbackRail: "arc_usdc_event_scan",
    instructions: `Preferred: pay the x402 Gateway endpoint for this job. Fallback: send exactly ${ACCESS_FEE_USDC} USDC from ${agentAddress} to ${TREASURY_ADDRESS} on Arc Testnet, then verify the transfer.`,
  };
}

export function gatewayPrice() {
  return `$${ACCESS_FEE_USDC}`;
}

export function gatewayConfig() {
  return {
    sellerAddress: GATEWAY_SELLER_ADDRESS,
    facilitatorUrl: GATEWAY_API_BASE,
    networks: [NETWORK],
    description: "Prooflet job access fee",
  };
}

export async function recordAccessPayment(db, { jobId, agentId, rail, amount = ACCESS_FEE_USDC, payerAddress = null, txHash = null, gatewayTransactionId = null, network = NETWORK, metadata = {} }) {
  const now = new Date().toISOString();
  await Promise.resolve(db.prepare(`
    INSERT INTO job_access_payments
      (job_id, agent_id, rail, amount, payer_address, tx_hash, gateway_transaction_id, network, status, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?)
    ON CONFLICT(job_id, agent_id) DO UPDATE SET
      rail=excluded.rail,
      amount=excluded.amount,
      payer_address=COALESCE(excluded.payer_address, job_access_payments.payer_address),
      tx_hash=COALESCE(excluded.tx_hash, job_access_payments.tx_hash),
      gateway_transaction_id=COALESCE(excluded.gateway_transaction_id, job_access_payments.gateway_transaction_id),
      network=excluded.network,
      status='paid',
      metadata_json=excluded.metadata_json,
      updated_at=excluded.updated_at
  `).run(jobId, agentId, rail, amount, payerAddress, txHash, gatewayTransactionId, network, JSON.stringify(metadata), now, now));
  return getAccessPayment(db, jobId, agentId);
}

export async function getAccessPayment(db, jobId, agentId) {
  return (await Promise.resolve(db.prepare("SELECT * FROM job_access_payments WHERE job_id=? AND agent_id=?").get(jobId, agentId))) || null;
}

export async function hasPaidAccess(db, jobId, agentId) {
  return !!(await Promise.resolve(db.prepare("SELECT 1 FROM job_access_payments WHERE job_id=? AND agent_id=? AND status='paid'").get(jobId, agentId)));
}

export function serializeAccessPayment(row) {
  if (!row) return null;
  return {
    jobId: row.job_id,
    agentId: row.agent_id,
    rail: row.rail,
    amount: row.amount,
    payerAddress: row.payer_address,
    txHash: row.tx_hash,
    gatewayTransactionId: row.gateway_transaction_id,
    network: row.network,
    status: row.status,
    metadata: JSON.parse(row.metadata_json || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function verifyNanopayment(agentAddress, jobId) {
  const publicClient = createPublicClient({ transport: http(RPC_URL), chain: { id: CHAIN_ID } });
  try {
    const latestBlock = await publicClient.getBlockNumber();
    const fromBlock = latestBlock > 500n ? latestBlock - 500n : 0n;
    const logs = await publicClient.getLogs({
      address: USDC_ADDRESS,
      event: usdcAbi[0],
      args: { from: agentAddress, to: TREASURY_ADDRESS },
      fromBlock,
      toBlock: latestBlock,
    });
    const paidLog = logs.find((log) => log.args.value >= 1n);
    return {
      paid: !!paidLog,
      accessFee: ACCESS_FEE_USDC,
      rail: "arc_usdc_event_scan",
      agentAddress,
      treasuryAddress: TREASURY_ADDRESS,
      transferCount: logs.length,
      txHash: paidLog?.transactionHash || null,
      verifiedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      paid: false,
      accessFee: ACCESS_FEE_USDC,
      rail: "arc_usdc_event_scan",
      agentAddress,
      treasuryAddress: TREASURY_ADDRESS,
      error: error.message,
      verifiedAt: new Date().toISOString(),
    };
  }
}
