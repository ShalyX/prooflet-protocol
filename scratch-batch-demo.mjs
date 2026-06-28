const payload = [
  {
    jobId: "batch_demo_valid_001",
    jobType: "link_verification",
    input: { url: "https://httpbin.org/anything/batch-valid" },
    rewardAmount: "0.002",
    proofRequirements: { requiredResultFields: ["status"] }
  },
  {
    jobId: "batch_demo_invalid_001",
    jobType: "link_verification",
    input: { url: "https://httpbin.org/anything/batch-invalid" },
    // Intentionally missing rewardAmount to make it invalid!
    proofRequirements: { requiredResultFields: ["status"] }
  }
];

async function run() {
  const url = "http://127.0.0.1:8787/issuers/useful_waiting_protocol/uploads/validate";
  const apiKey = "uwp_issuer_useful_waiting_protocol_dev";

  console.log("1. Sending batch to /validate (Dry Run)...");
  const valRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      filename: "test_batch.json",
      format: "json",
      content: JSON.stringify(payload)
    })
  });
  
  const valBody = await valRes.json();
  console.log("Validation Response:", JSON.stringify(valBody, null, 2));

  const uploadId = valBody.upload.uploadId;

  console.log("\n2. Confirming with validOnly mode (skipping the invalid row)...");
  const confRes = await fetch(`http://127.0.0.1:8787/issuers/useful_waiting_protocol/uploads/${uploadId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      mode: "validOnly",
      acknowledgeInvalidRows: true
    })
  });

  const confBody = await confRes.json();
  console.log("Confirmation Response:", JSON.stringify(confBody, null, 2));
}

run().catch(console.error);
