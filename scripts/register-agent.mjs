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
  const handle = flags.agentHandle || flags.agentId || process.env.AGENT_HANDLE || process.env.AGENT_ID || null;
  const name = requiredFlag(flags.name, "--name", process.env.AGENT_NAME || handle || "Prooflet Agent");
  const payoutAddress = flags.payoutAddress || process.env.AGENT_PAYOUT_ADDRESS;
  const capabilities = parseCapabilities(flags.capabilities || process.env.WORKER_CAPABILITIES || "link_verification");
  const client = new UsefulWaitingClient({ baseUrl: apiUrl, timeoutMs: 20000 });

  const health = await client.health();
  if (!health.ok) throw new Error("Prooflet API health check failed.");

  const response = await client.request("/agents/register-with-wallet", {
    method: "POST",
    body: { ...(handle ? { handle } : {}), name, capabilities, ...(payoutAddress ? { payoutAddress } : {}), status: "idle" },
  });

  let nanopaymentConfig = { enabled: false };
  try {
    const cfgResponse = await client.request("/nanopayment/config", { method: "GET" });
    if (cfgResponse.body?.enabled) nanopaymentConfig = cfgResponse.body;
  } catch (e) {
    // ignore
  }

  const body = response.body;
  const issuedApiKey = body["apiKey"];
  const resultLog = {
    registered: true,
    apiUrl,
    agent: body.agent,
    apiKey: issuedApiKey,
  };

  if (body.circleWallet) {
    resultLog.circleWallet = body.circleWallet;
  }

  if (nanopaymentConfig.enabled) {
    resultLog.actionRequired = "GATEWAY_X402_ACCESS_FEE";
    resultLog.instructions = `Claims require a ${nanopaymentConfig.accessFee} USDC Circle Gateway x402 access payment per job before leasing work.`;
    resultLog.paymentDetails = {
      network: "Arc Testnet",
      asset: "USDC",
      amount: nanopaymentConfig.accessFee,
      gatewayAccessUrl: nanopaymentConfig.x402?.resourceTemplate,
      sellerAddress: nanopaymentConfig.sellerAddress,
      fallbackTreasuryAddress: nanopaymentConfig.treasuryAddress
    };
  }

  resultLog.windowsCmd = `npm run agent:link -- --once --api-url ${apiUrl} --agent-id ${body.agent.agentId} --agent-api-key ${issuedApiKey}`;
  resultLog.windowsEnvNote = "In cmd.exe, run each set command on its own line. Do not combine set AGENT_ID and set AGENT_API_KEY on one line.";
  resultLog.next = [
    `set USEFUL_WAITING_API_URL=${apiUrl}`,
    `set AGENT_ID=${body.agent.agentId}`,
    `set AGENT_API_KEY=${issuedApiKey}`,
    "npm run agent:link -- --once",
  ];

  console.log(JSON.stringify(resultLog, null, 2));
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const match = argument.match(/^--(agent-handle|agent-id|name|capabilities|payout-address)(?:=(.*))?$/);
    if (!match) throw new Error(`Unknown argument ${argument}. Expected --agent-handle, --agent-id, --name, --capabilities, or --payout-address.`);
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
