import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const __key = process.env.CIRCLE_API_KEY;
const __secret = process.env.CIRCLE_ENTITY_SECRET;
const client = initiateDeveloperControlledWalletsClient({ apiKey: __key, entitySecret: __secret });

async function test() {
  const ws = await client.listWalletSets();
  const wsId = ws.data?.walletSets[0]?.id;
  
  const wres = await client.createWallets({ accountType: "SCA", blockchains: ["ARC-TESTNET"], count: 1, walletSetId: wsId });
  const w = wres.data?.wallets?.[0];
  console.log("Wallet:", w.id, w.address);

  // Request testnet tokens
  await client.requestTestnetTokens({ walletId: w.id, blockchains: ["ARC-TESTNET"] });
  console.log("Requested testnet tokens... Waiting 5s");
  await new Promise(r => setTimeout(r, 5000));

  // Approve
  const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
  const ESCROW_ADDRESS = "0xb3397ce196ebf553b8e951abaf75c18785c7e69a";
  const AMOUNT = "1000000"; // 1 USDC
  
  const abiFunctionSignature = "approve(address,uint256)";
  const abiParameters = [ESCROW_ADDRESS, AMOUNT];
  
  console.log("Creating approve tx...");
  try {
    const r = await client.createContractExecutionTransaction({
      walletId: w.id,
      contractAddress: USDC_ADDRESS,
      abiFunctionSignature,
      abiParameters,
      fee: { type: "level", level: "MEDIUM" }
    });
    console.log("Approve tx:", r.data?.transaction?.id);
  } catch (e) {
    console.error("Approve failed:", e.response?.data || e.message);
  }
}
test().catch(console.error);
