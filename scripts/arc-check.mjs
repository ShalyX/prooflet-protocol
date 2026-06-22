import { ARC_CHAIN_ID, ARC_RPC_URL, ARC_USDC, assertArcTestnet, humanUsdc, makePublicClient, makeWalletClient, usdcBalance } from "./arc-common.mjs";

const privateKey = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY;
const publicClient = makePublicClient();
await assertArcTestnet(publicClient);

const result = {
  network: "Arc Testnet",
  chainId: ARC_CHAIN_ID,
  rpcUrl: ARC_RPC_URL,
  usdc: ARC_USDC,
};

if (privateKey) {
  const { account } = makeWalletClient(privateKey);
  const balance = await usdcBalance(publicClient, account.address);
  result.treasury = account.address;
  result.usdcBalance = humanUsdc(balance);
} else {
  result.treasury = null;
  result.usdcBalance = null;
  result.note = "Set TREASURY_PRIVATE_KEY to include treasury balance.";
}

console.log(JSON.stringify(result, null, 2));
