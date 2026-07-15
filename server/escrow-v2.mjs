/**
 * Post-submission development — not part of the original Lepton Agents Hackathon submission.
 * Helpers for ProofletEscrowV2 (Arc Testnet open-marketplace escrow).
 */
import { createHash } from "node:crypto";
import { createPublicClient, http, isAddress, parseUnits, formatUnits, decodeEventLog } from "viem";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_USDC = "0x3600000000000000000000000000000000000000";
const ARC_CHAIN_ID = 5042002;
const DEFAULT_RPC = "https://rpc.testnet.arc.network";

export function jobIdToBytes32(jobId) {
  const hex = createHash("sha256").update(String(jobId)).digest("hex");
  return `0x${hex}`;
}

export function isTxHash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function loadEscrowV2Abi() {
  const abiPath = resolve(__dirname, "..", "contracts", "out", "EscrowV2.abi");
  if (!existsSync(abiPath)) {
    throw new Error("EscrowV2 ABI missing. Run npm run escrow:v2:compile");
  }
  return JSON.parse(readFileSync(abiPath, "utf8"));
}

export function loadEscrowV2Deployment(env = process.env) {
  const envAddress = env.ESCROW_V2_ADDRESS || env.PROOFLET_ESCROW_V2_ADDRESS;
  const artifactPath = resolve(__dirname, "..", "contracts", "deployment-v2.json");
  let artifact = null;
  if (existsSync(artifactPath)) {
    try {
      artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    } catch {
      artifact = null;
    }
  }
  const address = envAddress || artifact?.address || null;
  return {
    address: address && isAddress(address) ? address : null,
    usdc: env.USDC_ADDRESS || env.ARC_USDC_ADDRESS || artifact?.usdc || DEFAULT_USDC,
    operator: env.ESCROW_OPERATOR_ADDRESS || artifact?.operator || null,
    chainId: Number(env.ARC_CHAIN_ID || artifact?.chainId || ARC_CHAIN_ID),
    rpcUrl: env.ARC_RPC_URL || env.ARC_TESTNET_RPC_URL || DEFAULT_RPC,
    network: "Arc Testnet",
    fundingRail: "arc_usdc_escrow_v2",
    artifactPath,
    configured: Boolean(address && isAddress(address)),
  };
}

export function escrowV2Config(env = process.env) {
  const deployment = loadEscrowV2Deployment(env);
  const skipOnchain = env.ESCROW_V2_SKIP_ONCHAIN === "true";
  return {
    ...deployment,
    acceptReportedFunding: env.ESCROW_V2_ACCEPT_REPORTED_FUNDING !== "false",
    // When a contract is configured, require on-chain fund proof unless explicitly skipped (tests).
    requireOnchainVerification: deployment.configured && !skipOnchain,
  };
}

export function createArcPublicClient(env = process.env) {
  const { rpcUrl, chainId } = loadEscrowV2Deployment(env);
  return createPublicClient({
    transport: http(rpcUrl),
    chain: {
      id: chainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
  });
}

/**
 * Verify a fundJob transaction funded the expected job escrow on Arc Testnet.
 * Returns structured evidence; throws Error with .code on failure.
 */
export async function verifyFundJobTransaction({
  txHash,
  jobId,
  expectedAmountUsdc,
  env = process.env,
  publicClient = null,
}) {
  const cfg = loadEscrowV2Deployment(env);
  if (!cfg.configured) {
    const error = new Error("Escrow V2 contract is not configured.");
    error.code = "ESCROW_V2_NOT_CONFIGURED";
    throw error;
  }
  if (!isTxHash(txHash)) {
    const error = new Error("txHash must be a 0x-prefixed 32-byte hex transaction hash.");
    error.code = "INVALID_TX_HASH";
    throw error;
  }

  const client = publicClient || createArcPublicClient(env);
  const abi = loadEscrowV2Abi();
  const jobIdBytes32 = jobIdToBytes32(jobId);
  const expectedAmount = parseUnits(String(expectedAmountUsdc), 6);

  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (!receipt || receipt.status !== "success") {
    const error = new Error("Fund transaction is missing or failed on Arc Testnet.");
    error.code = "FUND_TX_FAILED";
    throw error;
  }
  const to = String(receipt.to || "").toLowerCase();
  if (to !== cfg.address.toLowerCase()) {
    const error = new Error(`Fund transaction target ${receipt.to} is not ProofletEscrowV2 ${cfg.address}.`);
    error.code = "FUND_TX_WRONG_CONTRACT";
    throw error;
  }

  let fundedEvent = null;
  for (const log of receipt.logs || []) {
    if (String(log.address || "").toLowerCase() !== cfg.address.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "JobFunded") {
        fundedEvent = decoded.args;
        break;
      }
    } catch {
      // not our event
    }
  }
  if (!fundedEvent) {
    const error = new Error("Fund transaction did not emit JobFunded from ProofletEscrowV2.");
    error.code = "FUND_EVENT_MISSING";
    throw error;
  }
  if (String(fundedEvent.jobId).toLowerCase() !== jobIdBytes32.toLowerCase()) {
    const error = new Error("Fund transaction JobFunded jobId does not match this protocol job.");
    error.code = "FUND_JOB_MISMATCH";
    throw error;
  }
  if (BigInt(fundedEvent.amount) !== expectedAmount) {
    const error = new Error(
      `Fund amount ${formatUnits(BigInt(fundedEvent.amount), 6)} USDC does not match job reward ${expectedAmountUsdc}.`,
    );
    error.code = "FUND_AMOUNT_MISMATCH";
    throw error;
  }

  const onchain = await client.readContract({
    address: cfg.address,
    abi,
    functionName: "getEscrow",
    args: [jobIdBytes32],
  });
  // struct: jobId, issuer, agent, amount, expiresAt, status, fundedAt — status Funded=1
  const status = Number(onchain.status ?? onchain[5]);
  const amount = BigInt(onchain.amount ?? onchain[3]);
  if (status !== 1) {
    const error = new Error(`On-chain escrow status is ${status}, expected Funded(1).`);
    error.code = "FUND_STATUS_NOT_FUNDED";
    throw error;
  }
  if (amount !== expectedAmount) {
    const error = new Error("On-chain escrow amount does not match job reward.");
    error.code = "FUND_AMOUNT_MISMATCH";
    throw error;
  }

  return {
    ok: true,
    contract: cfg.address,
    txHash,
    jobId,
    jobIdBytes32,
    issuer: fundedEvent.issuer,
    amount: formatUnits(amount, 6),
    amountRaw: amount.toString(),
    expiresAt: Number(fundedEvent.expiresAt),
    blockNumber: Number(receipt.blockNumber),
    explorer: `https://testnet.arcscan.app/tx/${txHash}`,
  };
}

/**
 * Verify an on-chain V2 release and return evidence for protocol ledger updates.
 */
export async function verifyReleaseTransaction({
  txHash,
  jobId,
  expectedAgent = null,
  env = process.env,
  publicClient = null,
}) {
  const cfg = loadEscrowV2Deployment(env);
  if (!cfg.configured) {
    const error = new Error("Escrow V2 contract is not configured.");
    error.code = "ESCROW_V2_NOT_CONFIGURED";
    throw error;
  }
  if (!isTxHash(txHash)) {
    const error = new Error("txHash must be a 0x-prefixed 32-byte hex transaction hash.");
    error.code = "INVALID_TX_HASH";
    throw error;
  }

  const client = publicClient || createArcPublicClient(env);
  const abi = loadEscrowV2Abi();
  const jobIdBytes32 = jobIdToBytes32(jobId);
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (!receipt || receipt.status !== "success") {
    const error = new Error("Release transaction is missing or failed on Arc Testnet.");
    error.code = "RELEASE_TX_FAILED";
    throw error;
  }
  if (String(receipt.to || "").toLowerCase() !== cfg.address.toLowerCase()) {
    const error = new Error(`Release transaction target is not ProofletEscrowV2 ${cfg.address}.`);
    error.code = "RELEASE_TX_WRONG_CONTRACT";
    throw error;
  }

  let releasedEvent = null;
  for (const log of receipt.logs || []) {
    if (String(log.address || "").toLowerCase() !== cfg.address.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Released") {
        releasedEvent = decoded.args;
        break;
      }
    } catch {
      // not our event
    }
  }
  if (!releasedEvent) {
    const error = new Error("Release transaction did not emit Released from ProofletEscrowV2.");
    error.code = "RELEASE_EVENT_MISSING";
    throw error;
  }
  if (String(releasedEvent.jobId).toLowerCase() !== jobIdBytes32.toLowerCase()) {
    const error = new Error("Release event jobId does not match this protocol job.");
    error.code = "RELEASE_JOB_MISMATCH";
    throw error;
  }
  if (expectedAgent && String(releasedEvent.agent).toLowerCase() !== String(expectedAgent).toLowerCase()) {
    const error = new Error("Release event agent does not match expected agent address.");
    error.code = "RELEASE_AGENT_MISMATCH";
    throw error;
  }

  const onchain = await client.readContract({
    address: cfg.address,
    abi,
    functionName: "getEscrow",
    args: [jobIdBytes32],
  });
  const status = Number(onchain.status ?? onchain[5]);
  if (status !== 2) {
    const error = new Error(`On-chain escrow status is ${status}, expected Released(2).`);
    error.code = "RELEASE_STATUS_NOT_RELEASED";
    throw error;
  }

  return {
    ok: true,
    contract: cfg.address,
    txHash,
    jobId,
    jobIdBytes32,
    agent: releasedEvent.agent,
    proofId: releasedEvent.proofId,
    amount: formatUnits(BigInt(releasedEvent.amount), 6),
    blockNumber: Number(receipt.blockNumber),
    explorer: `https://testnet.arcscan.app/tx/${txHash}`,
  };
}
