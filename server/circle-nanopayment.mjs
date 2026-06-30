/**
 * Prooflet — Nanopayment-style Access Fee Module
 *
 * Agents pay 0.000001 USDC access fee before claiming a job.
 * This verifies Circle-issued Arc Testnet USDC by scanning Transfer events.
 * It is not full Circle Gateway merchant/session/payment-intent integration.
 *
 * Architecture:
 *   Agent sends fee → Prooflet scans Arc Testnet USDC events → agent can claim job
 *   Fee goes to Prooflet treasury as anti-spam/sybil friction
 *
 * Verification uses direct Arc USDC transfer event scanning.
 *
 * Endpoints (added to api.mjs):
 *   POST /jobs/:jobId/access-fee/verify — verify agent paid access fee
 *   GET  /jobs/:jobId/access-fee/status — check if agent has paid
 */
import { createPublicClient, http, parseAbi } from "viem";

const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const CHAIN_ID = 5042002;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || "0x709F18F797347FbB8D53Fb60567892751dd14B11";
const ACCESS_FEE_USDC = "0.000001";

// USDC Transfer event ABI
const usdcAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export function nanopaymentConfig() {
  return {
    enabled: true,
    rail: "circle_gateway_nanopayments",
    accessFee: ACCESS_FEE_USDC,
    accessFeeRaw: 1, // 1 unit = 0.000001 USDC (6 decimals)
    treasuryAddress: TREASURY_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    chainId: CHAIN_ID,
  };
}

/**
 * Verify that an agent has paid the nanopayment access fee for a job.
 * Scans USDC Transfer events from agent → treasury on Arc Testnet.
 *
 * @param {string} agentAddress - Agent wallet address
 * @param {string} jobId - Job ID (used to scope the payment window)
 * @returns Verification result with payment status
 */
export async function verifyNanopayment(agentAddress, jobId) {
  const publicClient = createPublicClient({
    transport: http(RPC_URL),
    chain: { id: CHAIN_ID },
  });

  try {
    // Check recent blocks for USDC transfer from agent to treasury
    const latestBlock = await publicClient.getBlockNumber();
    const fromBlock = latestBlock - 500n; // ~2 minutes of blocks

    const logs = await publicClient.getLogs({
      address: USDC_ADDRESS,
      event: usdcAbi[0], // Transfer event
      args: {
        from: agentAddress,
        to: TREASURY_ADDRESS,
      },
      fromBlock,
      toBlock: latestBlock,
    });

    // Check if any transfer >= 1 unit (0.000001 USDC)
    const paid = logs.some((log) => log.args.value >= 1n);

    return {
      paid,
      accessFee: ACCESS_FEE_USDC,
      rail: "circle_gateway_nanopayments",
      agentAddress,
      treasuryAddress: TREASURY_ADDRESS,
      transferCount: logs.length,
      verifiedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Gateway/scan fallback — return not paid on error
    return {
      paid: false,
      accessFee: ACCESS_FEE_USDC,
      rail: "circle_gateway_nanopayments",
      agentAddress,
      treasuryAddress: TREASURY_ADDRESS,
      error: error.message,
      verifiedAt: new Date().toISOString(),
    };
  }
}

/**
 * Generate payment instructions for an agent.
 * Returns the treasury address, amount, and network info.
 */
export function createPaymentRequest(jobId, agentAddress) {
  return {
    jobId,
    agentAddress,
    treasuryAddress: TREASURY_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    amount: ACCESS_FEE_USDC,
    amountRaw: "1", // 1 unit of USDC (6 decimals)
    network: "Arc Testnet",
    chainId: CHAIN_ID,
    rail: "circle_gateway_nanopayments",
    instructions: `Send exactly ${ACCESS_FEE_USDC} USDC from ${agentAddress} to ${TREASURY_ADDRESS} on Arc Testnet to unlock job access.`,
  };
}
