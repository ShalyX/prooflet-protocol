import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, isAddress, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

export const ARC_CHAIN_ID = 5042002;
export const ARC_RPC_URL = process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";
export const ARC_USDC = "0x3600000000000000000000000000000000000000";
export const ARCSCAN = "https://testnet.arcscan.app";

export function makePublicClient() {
  return createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC_URL, { timeout: 10000 }) });
}

export function makeWalletClient(privateKey) {
  const account = privateKeyToAccount(normalizePrivateKey(privateKey));
  return {
    account,
    walletClient: createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC_URL, { timeout: 10000 }) }),
  };
}

export async function assertArcTestnet(publicClient) {
  const chainId = await withTimeout(publicClient.getChainId(), 10000, "Arc RPC chainId request timed out.");
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(`Refusing to continue: expected Arc Testnet chain ${ARC_CHAIN_ID}, got ${chainId}.`);
  }
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function normalizePrivateKey(privateKey) {
  if (!privateKey) throw new Error("Set TREASURY_PRIVATE_KEY in .env.");
  return privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
}

export function normalizeAmount(amount) {
  const raw = parseUnits(String(amount), 6);
  if (raw <= 0n) throw new Error(`Invalid USDC amount: ${amount}`);
  return raw;
}

export function humanUsdc(raw) {
  return formatUnits(raw, 6);
}

export function validateAddress(address, label) {
  if (!isAddress(address)) throw new Error(`Invalid ${label} address: ${address}`);
}

export async function usdcBalance(publicClient, address) {
  validateAddress(address, "wallet");
  return withTimeout(publicClient.readContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  }), 10000, "Arc USDC balance request timed out.");
}

export function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}
