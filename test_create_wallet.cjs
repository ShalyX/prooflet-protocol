const { initiateDeveloperControlledWalletsClient } = eval("require")("@circle-fin/developer-controlled-wallets");

const c = initiateDeveloperControlledWalletsClient({
  apiKey: procs...Y,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

async function main() {
  const r = await c.createWallets({
    accountType: "SCA",
    blockchains: ["ARC-TESTNET"],
    count: 1,
    walletSetId: process.env.CIRCLE_WALLET_SET_ID || "f93d6f56-08e6-5225-8bbc-f893750ed6f8",
  });
  const w = r.data?.wallets?.[0];
  if (w) {
    console.log("SUCCESS:", w.id, w.address, w.blockchain);
    process.exit(0);
  }
  console.log("NO_WALLET:", JSON.stringify(r.data).slice(0, 400));
  process.exit(1);
}
main().catch((e) => {
  console.log("ERROR:", e.message);
  if (e.response?.data) console.log("RESP:", JSON.stringify(e.response.data).slice(0, 300));
  process.exit(1);
});