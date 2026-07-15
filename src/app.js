import "./styles.css";
import { initIssuerWorkbench } from "./issuer-workbench.js";
import { initAgentWorkbench } from "./agent-workbench.js";
import { ARCHIVED_SUBMISSION_EVIDENCE, createReplayState } from "./archive-evidence.js";

const ARCSCAN = "https://testnet.arcscan.app";
const DEFAULT_API_URL = import.meta.env.PROD ? "https://prooflet-api.onrender.com" : "http://127.0.0.1:8787";
const API_URL = window.UWP_API_URL || import.meta.env.VITE_UWP_API_URL || DEFAULT_API_URL;
const TREASURY = {
  issuer: null,
  network: "Arc Testnet",
  asset: "USDC",
  address: null,
  availableBalance: null,
};

// Loading / error state
let appMode = "loading";
let storageDurable = null;
let apiLoading = true;
let apiError = null;
let hydrationVersion = 0;
let replayGeneration = 0;

const REPLAY_AGENTS = [
  { id: "lynx", agentId: "agent_lynx", name: "Link Sentinel", skill: "Verifies stale links and redirect chains", icon: "LK", payoutWallet: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4", status: "idle", earned: 0.084, score: 97 },
  { id: "mira", agentId: "agent_mira", name: "Freshness Clerk", skill: "Checks source recency and cache freshness", icon: "FR", payoutWallet: "0x1DcB045123730e606A88380BCe534332F50332d2", status: "idle", earned: 0.062, score: 94 },
  { id: "byte", agentId: "agent_byte", name: "Context Press", skill: "Compresses long traces into reusable context", icon: "CP", payoutWallet: "0x110997DF4d76895ce37B64Bc2665ba2A8e639b1e", status: "idle", earned: 0.119, score: 99 },
  { id: "vera", agentId: "agent_vera", name: "Label Judge", skill: "Labels low-confidence snippets for eval sets", icon: "LB", payoutWallet: "0xE6cDb25252E0f07AE50560ee6F104d48Cfc33667", status: "idle", earned: 0.041, score: 91 },
];
let agents = [];

const REPLAY_JOBS = [
  { id: "J-1042", type: "link_verify", title: "Verify 12 CCTP docs links", reward: 0.018, issuer: "Prooflet protocol", fundingStatus: "payable", estimate: "22 sec", priority: "high", state: "done", proof: "HTTP 200/301 trace captured", secondsSaved: 22 },
  { id: "J-1043", type: "freshness_check", title: "Refresh Arc fee claim citations", reward: 0.014, issuer: "Prooflet protocol", fundingStatus: "paid", estimate: "18 sec", priority: "med", state: "done", proof: "cache TTL refreshed", secondsSaved: 18 },
  { id: "J-1044", type: "context_compress", title: "Compress 9-agent trace to 1.5K tokens", reward: 0.026, issuer: "Prooflet protocol", fundingStatus: "reserved", estimate: "35 sec", priority: "high", state: "queued" },
  { id: "J-1045", type: "label", title: "Label 20 eval rows for answer quality", reward: 0.011, issuer: "Prooflet protocol", fundingStatus: "reserved", estimate: "26 sec", priority: "low", state: "queued" },
];
let jobs = [];

const REPLAY_LEDGER = [
  {
    id: "0x9b31",
    jobId: "job_0002",
    jobType: "context_compression",
    agentId: "agent_byte",
    agent: "Context Press",
    job: "Compressed research trace",
    amount: 0.024,
    tx: null,
    explorer: null,
    proof: "semantic checksum preserved",
    outcome: "accepted",
    fundingStatus: "paid",
    settlementStatus: "Settled on Arc Testnet",
    input: { traceId: "trace_arc_demo_019", maxTokens: 1500 },
    result: { originalTokens: 9142, compressedTokens: 1478, semanticChecksum: "0x9c24b8f3" },
    secondsSaved: 35,
    proofTimestamp: "2026-06-17T15:00:00Z",
  },
  {
    id: "0x72fa",
    jobId: "job_0001",
    jobType: "link_verification",
    agentId: "agent_lynx",
    agent: "Link Sentinel",
    job: "Verified docs links",
    amount: 0.016,
    tx: null,
    explorer: null,
    proof: "HTTP 200/301 trace captured",
    outcome: "accepted",
    fundingStatus: "paid",
    settlementStatus: "Settled on Arc Testnet",
    input: { url: "https://developers.circle.com/stablecoins" },
    result: { status: 200, responseTimeMs: 183, contentHash: "0x31a9d4e7" },
    secondsSaved: 22,
    proofTimestamp: "2026-06-17T14:58:00Z",
  },
  {
    id: "0xseed",
    jobId: "job_1043",
    jobType: "freshness_check",
    agentId: "agent_mira",
    agent: "Freshness Clerk",
    job: "Refresh Arc fee claim citations",
    amount: 0.014,
    tx: null,
    explorer: null,
    proof: "cache TTL refreshed",
    outcome: "accepted",
    fundingStatus: "paid",
    settlementStatus: "Settled on Arc Testnet",
    input: { sourceUrl: "https://docs.arc.network", maxAgeHours: 24 },
    result: { lastModified: "2026-06-17T13:42:00Z", stale: false, cacheTtlHours: 24 },
    secondsSaved: 18,
    proofTimestamp: "2026-06-17T15:01:00Z",
  },
  {
    id: "0xopen",
    jobId: "job_1042",
    jobType: "link_verification",
    agentId: "agent_lynx",
    agent: "Link Sentinel",
    job: "Verify 12 CCTP docs links",
    amount: 0.018,
    tx: null,
    proof: "HTTP 200/301 trace captured",
    outcome: "accepted",
    fundingStatus: "payable",
    settlementStatus: "Awaiting next Arc Testnet settlement batch",
    input: { url: "https://developers.circle.com/cctp" },
    result: { status: 200, responseTimeMs: 211, contentHash: "0x68b91a2d" },
    secondsSaved: 22,
    proofTimestamp: "2026-06-18T00:05:00Z",
  },
  {
    id: "reject_01",
    jobId: "job_0003",
    jobType: "link_verification",
    agentId: "agent_spare_07",
    agent: "Spare Worker 07",
    job: "Submitted duplicate link proof",
    amount: 0,
    tx: null,
    proof: "duplicate proof rejected",
    outcome: "rejected",
    fundingStatus: "rejected",
    settlementStatus: "Excluded from payout",
    rejectionReason: "Proof reused contentHash from job_0001 without rerunning measurement.",
    input: { url: "https://developers.circle.com/stablecoins" },
    result: { status: "rejected", duplicateOf: "job_0001", contentHash: "0x31a9d4e7" },
    secondsSaved: 0,
    proofTimestamp: "2026-06-17T14:59:00Z",
  },
];
let ledger = [];

const jobTemplates = [
  ["link_verify", "Check redirect drift for partner APIs", 0.012],
  ["freshness_check", "Validate cached market facts older than 24h", 0.017],
  ["context_compress", "Distill failed agent run into reusable memory", 0.022],
  ["label", "Classify ambiguous user intents for evals", 0.009],
  ["link_verify", "Confirm demo README links before submission", 0.015],
];

const jobToAgent = { link_verify: "lynx", freshness_check: "mira", context_compress: "byte", label: "vera" };
let cycle = 1;
let idleCyclesUsed = 0;
let running = false;
let latestBatchPayload = null;
let activeQueueFilter = "priority";
const systemStatus = { api: "Connecting", arc: "Checking", mode: "Unavailable until live state loads", batch: null, payout: 0 };
let eventSeq = 5;
const REPLAY_EVENTS = [
  {
    id: "evt_005",
    kind: "settlement",
    title: "Arc batch settled",
    detail: "Replay settlement completed across three simulated agent wallets",
    meta: "3 tx confirmed",
  },
  {
    id: "evt_004",
    kind: "approved",
    title: "proof paid",
    detail: "Replay proof reached the simulated settled state",
    meta: "paid",
  },
  {
    id: "evt_003",
    kind: "approved",
    title: "proof submitted",
    detail: "job_0001 produced HTTP status, response time, and content hash",
    meta: "link_verification",
  },
  {
    id: "evt_002",
    kind: "rejected",
    title: "duplicate proof rejected",
    detail: "agent_spare_07 reused contentHash from job_0001 without rerunning measurement",
    meta: "no payout",
  },
  {
    id: "evt_001",
    kind: "settlement",
    title: "batch settlement ready",
    detail: "payable proofs aggregate into an Arc Testnet USDC batch",
    meta: "2 approved / 1 rejected",
  },
];
let events = [];

const $ = (selector) => document.querySelector(selector);
const money = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function modeLabel() {
  if (appMode === "live" && storageDurable === true) return "Live · durable path configured";
  if (appMode === "live" && storageDurable === false) return "Live · ephemeral ledger";
  if (appMode === "live") return "Live · durability unknown";
  if (appMode === "unavailable") return "Live state unavailable";
  if (appMode === "replay") return "Replay · browser-only queue simulation";
  return "Loading live ledger";
}

function eventKindClass(kind) { return ["settlement", "proof", "agent", "job"].includes(kind) ? kind : "event"; }
function agentStatusClass(status) { return ["idle", "working", "active", "offline"].includes(status) ? status : "unknown"; }
function proofOutcomeClass(outcome) { return outcome === "accepted" || outcome === "rejected" ? outcome : "pending"; }
function arcscanTxUrl(transactionHash) {
  const normalizedHash = String(transactionHash || "");
  return /^0x[0-9a-f]{64}$/i.test(normalizedHash) ? `${ARCSCAN}/tx/${normalizedHash}` : null;
}
function settlementLink(item) {
  const transactionUrl = arcscanTxUrl(item.tx);
  if (transactionUrl) {
    return `<a href="${transactionUrl}" target="_blank" rel="noreferrer">Paid · Arc Testnet</a>`;
  }
  return `<em>${escapeHtml(proofStatus(item))}</em>`;
}

function setAppMode(mode, { durable = storageDurable } = {}) {
  appMode = mode;
  storageDurable = durable === true ? true : durable === false ? false : null;
  const truthState = document.getElementById("globalTruthState");
  if (truthState) {
    truthState.textContent = modeLabel();
    truthState.dataset.mode = appMode;
  }
  document.body.dataset.appMode = appMode;
  for (const id of ["runCycle", "prepareBatch", "prepareBatchHero", "addJobs"]) {
    const control = document.getElementById(id);
    if (control) control.disabled = appMode !== "replay";
  }
  const replayToggle = document.getElementById("toggleReplay");
  if (replayToggle) replayToggle.textContent = appMode === "replay" ? "Exit replay" : "Enter replay";
}

function clearLiveState() {
  agents.splice(0, agents.length);
  jobs = [];
  ledger = [];
  events = [];
  latestBatchPayload = null;
  systemStatus.api = "Unavailable";
  systemStatus.arc = "Unavailable";
  systemStatus.mode = "Unavailable";
  systemStatus.batch = null;
  systemStatus.payout = 0;
  TREASURY.issuer = null;
  TREASURY.address = null;
  TREASURY.availableBalance = null;
}

function enterReplayMode() {
  hydrationVersion += 1;
  replayGeneration += 1;
  running = false;
  const replay = createReplayState();
  agents.splice(0, agents.length, ...replay.agents);
  jobs = replay.jobs;
  ledger = replay.ledger;
  events = replay.events;
  setAppMode("replay", { durable: false });
  apiLoading = false;
  apiError = null;
  renderLeaderboardUnavailable();
  render();
}

function renderArchiveEvidence() {
  const container = document.getElementById("archiveEvidence");
  if (!container) return;
  const evidence = ARCHIVED_SUBMISSION_EVIDENCE;
  container.innerHTML = `<header><span>${escapeHtml(evidence.label)}</span><strong>Committed on ${escapeHtml(evidence.network)}</strong></header>
    <div><span>Batch</span><code>${escapeHtml(evidence.batchId)}</code></div>
    <div><span>Total paid</span><strong>${escapeHtml(evidence.totalPayout)}</strong></div>
    <div><span>Source commit</span><code>${escapeHtml(evidence.sourceCommit.slice(0, 12))}</code></div>
    <ul>${evidence.receipts.map((receipt) => `<li><span>${escapeHtml(receipt.agentId)}</span><a href="${ARCSCAN}/tx/${receipt.hash}" target="_blank" rel="noreferrer">block ${escapeHtml(receipt.blockNumber)}</a></li>`).join("")}</ul>`;
}

function render() {
  // Show loading/error indicators
  const loadingEl = document.getElementById("loadingIndicator");
  const errorEl = document.getElementById("apiErrorBanner");
  if (loadingEl) loadingEl.hidden = !apiLoading;
  if (errorEl) errorEl.hidden = !apiError;
  if (errorEl) errorEl.textContent = apiError || "";
  // Update connection badge in nav
  document.querySelectorAll(".api-badge").forEach((el) => {
    el.textContent = modeLabel();
    el.className = `api-badge ${appMode}`;
  });

  const queued = jobs.filter((job) => job.state === "queued");
  const active = jobs.filter((job) => job.state === "running");
  const completed = jobs.filter((job) => job.state === "done");
  const acceptedProofs = ledger.filter((item) => item.outcome === "accepted");
  const payableProofs = acceptedProofs.filter((item) => item.fundingStatus === "payable");
  const paidProofs = acceptedProofs.filter((item) => item.fundingStatus === "paid");
  const rejectedProofs = ledger.filter((item) => item.outcome === "rejected");
  const settled = paidProofs.reduce((sum, item) => sum + item.amount, 0);
  const reservedRewards = jobs.filter((job) => job.fundingStatus === "reserved").reduce((sum, item) => sum + item.reward, 0);
  const pendingPayout = payableProofs.reduce((sum, item) => sum + item.amount, 0);
  const batch = buildSettlementBatch();
  const openJobs = jobs.filter((job) => ["queued", "open"].includes(job.state));
  const actionProofs = [...payableProofs, ...rejectedProofs].slice(0, 4);

  $("#cyclesMetric").textContent = idleCyclesUsed;
  $("#activeMetric").textContent = `${active.length} active`;
  $("#proofsMetric").textContent = ledger.length;
  $("#pendingMetricMain").textContent = `${money(pendingPayout)} USDC`;
  $("#earnedMetric").textContent = `${money(settled)} USDC`;
  $("#arcMetric").textContent = paidProofs.length;
  $("#rejectedMetricMain").textContent = rejectedProofs.length;
  $("#needsActionCount").textContent = payableProofs.length;
  $("#needsActionCopy").textContent = payableProofs.length
    ? `${money(pendingPayout)} Arc Testnet USDC is approved and waiting for operator release.`
    : "No proof packets are waiting for release.";
  $("#opsOpenJobs").textContent = `${openJobs.length} ${openJobs.length === 1 ? "job" : "jobs"}`;
  $("#opsProofQuality").textContent = `${acceptedProofs.length} accepted / ${rejectedProofs.length} rejected`;
  $("#reviewQueueSummary").textContent = `${payableProofs.length} payable · ${rejectedProofs.length} rejected`;
  $("#proofReviewList").innerHTML = actionProofs.length ? actionProofs.map((item) => `
    <article class="proof-review-card ${item.outcome}">
      <div>
        <span>${escapeHtml(item.outcome === "accepted" ? "Payable packet" : "Rejected packet")}</span>
        <strong>${escapeHtml(item.job)}</strong>
        <p>${escapeHtml(item.agent)} · ${escapeHtml(item.jobId)} · ${escapeHtml(item.proof || item.rejectionReason || "Evidence packet recorded")}</p>
      </div>
      <div class="proof-review-status">
        <b>${item.outcome === "accepted" ? `${money(item.amount)} USDC` : "No payout"}</b>
        <small>${escapeHtml(proofStatus(item))}</small>
      </div>
    </article>
  `).join("") : `<div class="queue-empty"><strong>No packets need action</strong><p>Approved proof packets will appear here when they become payable.</p></div>`;
  $("#batchPending").textContent = `${money(batch.totalPayout)} USDC`;
  $("#batchApproved").textContent = batch.approvedProofs;
  $("#batchRejected").textContent = batch.rejectedProofs;
  $("#treasuryNetwork").textContent = TREASURY.network || "Not reported";
  $("#treasuryAsset").textContent = TREASURY.asset || "Not reported";
  $("#treasuryAddress").textContent = TREASURY.address || "Not configured";
  $("#treasuryBalance").textContent = TREASURY.availableBalance || "Not reported by API";
  $("#treasuryReserved").textContent = `${money(reservedRewards)} USDC`;
  $("#treasuryPending").textContent = `${money(pendingPayout)} USDC`;
  $("#treasuryPaid").textContent = `${money(settled)} USDC`;
  $("#treasuryPending").closest("div").classList.toggle("has-payable", pendingPayout > 0);
  $("#systemApi").textContent = systemStatus.api;
  $("#systemArc").textContent = systemStatus.arc;
  $("#systemMode").textContent = systemStatus.mode;
  $("#systemBatch").textContent = systemStatus.batch || "None yet";
  $("#systemPayout").textContent = `${money(systemStatus.payout || 0)} USDC`;
  if (latestBatchPayload) renderPreparedBatch(batch);
  $("#runCycle").disabled = appMode !== "replay" || running || queued.length === 0;

  $("#events").innerHTML = events.map((event) => `
    <article class="event-row ${eventKindClass(event.kind)}">
      <div class="event-dot"></div>
      <div>
        <strong>${escapeHtml(event.title)}</strong>
        <p>${escapeHtml(event.detail)}</p>
      </div>
      <span>${escapeHtml(event.meta)}</span>
    </article>
  `).join("");

  const visibleJobs = filteredJobs(jobs, activeQueueFilter).filter(job => !job.title?.includes("Fixture") && !job.title?.includes("fixture"));
  $("#jobs").innerHTML = visibleJobs.length ? visibleJobs.map((job) => `
    <article class="job ${queueState(job)} ${job.compoundParentId ? 'is-subtask' : ''} ${job.type === 'compound_job' ? 'is-compound' : ''}">
      <div class="job-main">
        <div style="display:flex; gap: 8px; align-items: center;">
          <span class="state-badge ${jobStatus(job).toLowerCase().replace(' ', '-')}">${jobStatus(job)}</span>
          ${job.type === 'compound_job' ? '<span class="state-badge compound-badge">Compound</span>' : ''}
          ${job.compoundParentId ? `<span class="state-badge subtask-badge">↳ Sub-task</span>` : ''}
        </div>
        <h3>${escapeHtml(job.title)}</h3>
        <p>${escapeHtml(job.id)} - ${escapeHtml(job.estimate)} - ${escapeHtml(job.issuer)}${job.proof ? ` - ${escapeHtml(job.proof)}` : ""}</p>
      </div>
      <div class="payout"><strong>${money(job.reward)}</strong><span>USDC</span></div>
    </article>
  `).join("") : `<div class="queue-empty"><strong>No ${queueLabel(activeQueueFilter)} jobs</strong><p>Jobs will appear here when they enter this protocol state.</p></div>`;
  document.querySelectorAll("[data-queue-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.queueFilter === activeQueueFilter);
    const count = filteredJobs(jobs, button.dataset.queueFilter).length;
    button.dataset.count = count;
  });

  const workforceSource = appMode === "live" ? "Source: live API / registered agents" : appMode === "replay" ? "Source: browser-only replay" : "Source: live state unavailable";
  const workforceCount = `${agents.length} registered ${agents.length === 1 ? "agent" : "agents"}`;
  const agentsSource = $("#agentsSource");
  if (agentsSource) agentsSource.textContent = `${workforceSource} · ${workforceCount}`;

  $("#agents").innerHTML = agents.map((agent) => {
    const agentKind = appMode === "replay" ? "Replay agent" : "Registered live agent";
    const walletKind = agent.circleWalletId ? "Circle wallet" : "Manual payout";
    return `
    <article class="agent ${agentStatusClass(agent.status)}">
      <div class="agent-head">
        <div class="agent-icon">${escapeHtml(agent.icon)}</div>
        <span>${escapeHtml(agent.status)}</span>
      </div>
      <div class="agent-badges"><span>${escapeHtml(agentKind)}</span><span>${escapeHtml(walletKind)}</span></div>
      <h3>${escapeHtml(agent.name)}</h3>
      <p>${escapeHtml(agent.skill)}</p>
      <div class="agent-stats"><span>${money(agent.earned)} USDC</span><span>${Math.round(agent.score)} trust</span></div>
      <code>${escapeHtml(agent.payoutWallet || "No payout wallet")}</code>
    </article>`;
  }).join("");

  const visibleLedgerItems = ledger.filter(item => !item.job?.includes("Fixture") && !item.job?.includes("fixture"));
  $("#ledger").innerHTML = visibleLedgerItems.map((item) => `
    <article class="receipt ${proofOutcomeClass(item.outcome)}">
      <div>
        <strong>${escapeHtml(item.agent)}</strong>
        <p>${escapeHtml(item.job)}</p>
        <small>${escapeHtml(item.outcome === "accepted" ? (item.proof || "Awaiting decision") : (item.rejectionReason || "Awaiting decision"))}</small>
        ${item.adjudicationRoute ? `<small>${escapeHtml(adjudicationLabel(item))}</small>` : ""}
      </div>
      <div class="receipt-right">
        <span>${item.outcome === "accepted" ? `${money(item.amount)} USDC` : "No payout"}</span>
        ${settlementLink(item)}
        <a class="proof-link" href="${proofHref(item)}" download="${escapeHtml(item.id)}-proof.json">proof packet</a>
      </div>
    </article>
  `).join("");
}

function prepareBatch() {
  if (appMode !== "replay") return;
  setActionState("#prepareBatch, #prepareBatchHero", "loading", "Preparing…");
  latestBatchPayload = buildSettlementBatch();
  renderPreparedBatch(latestBatchPayload);
  if (latestBatchPayload.approvedProofs === 0) {
    pushEvent("settlement", "empty payout batch", "No approved unpaid proof packets are payable right now; dry-run export would contain zero recipients.", "0 payable");
    render();
    window.setTimeout(() => setActionState("#prepareBatch, #prepareBatchHero", "notice", "No payouts ready"), 260);
    return;
  }
  window.setTimeout(() => setActionState("#prepareBatch, #prepareBatchHero", "success", "Batch ready"), 260);
}

function setActionState(selector, state, label) {
  document.querySelectorAll(selector).forEach((button) => {
    if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
    button.classList.remove("is-loading", "is-success", "is-soft-alert");
    if (state === "loading") {
      button.disabled = true;
      button.classList.add("is-loading");
    } else if (state === "success") {
      button.disabled = appMode !== "replay";
      button.classList.add("is-success");
    } else if (state === "notice") {
      button.disabled = appMode !== "replay";
      button.classList.add("is-soft-alert");
    } else {
      button.disabled = appMode !== "replay";
    }
    if (label) button.textContent = label;
    const resetDelay = state === "success" || state === "notice" ? 1100 : 0;
    if (resetDelay) {
      window.setTimeout(() => {
        button.classList.remove("is-loading", "is-success", "is-soft-alert");
        button.disabled = appMode !== "replay";
        button.textContent = button.dataset.defaultLabel;
      }, resetDelay);
    }
  });
}

function renderPreparedBatch(batch) {
  latestBatchPayload = batch;
  const payloadText = JSON.stringify(batch, null, 2);
  $("#batchPayload").textContent = payloadText;
  $("#batchPayload").classList.add("visible");
  $("#batchDownload").href = `data:application/json;charset=utf-8,${encodeURIComponent(payloadText)}`;
  $("#batchDownload").classList.add("visible");
}

function buildSettlementBatch() {
  const approvedProofs = ledger.filter((item) => item.outcome === "accepted" && item.fundingStatus === "payable");
  const rejectedProofs = ledger.filter((item) => item.outcome === "rejected");
  const recipientsByAgent = approvedProofs.reduce((recipients, proof) => {
    if (!recipients.has(proof.agentId)) {
      recipients.set(proof.agentId, { agentId: proof.agentId, amount: 0 });
    }
    recipients.get(proof.agentId).amount += proof.amount;
    return recipients;
  }, new Map());
  const recipients = [...recipientsByAgent.values()].map((recipient) => ({
    agentId: recipient.agentId,
    amount: money(recipient.amount),
  }));
  const totalPayout = recipients.reduce((sum, recipient) => sum + Number(recipient.amount), 0);

  return {
    batchId: `uwp_arc_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_002`,
    protocol: "Prooflet",
    issuer: TREASURY.issuer,
    network: "Arc Testnet",
    chainId: 5042002,
    asset: "USDC",
    settlementType: "batch",
    approvedProofs: approvedProofs.length,
    rejectedProofs: rejectedProofs.length,
    totalPayout: money(totalPayout),
    recipients,
    proofs: approvedProofs.map((proof) => ({
      proofId: proof.id,
      jobId: proof.jobId,
      agentId: proof.agentId,
      amount: money(proof.amount),
      fundingStatus: proof.fundingStatus,
      settlementStatus: proof.settlementStatus,
      replayOnly: true,
    })),
  };
}

function addJobs() {
  if (appMode !== "replay") return;
  const next = Array.from({ length: 3 }, (_, index) => {
    const template = jobTemplates[(cycle + index) % jobTemplates.length];
    return {
      id: `J-${1046 + cycle * 3 + index}`,
      type: template[0],
      title: template[1],
      reward: template[2],
      issuer: "useful_waiting_protocol",
      fundingStatus: "reserved",
      estimate: `${16 + index * 7} sec`,
      priority: index === 0 ? "high" : index === 1 ? "med" : "low",
      state: "queued",
    };
  });
  cycle += 1;
  jobs = [...next, ...jobs];
  render();
}

function runCycle() {
  if (appMode !== "replay") return;
  const nextJob = jobs.find((job) => job.state === "queued");
  if (running) return;
  if (!nextJob) {
    setActionState("#runCycle", "notice", "No queued jobs");
    return;
  }
  const agent = agents.find((item) => item.id === jobToAgent[nextJob.type]);
  const expectedGeneration = replayGeneration;
  setActionState("#runCycle", "loading", "Cycling worker…");
  idleCyclesUsed += 1;
  pushEvent("claim", "agent claimed job", `${agent.name} claimed ${nextJob.id}: ${nextJob.title}`, `${money(nextJob.reward)} USDC`);
  nextJob.state = "running";
  nextJob.agentId = agent.id;
  agent.status = "working";
  running = true;
  render();
  window.setTimeout(() => {
    if (appMode !== "replay" || expectedGeneration !== replayGeneration) return;
    pushEvent("measure", "measurement completed", measurementCopy(nextJob), nextJob.type);
    render();
  }, 320);
  window.setTimeout(() => {
    if (appMode !== "replay" || expectedGeneration !== replayGeneration) return;
    pushEvent("proof", "proof generated", proofFor(nextJob.type), "packet ready");
    render();
  }, 640);
  window.setTimeout(() => completeCycle(nextJob, agent, expectedGeneration), 980);
}

function completeCycle(job, agent, expectedGeneration = replayGeneration) {
  if (appMode !== "replay" || expectedGeneration !== replayGeneration) {
    running = false;
    return;
  }
  const fakeHash = `0x${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  job.state = "done";
  job.proof = proofFor(job.type);
  job.fundingStatus = "payable";
  job.secondsSaved = secondsFromEstimate(job.estimate);
  const proofRecord = proofRecordForJob(job, agent, fakeHash);
  agent.status = "idle";
  agent.earned += job.reward;
  agent.score = Math.min(100, agent.score + 0.2);
  ledger = [proofRecord, ...ledger];
  pushEvent("approved", "proof became payable", `${proofRecord.agentId} has ${money(proofRecord.amount)} Arc Testnet USDC ready for treasury settlement`, "payable");
  running = false;
  render();
  setActionState("#runCycle", "success", "Cycle complete");
}

function pushEvent(kind, title, detail, meta) {
  eventSeq += 1;
  events = [{ id: `evt_${eventSeq}`, kind, title, detail, meta }, ...events].slice(0, 8);
}

function proofRecordForJob(job, agent, tx) {
  const proofData = proofDataFor(job);
  return {
    id: tx.slice(0, 8),
    jobId: `job_${job.id.toLowerCase().replace("j-", "")}`,
    jobType: proofData.jobType,
    agentId: `agent_${agent.id}`,
    agent: agent.name,
    job: job.title,
    amount: job.reward,
    tx: null,
    proof: job.proof,
    outcome: "accepted",
    fundingStatus: "payable",
    settlementStatus: "Awaiting Arc Testnet settlement",
    input: proofData.input,
    result: proofData.result,
    secondsSaved: job.secondsSaved,
    proofTimestamp: new Date().toISOString(),
  };
}

function proofFor(type) {
  return {
    link_verify: "HTTP 200/301 trace captured",
    freshness_check: "cache TTL refreshed",
    context_compress: "semantic checksum preserved",
    label: "confidence labels attached",
  }[type] || "proof attached";
}

function measurementCopy(job) {
  const copy = {
    link_verify: "HTTP status, redirect trace, response time, and content hash captured",
    freshness_check: "source timestamp checked against max-age policy",
    context_compress: "trace compressed and semantic checksum preserved",
    label: "eval rows labeled with confidence and disagreement flags",
  };
  return copy[job.type] || `measurement completed for ${job.id}`;
}

function proofDataFor(job) {
  const proofData = {
    link_verify: {
      jobType: "link_verification",
      input: { url: "https://developers.circle.com/stablecoins/usdc-contract-addresses" },
      result: { status: 200, responseTimeMs: 183, contentHash: "0x31a9d4e7" },
    },
    freshness_check: {
      jobType: "freshness_check",
      input: { sourceUrl: "https://docs.arc.network", maxAgeHours: 24 },
      result: { lastModified: "2026-06-17T13:42:00Z", stale: false, cacheTtlHours: 24 },
    },
    context_compress: {
      jobType: "context_compression",
      input: { traceId: "trace_idle_cycle_live", maxTokens: 1500 },
      result: { originalTokens: 8840, compressedTokens: 1486, semanticChecksum: "0x7f13ca91" },
    },
    label: {
      jobType: "eval_labeling",
      input: { dataset: "agent_quality_eval_v1", rows: 20 },
      result: { labeledRows: 20, lowConfidenceRows: 3, agreementScore: 0.91 },
    },
  };
  return proofData[job.type] || {
    jobType: "background_micro_work",
    input: { jobId: job.id },
    result: { status: "accepted" },
  };
}

function proofHref(item) {
  const packet = {
    protocol: "Prooflet",
    jobId: item.jobId,
    jobType: item.jobType,
    agentId: item.agentId,
    input: item.input,
    result: item.result,
    verification: {
      outcome: item.outcome,
      proof: item.proof,
      rejectionReason: item.rejectionReason || null,
    },
    reward: {
      amount: money(item.amount),
      asset: "USDC",
      network: "Arc Testnet",
      status: item.fundingStatus,
    },
    settlement: {
      chainId: 5042002,
      tx: item.tx,
      explorer: arcscanTxUrl(item.tx),
    },
    secondsSaved: item.secondsSaved,
    proofTimestamp: item.proofTimestamp,
  };
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(packet, null, 2))}`;
}

function secondsFromEstimate(estimate) {
  return Number.parseInt(estimate, 10) || 0;
}

function formatTime(seconds) {
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes} min` : `${minutes}m ${remainder}s`;
}

async function hydrateFromApi({ force = false } = {}) {
  if (appMode === "replay" && !force) return;
  const requestVersion = ++hydrationVersion;
  setAppMode("loading", { durable: null });
  apiLoading = true;
  apiError = null;
  render();
  try {
    const dashboard = await fetchDashboardWithRetry(requestVersion);
    let health = null;
    try {
      const healthResponse = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) });
      if (healthResponse.ok) health = await healthResponse.json();
    } catch {
      health = null;
    }
    if (requestVersion !== hydrationVersion || appMode === "replay") return;
    clearLiveState();
    applyDashboard(dashboard);
    apiLoading = false;
    apiError = null;
    const reportedDurability = typeof health?.storage?.durable === "boolean" ? health.storage.durable : null;
    setAppMode("live", { durable: reportedDurability });
    $("#apiStatus").textContent = "API connected";
    systemStatus.api = "Connected";
    systemStatus.arc = dashboard.treasury?.network === "Arc Testnet" ? "Connected" : "Unavailable";
    systemStatus.mode = "Dry-run default";
    setLandingText("#landingApi", "Connected");
    render();
    hydrateLeaderboard().catch(() => {});
  } catch (error) {
    if (requestVersion !== hydrationVersion || appMode === "replay") return;
    apiLoading = false;
    apiError = "API unavailable — live state cannot be loaded.";
    clearLiveState();
    setAppMode("unavailable", { durable: null });
    $("#apiStatus").textContent = "Live state unavailable";
    systemStatus.api = "Unavailable";
    systemStatus.arc = "Unavailable";
    setLandingText("#landingApi", "Unavailable");
    setLandingText("#landingLatestPaid", "Unavailable");
    setLandingText("#landingPayable", "Unavailable");
    setLandingText("#landingRejected", "Unavailable");
    setLandingText("#landingTreasury", "Unavailable");
    render();
    renderLeaderboardUnavailable();
  }
}

async function fetchDashboardWithRetry(requestVersion) {
  const attempts = [2500, 8000, 25000];
  let lastError = null;
  for (let index = 0; index < attempts.length; index += 1) {
    if (requestVersion !== hydrationVersion) throw new Error("Dashboard hydration superseded.");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), attempts[index]);
    try {
      if (index > 0) {
        apiError = `Prooflet API is warming up — retry ${index + 1}/${attempts.length}.`;
        render();
      }
      const response = await fetch(`${API_URL}/dashboard`, { signal: controller.signal });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw lastError || new Error("API request failed");
}

function applyDashboard(dashboard) {
  TREASURY.issuer = dashboard.issuer?.issuerId || null;
  TREASURY.address = dashboard.issuer?.treasuryAddress || null;
  TREASURY.network = dashboard.treasury?.network || "Arc Testnet";
  TREASURY.asset = dashboard.treasury?.asset || "USDC";
  TREASURY.availableBalance = null;
  const paidByAgent = dashboard.proofs
    .filter((proof) => proof.fundingStatus === "paid")
    .reduce((totals, proof) => totals.set(proof.agentId, (totals.get(proof.agentId) || 0) + jobReward(dashboard.jobs, proof.jobId)), new Map());

  agents.splice(0, agents.length, ...dashboard.agents.map((agent) => {
    return {
      id: agent.agentId.replace(/^agent_/, ""),
      agentId: agent.agentId,
      name: agent.name,
      skill: capabilityLabel(agent.capabilities),
      icon: agent.name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
      payoutWallet: agent.payoutAddress,
      status: agent.status,
      earned: paidByAgent.get(agent.agentId) || 0,
      score: agent.reputationScore,
      circleWalletId: agent.circleWalletId,
      walletSource: agent.walletSource,
      source: "registered",
    };
  }));

  jobs = dashboard.jobs.map((job) => {
    return {
      id: job.jobId.toUpperCase().replace("JOB_", "J-"),
      type: apiJobType(job.jobType),
      title: jobTitle(job),
      reward: Number(job.rewardAmount),
      issuer: job.issuerId,
      fundingStatus: job.fundingStatus,
      estimate: "API job",
      priority: Number(job.rewardAmount) >= 0.018 ? "high" : Number(job.rewardAmount) >= 0.012 ? "med" : "low",
      state: job.status === "open" ? "queued" : job.status === "claimed" ? "running" : "done",
      proof: null,
      secondsSaved: 0,
      agentId: job.claimedBy,
      compoundParentId: job.compoundParentId,
      fundingRail: job.fundingRail,
      escrowStatus: job.escrowStatus,
    };
  });

  ledger = dashboard.proofs.map((proof) => {
    const agent = dashboard.agents.find((item) => item.agentId === proof.agentId);
    const job = dashboard.jobs.find((item) => item.jobId === proof.jobId);
    return {
      id: proof.proofId,
      jobId: proof.jobId,
      jobType: proof.jobType,
      agentId: proof.agentId,
      agent: agent?.name || proof.agentId,
      job: jobTitle(job),
      amount: Number(job?.rewardAmount || 0),
      tx: proof.txHash,
      explorer: proof.explorer,
      proof: proof.verificationRoute,
      outcome: proof.outcome,
      fundingStatus: proof.fundingStatus,
      settlementStatus: proof.settlementStatus,
      rejectionReason: proof.rejectionReason,
      input: proof.input,
      result: proof.result,
      secondsSaved: 0,
      proofTimestamp: proof.proofTimestamp,
      adjudicationRoute: proof.adjudicationRoute,
      genlayer: proof.genlayer,
    };
  });

  const latestSettled = dashboard.settlements?.batches?.find((batch) => batch.status === "settled");
  const payableTotal = dashboard.proofs.filter((proof) => proof.fundingStatus === "payable").reduce((total, proof) => total + jobReward(dashboard.jobs, proof.jobId), 0);
  const rejectedTotal = dashboard.proofs.filter((proof) => proof.fundingStatus === "rejected").length;
  const reservedRewards = Number(dashboard.treasury?.reservedRewards || 0);
  const pendingPayout = Number(dashboard.treasury?.pendingPayout ?? payableTotal);
  const paidOut = Number(dashboard.treasury?.paidOut || 0);
  setLandingText("#protoTreasuryAddress", TREASURY.address || "Not configured");
  setLandingText("#protoTreasuryBalance", "Unavailable until reported by the API");
  setLandingText("#protoReserved", `${money(reservedRewards)} USDC`);
  setLandingText("#protoPayable", `${money(pendingPayout)} USDC`);
  setLandingText("#protoPaidOut", `${money(paidOut)} USDC`);
  setLandingText("#landingPayable", `${money(payableTotal)} USDC`);
  setLandingText("#landingRejected", rejectedTotal);
  setLandingText("#landingTreasury", dashboard.issuer?.treasuryAddress ? "Configured" : "Not configured");
  systemStatus.batch = latestSettled?.batch_id || null;
  systemStatus.payout = Number(latestSettled?.total_payout || 0);
  renderProtocolBatches(dashboard.settlements?.batches || []);
  events = [];
  events = [{
    id: pendingPayout > 0 ? "evt_live_payout_ready" : "evt_live_empty_batch",
    kind: "settlement",
    title: pendingPayout > 0 ? "payout batch ready" : "no payout batch ready",
    detail: pendingPayout > 0
      ? `${money(pendingPayout)} testnet USDC is approved and awaiting operator-controlled release.`
      : "No approved unpaid proof packets are payable right now; dry-run batch export would be empty.",
    meta: pendingPayout > 0 ? `${dashboard.proofs.filter((proof) => proof.fundingStatus === "payable").length} payable` : "0 payable",
  }];
  if (latestSettled) {
    setLandingText("#landingLatestPaid", `${money(Number(latestSettled.total_payout))} USDC`);
    events = [{
      id: `evt_${latestSettled.batch_id}`,
      kind: "settlement",
      title: "Arc batch settled",
      detail: `${latestSettled.batch_id} paid ${money(Number(latestSettled.total_payout))} testnet USDC`,
      meta: "confirmed",
    }, ...events].slice(0, 8);
  } else {
    setLandingText("#landingLatestPaid", "No live payouts");
  }
}

function renderProtocolBatches(batches) {
  const body = document.getElementById("protocolBatches");
  if (!body) return;
  if (!batches.length) {
    body.innerHTML = '<tr><td colspan="5">No live settlement batches</td></tr>';
    return;
  }
  body.innerHTML = batches.map((batch) => `<tr><td class="mono-data">${escapeHtml(batch.batch_id)}</td><td>${escapeHtml(batch.status)}</td><td>${money(Number(batch.total_payout || 0))} USDC</td><td>Current ledger</td><td>${escapeHtml(batch.network)}</td></tr>`).join("");
}

function setLandingText(selector, value) { const element = document.querySelector(selector); if (element) element.textContent = value; }

function jobStatus(job) {
  if (job.fundingRail === "arc_usdc_escrow") {
    if (job.escrowStatus === "released") return "Released";
    if (job.escrowStatus === "refunded") return "Refunded";
    if (job.escrowStatus === "funded") return "Escrowed";
  }
  if (job.fundingStatus === "paid") return "Paid";
  if (job.fundingStatus === "rejected" || job.state === "rejected") return "Rejected";
  if (job.fundingStatus === "payable") return "Payable";
  if (job.state === "running") return "Claimed";
  return "Reserved";
}

function proofStatus(proof) {
  if (proof.fundingStatus === "paid") return "Paid · Settled on Arc Testnet";
  if (proof.fundingStatus === "payable") return "Payable · Approved, awaiting payout";
  if (proof.fundingStatus === "rejected") return "Rejected · No payout";
  return proof.settlementStatus;
}

function adjudicationLabel(proof) {
  if (proof.adjudicationRoute === "deterministic") return "Adjudication route: Deterministic";
  if (proof.adjudicationRoute === "manual_adapter") return "Adjudication route: Manual Adapter";
  const decision = proof.genlayer?.decision;
  return `Adjudication route: GenLayer · ${proof.genlayer?.status || "pending"}${decision ? ` · ${decision.decision}: ${decision.reason}` : ""}`;
}

function filteredJobs(allJobs, filter) {
  const ordered = [...allJobs].sort((a, b) => queueRank(a) - queueRank(b));
  if (filter === "priority") return ordered.filter((job) => ["open", "payable"].includes(queueState(job)));
  return ordered.filter((job) => queueState(job) === filter);
}

function queueState(job) {
  if (job.fundingStatus === "paid") return "paid";
  if (job.fundingStatus === "rejected" || job.state === "rejected") return "rejected";
  if (job.fundingStatus === "payable") return "payable";
  if (job.state === "running") return "claimed";
  return "open";
}

function queueRank(job) {
  return { open: 0, payable: 1, claimed: 2, paid: 3, rejected: 4 }[queueState(job)] ?? 5;
}

function queueLabel(filter) { return filter === "priority" ? "open or payable" : filter; }

function jobReward(apiJobs, jobId) {
  return Number(apiJobs.find((job) => job.jobId === jobId)?.rewardAmount || 0);
}

function capabilityLabel(capabilities) {
  const labels = {
    link_verification: "Verifies links and redirect chains",
    freshness_check: "Checks source recency and cache freshness",
    context_compression: "Compresses traces into reusable context",
    eval_labeling: "Labels low-confidence evaluation rows",
  };
  return capabilities.map((capability) => labels[capability] || capability.replaceAll("_", " ")).join(" · ");
}

function apiJobType(jobType) {
  return {
    link_verification: "link_verify",
    freshness_check: "freshness_check",
    context_compression: "context_compress",
    eval_labeling: "label",
  }[jobType] || jobType;
}

function jobTitle(job) {
  if (!job) return "Background micro-job";
  if (job.input?.demoFixture) return job.input.demoLabel || "Mock GenLayer demo fixture";
  if (job.jobType === "link_verification") return `Verify ${job.input.url}`;
  if (job.jobType === "freshness_check") return `Check freshness for ${job.input.sourceUrl}`;
  if (job.jobType === "context_compression") return `Compress ${job.input.traceId || "agent trace"}`;
  if (job.jobType === "context_compression_quality") return "Review context compression quality";
  if (job.jobType === "duplicate_proof") return "Rejected duplicate proof";
  return job.jobType.replaceAll("_", " ");
}

$("#addJobs").addEventListener("click", addJobs);
$("#runCycle").addEventListener("click", runCycle);
$("#prepareBatch").addEventListener("click", prepareBatch);
$("#prepareBatchHero").addEventListener("click", prepareBatch);
$("#toggleReplay").addEventListener("click", () => {
  if (appMode === "replay") hydrateFromApi({ force: true }); else enterReplayMode();
});
const agentRegisterForm = document.getElementById("agentRegisterForm");
if (agentRegisterForm) agentRegisterForm.addEventListener("submit", registerAgentWithWallet);
$("#queueTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-queue-filter]");
  if (!button) return;
  activeQueueFilter = button.dataset.queueFilter;
  render();
});
setAppMode("loading", { durable: null });
renderArchiveEvidence();
render();
hydrateFromApi();
const issuerWorkbench = initIssuerWorkbench({ apiUrl: API_URL, onNavigate: navigate });
const agentWorkbench = initAgentWorkbench({ apiUrl: API_URL });

function navigate(path) {
  if (location.pathname !== path) history.pushState({}, "", path);
  renderRoute();
}

function renderRoute() {
  const route = ["/dashboard", "/issuer", "/agents", "/protocol"].includes(location.pathname) ? location.pathname : "/";
  $("#landingRoute").hidden = route !== "/";
  document.querySelectorAll(".protocol-route").forEach((element) => { element.hidden = route === "/"; });
  document.querySelectorAll(".dashboard-surface").forEach((element) => { element.hidden = route !== "/dashboard"; });
  document.querySelectorAll(".agents-surface").forEach((element) => { element.hidden = route !== "/agents"; });
  if ($("#protocolPage")) $("#protocolPage").hidden = route !== "/protocol";
  if (route === "/issuer") issuerWorkbench.show(); else issuerWorkbench.hide();
  if (route === "/agents") agentWorkbench.show(); else agentWorkbench.hide();
  document.querySelectorAll(".page-nav a").forEach((link) => link.classList.toggle("active", link.pathname === route));
  document.title = route === "/" ? "Prooflet" : route === "/issuer" ? "Issuer Workbench · Prooflet" : route === "/agents" ? "Agent Network · Prooflet" : route === "/protocol" ? "Protocol Transparency · Prooflet" : "Protocol Dashboard · Prooflet";
  window.scrollTo({ top: 0, behavior: "instant" });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-route]");
  if (!link || link.origin !== location.origin) return;
  event.preventDefault();
  navigate(link.pathname);
});
window.addEventListener("popstate", renderRoute);
renderRoute();

async function hydrateLeaderboard() {
  if (appMode === "replay") return;
  const requestVersion = hydrationVersion;
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${API_URL}/leaderboard`, { signal: controller.signal });
    window.clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (requestVersion !== hydrationVersion || appMode === "replay") return;
    renderLeaderboard(data.leaderboard || []);
  } catch {
    if (requestVersion !== hydrationVersion || appMode === "replay") return;
    renderLeaderboardUnavailable();
  }
}

function renderLeaderboardUnavailable() {
  const tbody = document.getElementById("leaderboardBody");
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="leaderboard-empty">Leaderboard unavailable</td></tr>';
}

function renderLeaderboard(rows) {
  const tbody = document.getElementById("leaderboardBody");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="leaderboard-empty">No agents found</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((row) => {
    const riskClass = row.riskFlag === "clean" ? "risk-clean" : row.riskFlag === "flagged" ? "risk-flagged" : "risk-blocked";
    const rankIcon = row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : `#${escapeHtml(row.rank)}`;
    return `<tr>
      <td class="leaderboard-rank">${rankIcon}</td>
      <td><strong>${escapeHtml(row.name)}</strong><br><small>${escapeHtml(row.agentId)}</small></td>
      <td class="leaderboard-score">${escapeHtml(row.score ?? "-")}</td>
      <td>${escapeHtml(row.approvedProofs ?? "-")}</td>
      <td>${escapeHtml(row.paidProofs ?? "-")}</td>
      <td class="leaderboard-earned">${escapeHtml(row.settledVolume || "0.000 USDC")}</td>
      <td><span class="risk-badge ${riskClass}">${escapeHtml(row.riskFlag || "clean")}</span></td>
    </tr>`;
  }).join("");
}

async function registerAgentWithWallet(event) {
  event.preventDefault();
  if (appMode === "replay") {
    const result = document.getElementById("agentRegisterResult");
    if (result) {
      result.hidden = false;
      result.dataset.state = "error";
      result.textContent = "Agent registration is disabled in replay mode because it writes to the live API.";
    }
    return;
  }
  const form = event.currentTarget;
  const result = document.getElementById("agentRegisterResult");
  const button = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  const payload = {
    name: String(data.get("name") || "").trim(),
    capabilities: String(data.get("capabilities") || "").split(",").map((item) => item.trim()).filter(Boolean),
  };
  const handle = String(data.get("handle") || "").trim();
  if (handle) payload.handle = handle;
  const payoutAddress = String(data.get("payoutAddress") || "").trim();
  if (payoutAddress) payload.payoutAddress = payoutAddress;
  try {
    button.disabled = true;
    button.textContent = "Registering…";
    result.hidden = false;
    result.dataset.state = "loading";
    result.textContent = "Creating agent identity and requesting Circle wallet provisioning…";
    const response = await fetch(`${API_URL}/agents/register-with-wallet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || body.walletProvisioning?.message || "Agent registration failed");
    result.dataset.state = "ok";
    result.innerHTML = `<strong>Agent registered: ${escapeHtml(body.agent.agentId)}</strong>
      ${body.agent.handle ? `<p>Handle: <code>${escapeHtml(body.agent.handle)}</code></p>` : ""}
      <p>API key: <code>${escapeHtml(body.apiKey)}</code></p>
      <p>Payout wallet: <code>${escapeHtml(body.agent.payoutAddress || "not provisioned")}</code></p>
      <p>Circle wallet: ${escapeHtml(body.circleWallet?.walletId || body.walletProvisioning?.status || "not created")}</p>
      <p class="agent-register-next">Next: connect in <strong>Agent workbench</strong> below (fields prefilled), pay access with <code>npm run gateway:pay-access</code>, then claim. Or run <code>npm run agent:link -- --once</code>.</p>`;
    const sid = document.getElementById("agentSessionId");
    const skey = document.getElementById("agentSessionKey");
    if (sid) sid.value = body.agent.agentId;
    if (skey) skey.value = body.apiKey;
    try {
      sessionStorage.setItem("prooflet.agent.session.v1", JSON.stringify({ agentId: body.agent.agentId, apiKey: body.apiKey }));
    } catch { /* ignore */ }
    await Promise.allSettled([hydrateFromApi(), hydrateLeaderboard()]);
  } catch (error) {
    result.dataset.state = "error";
    result.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Register agent with wallet";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
