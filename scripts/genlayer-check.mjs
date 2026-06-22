import { adjudicationConfig } from "../server/adjudication/genlayer.mjs";
const value = adjudicationConfig();
const configured = Boolean(value.contractAddress && value.privateKey);
console.log(JSON.stringify({ ok: true, mode: value.mode, network: value.network, contractConfigured: Boolean(value.contractAddress), signerConfigured: Boolean(value.privateKey), liveReady: configured }, null, 2));
if (value.mode === "genlayer" && !configured) process.exitCode = 1;
