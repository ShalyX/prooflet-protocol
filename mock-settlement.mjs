const issuerId = "useful_waiting_protocol";
const apiKey = "uwp_issuer_useful_waiting_protocol_dev";
const baseUrl = "http://127.0.0.1:8787";

async function api(method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`API error: ${res.status} - ${await res.text()}`);
  return res.json();
}

async function run() {
  console.log("1. Requesting settlement batch export...");
  const exportRes = await api("POST", "/settlement-batches/export", { issuerId });
  const batchId = exportRes.batch.batchId;
  console.log(`Generated batch: ${batchId}`);
  console.log(`Contains ${exportRes.batch.proofs.length} proofs.`);

  if (exportRes.batch.proofs.length === 0) {
    console.log("No payable proofs to settle.");
    return;
  }

  console.log("2. Simulating Arc Testnet Execution...");
  const txHash = "0x" + Array.from({length:64}, () => Math.floor(Math.random()*16).toString(16)).join("");
  const explorerUrl = `https://testnet.arcscan.io/tx/${txHash}`;
  console.log(`Mock Transaction: ${txHash}`);

  console.log("3. Confirming settlement with API...");
  const confirmRes = await api("POST", `/settlement-batches/${batchId}/receipt`, {
    transactions: [{
      txHash,
      explorerUrl,
      gasFeeUsdc: "0.000001",
      network: "Arc Testnet",
      to: exportRes.batch.recipients[0].address,
      amount: "0.001",
      agentId: "agent_lynx"
    }]
  });

  console.log("Settlement confirmed!");
  console.log("Check the Dashboard UI, the jobs should now be marked as Paid!");
}

run().catch(console.error);
