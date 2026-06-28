import { api, arg } from "./genlayer-common.mjs";
const proofId = arg("--proof-id");
if (!proofId) throw new Error("Usage: npm run genlayer:submit-fixture -- --proof-id <pending-proof-id>");
console.log(JSON.stringify(await api(`/adjudication/genlayer/proofs/${encodeURIComponent(proofId)}/submit`, "POST"), null, 2));
