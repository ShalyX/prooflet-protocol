import { createPublicClient, createWalletClient, erc20Abi, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const USDC = "0x3600000000000000000000000000000000000000";
const rpcUrl = process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";
const privateKey = process.env.PRIVATE_KEY;
const workerAddress = process.env.WORKER_ADDRESS;
const amount = process.env.USDC_AMOUNT || "0.01";

if (!privateKey || !workerAddress) {
  throw new Error("Set PRIVATE_KEY and WORKER_ADDRESS in .env before settling on Arc Testnet.");
}

const account = privateKeyToAccount(privateKey);
const transport = http(rpcUrl);
const publicClient = createPublicClient({ chain: arcTestnet, transport });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport });

const chainId = await publicClient.getChainId();
if (chainId !== 5042002) {
  throw new Error(`Refusing to settle: expected Arc Testnet chain 5042002, got ${chainId}.`);
}

const rawAmount = parseUnits(amount, 6);
const balance = await publicClient.readContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
});

if (balance < rawAmount) {
  throw new Error(`Insufficient Arc USDC. Need ${amount}, wallet has ${Number(balance) / 1_000_000}.`);
}

const hash = await walletClient.writeContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "transfer",
  args: [workerAddress, rawAmount],
});

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(JSON.stringify({ hash, blockNumber: receipt.blockNumber.toString(), status: receipt.status }, null, 2));
