import { api, arg } from "./genlayer-common.mjs";
const requestId = arg("--request-id");
if (!requestId) throw new Error("Usage: npm run genlayer:poll-decision -- --request-id <request-id>");
const interval = Number(process.env.GENLAYER_POLL_INTERVAL_MS || 5000);
const deadline = Date.now() + Number(process.env.GENLAYER_MAX_WAIT_MS || 120000);
while (true) {
  const value = await api(`/adjudication/genlayer/requests/${encodeURIComponent(requestId)}/sync`, "POST");
  console.log(JSON.stringify(value, null, 2));
  if (["finalized", "failed"].includes(value.request.status)) break;
  if (Date.now() >= deadline) throw new Error("GenLayer decision did not finalize before GENLAYER_MAX_WAIT_MS. Proof remains pending and unpaid.");
  await new Promise((resolve) => setTimeout(resolve, interval));
}
