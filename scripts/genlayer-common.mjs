import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetBradbury } from "genlayer-js/chains";

export function config({ requireContract = true, requireKey = true } = {}) {
  const mode = process.env.ADJUDICATION_MODE || "manual";
  const network = process.env.GENLAYER_NETWORK || "localnet";
  const chain = { localnet, studionet, "testnet-bradbury": testnetBradbury }[network];
  if (!chain) throw new Error(`Unsupported GENLAYER_NETWORK ${network}.`);
  const contractAddress = process.env.GENLAYER_CONTRACT_ADDRESS;
  const privateKey = process.env.GENLAYER_PRIVATE_KEY;
  const missing = [requireContract && !contractAddress && "GENLAYER_CONTRACT_ADDRESS", requireKey && !privateKey && "GENLAYER_PRIVATE_KEY"].filter(Boolean);
  if (missing.length) throw new Error(`Missing GenLayer configuration: ${missing.join(", ")}.`);
  return { mode, network, chain, contractAddress, privateKey, endpoint: process.env.GENLAYER_RPC_OR_API_URL };
}
export function clientFor(value, write = false) {
  const account = write ? createAccount(value.privateKey) : undefined;
  return { client: createClient({ chain: value.chain, ...(value.endpoint ? { endpoint: value.endpoint } : {}), ...(account ? { account } : {}) }), account };
}
export async function contractSource() { return readFile(resolve("genlayer/contracts/useful_waiting_adjudicator.py"), "utf8"); }
export function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
export async function api(path, method = "GET") {
  const baseUrl = (process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  const key = process.env.ADJUDICATOR_API_KEY;
  if (!key) throw new Error("ADJUDICATOR_API_KEY with explicit genlayer scope is required.");
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${key}` } });
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.code || response.status}: ${body.error || "request failed"}`);
  return body;
}
