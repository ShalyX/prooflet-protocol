import { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { readFileSync } from "fs";

// Parse .env manually to avoid tool truncation issues
const envText = readFileSync(".env", "utf8");
const env = Object.fromEntries(
  envText.split("\n").filter(l => l.includes("=")).map(l => {
    const idx = l.indexOf("=");
    return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
  })
);

const key = env.CIRCLE_API_KEY;
const secret = env.CIRCLE_ENTITY_SECRET;
console.log("API Key:", key?.slice(0,10) + "...");
console.log("Secret:", secret?.slice(0,10) + "...");

const c = new CircleDeveloperControlledWalletsClient({ apiKey: *** entitySecret: secret });

try {
  const tokenResp = await c.getToken();
  console.log("Token response keys:", Object.keys(tokenResp));
  console.log("Full:", JSON.stringify(tokenResp).slice(0,500));
} catch (e) {
  console.log("getToken error:", e.message, e.response?.data ? JSON.stringify(e.response.data).slice(0,300) : "");
}

// Try raw curl-style with the API key as a Bearer token (some Circle endpoints accept this)
try {
  const resp = await fetch("https://api.circle.com/v1/w3s/wallets?pageSize=1", {
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
  });
  const json = await resp.json();
  console.log("\nREST GET /wallets:", resp.status, JSON.stringify(json).slice(0,500));
} catch(e) {
  console.log("\nREST GET error:", e.message);
}

// Try creating with the raw API
try {
  const wsId = "ab0b15e7-370b-508d-87be-dea3fedbc6be"; // Escrow Agent Wallet
  const resp = await fetch("https://api.circle.com/v1/w3s/wallets", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: "test-" + Date.now(),
      walletSetId: wsId,
      count: 1,
      blockchains: ["ARC"],
      metadata: [{ name: "Test wallet" }],
    }),
  });
  const json = await resp.json();
  console.log("\nREST POST status:", resp.status);
  console.log(JSON.stringify(json, null, 2).slice(0,1000));
} catch(e) {
  console.log("\nREST POST error:", e.message);
}