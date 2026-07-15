/**
 * Post-submission: fund Escrow V2 from a Circle developer-controlled issuer wallet.
 * No browser wallet — server uses Circle API with entity secret already on host.
 */
import { parseUnits, formatUnits } from "viem";
import { executeContract, getWalletBalance, getWalletDetails, isCircleConfigured, requestTestnetFunds } from "./circle-wallet.mjs";
import { escrowV2Config, jobIdToBytes32, isTxHash, verifyFundJobTransaction } from "./escrow-v2.mjs";

const USDC = "0x3600000000000000000000000000000000000000";

export async function fundEscrowV2FromCircleWallet({
  db,
  job,
  issuer,
  expiresHours = 72,
  requestFaucet = false,
  env = process.env,
}) {
  if (!isCircleConfigured()) {
    const error = new Error("Circle developer-controlled wallets are not configured on this API.");
    error.code = "CIRCLE_CONFIG_MISSING";
    error.status = 400;
    throw error;
  }
  if (!issuer?.circle_wallet_id) {
    const error = new Error("Issuer has no Circle wallet. Provision wallet first.");
    error.code = "ISSUER_WALLET_MISSING";
    error.status = 400;
    throw error;
  }
  if (job.funding_status !== "awaiting_wallet_funding") {
    const error = new Error("Job is not awaiting wallet funding.");
    error.code = "JOB_NOT_AWAITING_FUNDING";
    error.status = 400;
    throw error;
  }
  if (job.network !== "Arc Testnet") {
    const error = new Error("Circle Escrow V2 funding is Arc Testnet only.");
    error.code = "NETWORK_NOT_SUPPORTED";
    error.status = 400;
    throw error;
  }

  const v2 = escrowV2Config(env);
  if (!v2.configured || !v2.address) {
    const error = new Error("Escrow V2 is not configured (ESCROW_V2_ADDRESS).");
    error.code = "ESCROW_V2_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }

  const amountRaw = parseUnits(String(job.reward_amount), 6);
  const balance = await getWalletBalance(issuer.circle_wallet_id);
  const balanceRaw = parseUnits(String(balance?.amount || "0"), Number(balance?.decimals || 6));
  if (balanceRaw < amountRaw) {
    if (requestFaucet) {
      await requestTestnetFunds(issuer.circle_wallet_id);
    }
    const details = await getWalletDetails(issuer.circle_wallet_id);
    const error = new Error(
      `Issuer Circle wallet has ${balance?.amount || "0"} USDC; need ${job.reward_amount}. Top up ${details?.address || "wallet"} on Arc Testnet.`,
    );
    error.code = "INSUFFICIENT_USDC";
    error.status = 400;
    error.walletAddress = details?.address || null;
    error.balance = balance?.amount || "0";
    error.required = String(job.reward_amount);
    throw error;
  }

  const walletDetails = await getWalletDetails(issuer.circle_wallet_id);
  const jobBytes = jobIdToBytes32(job.job_id);
  const expiresAt = String(Math.floor(Date.now() / 1000) + Math.max(1, Number(expiresHours) || 72) * 3600);

  // 1) approve USDC to escrow
  const approve = await executeContract({
    walletId: issuer.circle_wallet_id,
    contractAddress: USDC,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [v2.address, amountRaw.toString()],
    waitForState: "COMPLETE",
  });

  // 2) fundJob(bytes32,uint256,uint256)
  const fund = await executeContract({
    walletId: issuer.circle_wallet_id,
    contractAddress: v2.address,
    abiFunctionSignature: "fundJob(bytes32,uint256,uint256)",
    abiParameters: [jobBytes, amountRaw.toString(), expiresAt],
    waitForState: "COMPLETE",
  });

  if (!isTxHash(fund.hash)) {
    const error = new Error("Circle fundJob completed without an on-chain transaction hash yet. Retry fund-escrow with the hash when available.");
    error.code = "FUND_TX_HASH_PENDING";
    error.status = 502;
    error.approve = approve;
    error.fund = fund;
    throw error;
  }

  let verification = null;
  if (v2.requireOnchainVerification) {
    verification = await verifyFundJobTransaction({
      txHash: fund.hash,
      jobId: job.job_id,
      expectedAmountUsdc: job.reward_amount,
      env,
    });
  }

  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE jobs
    SET funding_rail = ?,
        funding_status = 'reserved',
        status = 'open',
        escrow_status = 'funded',
        escrow_tx_hash = ?,
        updated_at = ?
    WHERE job_id = ? AND funding_status = 'awaiting_wallet_funding'
  `).run(v2.fundingRail, fund.hash, now, job.job_id);

  const updated = await db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(job.job_id);
  return {
    ok: true,
    escrowVersion: 2,
    network: "Arc Testnet",
    issuerWallet: {
      walletId: issuer.circle_wallet_id,
      address: walletDetails?.address || null,
    },
    approve,
    fund,
    verification,
    amount: formatUnits(amountRaw, 6),
    job: updated,
  };
}
