import { UsefulWaitingClient } from "@useful-waiting/sdk-core";

try {
  await main();
} catch (error) {
  console.error(`register-agent: ${error.message}`);
  process.exitCode = 1;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const apiUrl = (process.env.USEFUL_WAITING_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  const agentId = requiredFlag(flags.agentId, "--agent-id", process.env.AGENT_ID);
  const name = requiredFlag(flags.name, "--name", process.env.AGENT_NAME || agentId);
  const payoutAddress = requiredFlag(flags.payoutAddress, "--payout-address", process.env.AGENT_PAYOUT_ADDRESS);
  const capabilities = parseCapabilities(flags.capabilities || process.env.WORKER_CAPABILITIES || "link_verification");
  const client = new UsefulWaitingClient({ baseUrl: apiUrl, timeoutMs: 20000 });

  const health = await client.health();
  if (!health.ok) throw new Error("Prooflet API health check failed.");

  const response = await client.request("/agents/register", {
    method: "POST",
    body: { agentId, name, capabilities, payoutAddress, status: "idle" },
  });

  console.log(JSON.stringify({
    registered: true,
    apiUrl,
    agent: response.body.agent,
    apiKey: response.body.apiKey,
    next: [
      `set USEFUL_WAITING_API_URL=${apiUrl}`,
      `set AGENT_ID=${response.body.agent.agentId}`,
      `set AGENT_API_KEY=${response.body.apiKey}`,
      "npm run agent:link -- --once",
    ],
  }, null, 2));
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const match = argument.match(/^--(agent-id|name|capabilities|payout-address)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${argument}. Expected --agent-id, --name, --capabilities, or --payout-address.`);
    const value = match[2] ?? args[++index];
    if (!value || value.startsWith("--")) throw new Error(`--${match[1]} requires a value.`);
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[key] = value;
  }
  return parsed;
}

function parseCapabilities(value) {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function requiredFlag(value, flag, fallback) {
  if (value) return value;
  if (fallback) return fallback;
  throw new Error(`${flag} is required.`);
}
