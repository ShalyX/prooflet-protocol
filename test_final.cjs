
const { initiateDeveloperControlledWalletsClient } = eval("require")("@circle-fin/developer-controlled-wallets");
const c = initiateDeveloperControlledWalletsClient({
  apiKey: "TEST_API_KEY:fecd523961f0a7e3328e075a666f0cbf:9b60cdd24affe817c1394ddce51f6dc9",
  entitySecret: "412bdfa40d71f3286c291060d52b39dbba5a1f435dcefbe6f0c9024a21c3bfb0",
});
async function main() {
  const ws = await c.listWalletSets();
  const sets = ws.data?.walletSets || [];
  console.log("Sets:", sets.length, "First:", sets[0]?.id);
  const r = await c.createWallets({ accountType: "SCA", blockchains: ["ARC-TESTNET"], count: 1, walletSetId: sets[0]?.id });
  const w = r.data?.wallets?.[0];
  console.log(w ? "OK:"+w.id+" "+w.address+" "+w.blockchain : "NONE:"+JSON.stringify(r.data).slice(0,300));
}
main().catch(e => console.log("ERR:"+e.message));
