/**
 * Deploy ProofletEscrowV2 to Arc Testnet.
 * Post-submission development — not part of the original Lepton Agents Hackathon submission.
 *
 * Usage:
 *   node --env-file=.env scripts/deploy-escrow-v2.mjs
 *
 * Requires:
 *   ESCROW_DEPLOYER_PRIVATE_KEY
 *   ESCROW_OPERATOR_ADDRESS
 * Optional:
 *   ARC_RPC_URL, USDC_ADDRESS
 */
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const CHAIN_ID = 5042002;
const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
const OPERATOR_ADDRESS = process.env.ESCROW_OPERATOR_ADDRESS;
const PRIVATE_KEY = process.env.ESCROW_DEPLOYER_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("Set ESCROW_DEPLOYER_PRIVATE_KEY");
  process.exit(1);
}
if (!OPERATOR_ADDRESS) {
  console.error("Set ESCROW_OPERATOR_ADDRESS");
  process.exit(1);
}

const BYTECODE_PATH = resolve(__dirname, "..", "contracts", "out", "EscrowV2.bin");
const ABI_PATH = resolve(__dirname, "..", "contracts", "out", "EscrowV2.abi");
if (!existsSync(BYTECODE_PATH) || !existsSync(ABI_PATH)) {
  console.error("Compile first: npm run escrow:v2:compile");
  process.exit(1);
}

const bytecode = readFileSync(BYTECODE_PATH, "utf8").trim();
const abi = JSON.parse(readFileSync(ABI_PATH, "utf8"));
const account = privateKeyToAccount(PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);
const chain = { id: CHAIN_ID, name: "Arc Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } };
const publicClient = createPublicClient({ transport: http(RPC_URL), chain });
const walletClient = createWalletClient({ transport: http(RPC_URL), chain, account });

console.log(`Deploying ProofletEscrowV2 from ${account.address}`);
console.log(`  USDC: ${USDC_ADDRESS}`);
console.log(`  Operator: ${OPERATOR_ADDRESS}`);
console.log(`  Network: Arc Testnet (${CHAIN_ID})`);

const hash = await walletClient.deployContract({
  abi,
  bytecode: bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`,
  args: [USDC_ADDRESS, OPERATOR_ADDRESS],
});
console.log(`TX sent: ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const escrowAddress = receipt.contractAddress;
console.log(`Deployed: ${escrowAddress}`);

const artifact = {
  version: 2,
  address: escrowAddress,
  deployTx: hash,
  blockNumber: Number(receipt.blockNumber),
  usdc: USDC_ADDRESS,
  operator: OPERATOR_ADDRESS,
  chainId: CHAIN_ID,
  network: "Arc Testnet",
  deployedAt: new Date().toISOString(),
  note: "Post-submission ProofletEscrowV2 — open marketplace fund-before-agent escrow",
};
const artifactPath = resolve(__dirname, "..", "contracts", "deployment-v2.json");
writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + "\n");
console.log(`Artifact: contracts/deployment-v2.json`);
console.log(`Set ESCROW_V2_ADDRESS=${escrowAddress}`);
