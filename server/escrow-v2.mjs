/**
 * Post-submission development — not part of the original Lepton Agents Hackathon submission.
 * Helpers for ProofletEscrowV2 (Arc Testnet open-marketplace escrow).
 */
import { createHash } from "node:crypto";
import { isAddress } from "viem";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_USDC = "0x3600000000000000000000000000000000000000";
const ARC_CHAIN_ID = 5042002;

export function jobIdToBytes32(jobId) {
  const hex = createHash("sha256").update(String(jobId)).digest("hex");
  return `0x${hex}`;
}

export function isTxHash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
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
    usdc: env.USDC_ADDRESS || artifact?.usdc || DEFAULT_USDC,
    operator: env.ESCROW_OPERATOR_ADDRESS || artifact?.operator || null,
    chainId: Number(env.ARC_CHAIN_ID || artifact?.chainId || ARC_CHAIN_ID),
    network: "Arc Testnet",
    fundingRail: "arc_usdc_escrow_v2",
    artifactPath,
    configured: Boolean(address && isAddress(address)),
  };
}

export function escrowV2Config(env = process.env) {
  const deployment = loadEscrowV2Deployment(env);
  return {
    ...deployment,
    // API may accept issuer-reported fund receipts even before a deployed address
    // is configured; claimability still requires the protocol funding_status transition.
    acceptReportedFunding: env.ESCROW_V2_ACCEPT_REPORTED_FUNDING !== "false",
  };
}
