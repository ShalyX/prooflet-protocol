import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(path), "utf8");
const app = read("src/app.js");
const landing = read("index.html");
const product = read("app.html");
const html = `${landing}\n${product}`;
const css = read("src/styles.css");
const archive = read("src/archive-evidence.js");

const checks = [];
function check(name, assertion) {
  assertion();
  checks.push(name);
}

check("historical submission values are isolated from live application sources", () => {
  for (const source of [app, html]) {
    assert.doesNotMatch(source, /uwp_arc_20260618_001|0\.054 USDC|4750195[79]|47501962/);
    assert.doesNotMatch(source, /3732ce1d02eebb97|9ad7d702921178fc|3a68ec718ca3390f/);
  }
  assert.match(archive, /uwp_arc_20260618_001/);
  assert.match(archive, /0\.054/);
  assert.match(archive, /298415b1bcca803436812327a07a93e77aadb590/);
  assert.match(archive, /Archived Lepton submission evidence/);
});

check("loading starts with empty live collections and no historical status", () => {
  assert.match(app, /let appMode = "loading"/);
  assert.match(app, /let agents = \[\]/);
  assert.match(app, /let jobs = \[\]/);
  assert.match(app, /let ledger = \[\]/);
  assert.match(app, /let events = \[\]/);
  assert.doesNotMatch(html, />0\.040 USDC<|>2<\/strong><p>settled on Arc Testnet/);
});

check("global state labels distinguish loading, live durability, unavailable, and replay", () => {
  assert.match(app, /Live · durable path configured/);
  assert.match(app, /Live · ephemeral ledger/);
  assert.match(app, /Live · durability unknown/);
  assert.match(app, /Live state unavailable/);
  assert.match(app, /Replay · browser-only queue simulation/);
  assert.doesNotMatch(app, /Live · durable ledger/);
  assert.doesNotMatch(html, /restart-proven durable/);
  assert.match(html, /id="globalTruthState"/);
  assert.match(css, /\.truth-state/);
});

check("empty live dashboards replace every collection and clear historical status", () => {
  assert.match(app, /agents\.splice\(0, agents\.length, \.\.\.dashboard\.agents\.map/);
  assert.match(app, /jobs = dashboard\.jobs\.map/);
  assert.match(app, /ledger = dashboard\.proofs\.map/);
  assert.match(app, /events = \[\]/);
  assert.match(app, /systemStatus\.batch = latestSettled\?\./);
});

check("unavailable mode clears live state instead of substituting fixtures", () => {
  assert.match(app, /function clearLiveState\(/);
  assert.match(app, /setAppMode\("unavailable"/);
  assert.match(app, /clearLiveState\(\)/);
  assert.doesNotMatch(app, /Demo data mode|demo fallback data|Local Demo Data/);
});

check("leaderboard failure is rendered as unavailable", () => {
  assert.doesNotMatch(app, /renderLocalLeaderboard/);
  assert.match(app, /Leaderboard unavailable/);
});

check("synthetic actions are guarded by explicit replay mode", () => {
  assert.match(app, /function enterReplayMode\(/);
  assert.match(app, /if \(appMode !== "replay"\) return/);
  assert.match(app, /hydrationVersion \+= 1/);
  assert.match(app, /replayGeneration \+= 1/);
  assert.match(app, /expectedGeneration !== replayGeneration/);
  assert.match(app, /appMode !== "replay"/);
  assert.match(html, /id="toggleReplay"/);
  assert.match(html, /Browser-only simulation/);
});

check("dashboard hydration does not abort normal Render latency", () => {
  assert.match(app, /const attempts = \[6000, 15000, 30000\]/);
  assert.doesNotMatch(app, /const attempts = \[2500, 8000, 25000\]/);
});

check("agent network is read-only and SDK-first", () => {
  assert.match(html, /Agents register, pay access, claim work, and submit proofs through the API and SDK/);
  assert.doesNotMatch(html, /not this browser/);
  assert.doesNotMatch(app, /Junk test agents are filtered/);
  assert.match(html, /Build an agent/);
  assert.doesNotMatch(html, /id="agentRegisterForm"/);
  assert.doesNotMatch(html, /id="agentWorkbench"/);
  assert.doesNotMatch(app, /register-with-wallet/);
  assert.doesNotMatch(app, /initAgentWorkbench/);
});

check("archive evidence has an explicit dedicated surface", () => {
  assert.match(html, /id="archiveEvidence"/);
  assert.match(html, /Archived Lepton submission/);
  assert.match(app, /renderArchiveEvidence/);
  assert.match(css, /\.archive-evidence/);
});

check("protocol live surface has no static treasury balance or settlement batch", () => {
  assert.match(html, /id="protoTreasuryBalance">Unavailable until reported by the API/);
  assert.match(html, /id="protocolBatches">\s*<tr><td colspan="5">Loading settlement batches/);
  assert.doesNotMatch(html, /1\.761023 USDC/);
});

check("API-supplied dashboard values are escaped and transaction links are allowlisted", () => {
  assert.match(app, /escapeHtml\(event\.title\)/);
  assert.match(app, /escapeHtml\(job\.title\)/);
  assert.match(app, /escapeHtml\(item\.agent\)/);
  assert.match(app, /escapeHtml\(row\.settledVolume/);
  assert.match(app, /\^0x\[0-9a-f\]\{64\}\$/i);
  assert.doesNotMatch(app, /item\.explorer\s*\|\|/);
});

check("landing is pitch-only with two primary CTAs", () => {
  assert.match(landing, /Register as Issuer/);
  assert.match(landing, /Register Agent/);
  assert.match(landing, /src\/landing\.js/);
  assert.doesNotMatch(landing, /Operator release queue|Hosted loop|CLI spine/);
  assert.doesNotMatch(landing, /id="issuerWorkbench"|id="agentWorkbench"/);
});

check("product shell is split from landing god-file", () => {
  assert.match(product, /id="issuerWorkbench"/);
  assert.match(product, /src\/app\.js/);
  assert.ok(landing.length < 12_000, "landing page should stay sparse");
});

console.log(JSON.stringify({ ok: true, checks }, null, 2));
