import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { startTestApi } from "./test-helpers.mjs";

const test = await startTestApi("create-link-job-check");
const target = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end(`useful-waiting-${randomUUID()}`);
});
target.listen(0, "127.0.0.1");
await new Promise((resolve) => target.once("listening", resolve));

const commonEnv = {
  ...process.env,
  USEFUL_WAITING_API_URL: test.baseUrl,
  ISSUER_ID: "useful_waiting_protocol",
  ISSUER_API_KEY: "uwp_issuer_useful_waiting_protocol_dev",
};

try {
  const exact = await runNode("scripts/create-link-job.mjs", [
    "--url", "https://docs.arc.network",
    "--reward", "0.001",
    "--job-id", "cli_exact_arguments",
  ], commonEnv);
  const exactResult = JSON.parse(exact.stdout);
  assert.equal(exactResult.job.input.url, "https://docs.arc.network");
  assert.equal(exactResult.job.rewardAmount, "0.001");

  const uniqueUrl = `http://127.0.0.1:${target.address().port}/unique-${randomUUID()}`;
  const unique = await runNode("scripts/create-link-job.mjs", [
    "--url", uniqueUrl,
    "--reward", "0.001",
    "--job-id", "cli_unique_worker_job",
  ], commonEnv);
  const uniqueResult = JSON.parse(unique.stdout);
  assert.equal(uniqueResult.job.input.url, uniqueUrl);
  assert.equal(uniqueResult.job.rewardAmount, "0.001");

  await runNode("workers/link-sentinel.mjs", ["--once"], {
    ...commonEnv,
    AGENT_ID: "agent_lynx",
    AGENT_API_KEY: "uwp_agent_lynx_dev",
    WORKER_CAPABILITIES: "link_verification",
  });
  const proof = test.db.prepare("SELECT outcome,funding_status,rejection_reason,input_json FROM proofs WHERE job_id='cli_unique_worker_job'").get();
  assert.equal(proof.outcome, "accepted");
  assert.equal(proof.funding_status, "payable");
  assert.equal(proof.rejection_reason, null);
  assert.equal(JSON.parse(proof.input_json).url, uniqueUrl);

  const duplicateProtection = test.db.prepare("SELECT COUNT(*) AS count FROM proofs WHERE verification_route='duplicate_proof_v0'").get().count;
  assert.ok(duplicateProtection >= 1, "Seeded duplicate-proof rejection must remain intact.");
  console.log(JSON.stringify({
    ok: true,
    exactCliArguments: true,
    sdkAndApiPassThrough: true,
    uniqueUrlProofAccepted: true,
    duplicateProtectionIntact: true,
  }, null, 2));
} finally {
  await new Promise((resolve) => target.close(resolve));
  await test.close();
}

function runNode(script, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", script, ...args], {
      cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve({ stdout: stdout.trim(), stderr: stderr.trim() }) : reject(new Error(`${script} exited ${code}: ${stderr || stdout}`)));
  });
}
