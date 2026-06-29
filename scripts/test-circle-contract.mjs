import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const __key = process.env.CIRCLE_API_KEY;
const __secret = process.env.CIRCLE_ENTITY_SECRET;

async function main() {
  const client = initiateDeveloperControlledWalletsClient({ apiKey: __key, entitySecret: __secret });
  console.log("Client created");
  console.log("createContractExecutionTransaction exists:", typeof client.createContractExecutionTransaction === "function");
}
main().catch(console.error);
