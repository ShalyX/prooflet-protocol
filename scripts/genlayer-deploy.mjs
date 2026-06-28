import { TransactionStatus } from "genlayer-js/types";
import { clientFor, config, contractSource } from "./genlayer-common.mjs";
const value = config({ requireContract: false, requireKey: true });
const { client, account } = clientFor(value, true);
const hash = await client.deployContract({ account, code: await contractSource(), args: [] });
console.log(JSON.stringify({ network: value.network, deploymentTxHash: hash, status: "submitted" }, null, 2));
const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED });
console.log(JSON.stringify({ deploymentTxHash: hash, status: receipt.statusName || receipt.status, contractAddress: receipt.contractAddress || receipt.createdContractAddress || null }, null, 2));
