/**
 * Prooflet — Deploy the ProofletEscrow contract to Arc Testnet.
 *
 * Usage:
 *   node --env-file=.env scripts/deploy-escrow.mjs
 *
 * Requires:
 *   ESCROW_DEPLOYER_PRIVATE_KEY — deployer wallet key
 *   ARC_RPC_URL — Arc Testnet RPC (defaults to https://rpc.testnet.arc.network)
 *   USDC_ADDRESS — USDC on Arc (defaults to 0x3600000000000000000000000000000000000000)
 *   ESCROW_OPERATOR_ADDRESS — initial settlement operator address
 */
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
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
  console.error("Set ESCROW_DEPLOYER_PRIVATE_KEY in .env");
  process.exit(1);
}
if (!OPERATOR_ADDRESS) {
  console.error("Set ESCROW_OPERATOR_ADDRESS in .env (the settlement operator wallet)");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
const BYTECODE_PATH = resolve(__dirname, "..", "contracts", "out", "Escrow.bin");
const ABI_PATH = resolve(__dirname, "..", "contracts", "out", "Escrow.abi");

if (!existsSync(BYTECODE_PATH)) {
  console.error("Bytecode not found. Compile first: solc --bin --abi --optimize -o contracts/out contracts/Escrow.sol");
  process.exit(1);
}

const bytecode = readFileSync(BYTECODE_PATH, "utf-8").trim();
const abi = JSON.parse(readFileSync(ABI_PATH, "utf-8"));

const publicClient = createPublicClient({ transport: http(RPC_URL), chain: { id: CHAIN_ID } });
const walletClient = createWalletClient({ transport: http(RPC_URL), chain: { id: CHAIN_ID }, account });

console.log(`Deploying ProofletEscrow from ${account.address}`);
console.log(`  USDC: ${USDC_ADDRESS}`);
console.log(`  Operator: ${OPERATOR_ADDRESS}`);
console.log(`  RPC: ${RPC_URL}\n`);

const hash = await walletClient.deployContract({
  abi,
  bytecode: `0x${bytecode}`,
  args: [USDC_ADDRESS, OPERATOR_ADDRESS],
});

console.log(`TX sent: ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
const escrowAddress = receipt.contractAddress;

console.log(`\n✅ Deployed!`);
console.log(`  Contract: ${escrowAddress}`);
console.log(`  Block:    ${receipt.blockNumber}`);
console.log(`  Gas used: ${receipt.gasUsed}`);

// Save deployment artifact
const artifact = {
  address: escrowAddress,
  deployTx: hash,
  blockNumber: Number(receipt.blockNumber),
  usdc: USDC_ADDRESS,
  operator: OPERATOR_ADDRESS,
  chainId: CHAIN_ID,
  deployedAt: new Date().toISOString(),
};
const artifactPath = resolve(__dirname, "..", "contracts", "deployment.json");
writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
console.log(`  Artifact:  contracts/deployment.json\n`);

// Print .env update
console.log("Add to .env:");
console.log(`ESCROW_CONTRACT_ADDRESS=${escrowAddress}`);
