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

// Live collections start empty — only API hydrate or explicit replay fills them.
let agents = [];
let jobs = [];
let ledger = [];

// Replay-only job templates (used exclusively when appMode === "replay").
const jobTemplates = [
  ["link_verify", "Check redirect drift for partner APIs", 0.012],
  ["freshness_check", "Validate cached market facts older than 24h", 0.017],
  ["context_compress", "Distill failed agent run into reusable memory", 0.022],
  ["label", "Classify ambiguous user intents for evals", 0.009],
  ["link_verify", "Confirm documentation links", 0.015],
];

const jobToAgent = { link_verify: "lynx", freshness_check: "mira", context_compress: "byte", label: "vera" };
let cycle = 1;
let idleCyclesUsed = 0;
let running = false;
let latestBatchPayload = null;
let activeQueueFilter = "priority";
const systemStatus = { api: "Connecting", arc: "Checking", mode: "Unavailable until live state loads", batch: null, payout: 0 };
let eventSeq = 1;
let events = [];

const $ = (selector) => document.querySelector(selector);
const money = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const setText = (selector, value) => {
  const el = $(selector);
  if (el) el.textContent = value;
};

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
  const isReplay = appMode === "replay";
  for (const id of ["runCycle", "prepareBatch", "addJobs"]) {
    const control = document.getElementById(id);
    if (control) {
      control.hidden = !isReplay;
      control.disabled = !isReplay;
    }
  }
  const replayNote = document.getElementById("replayNote");
  if (replayNote) replayNote.hidden = !isReplay;
  const replayToggle = document.getElementById("toggleReplay");
  if (replayToggle) replayToggle.textContent = isReplay ? "Exit simulate" : "Simulate";
  const batchDl = document.getElementById("batchDownload");
  const batchPre = document.getElementById("batchPayload");
  if (!isReplay) {
    if (batchDl) {
      batchDl.hidden = true;
      batchDl.removeAttribute("href");
    }
    if (batchPre) {
      batchPre.hidden = true;
      batchPre.textContent = "";
    }
  }
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
  const ok = window.confirm(
    "Simulation replaces the live ledger with browser-only data. Live data returns when you exit. Continue?",
  );
  if (!ok) return;
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
  const toggle = document.getElementById("toggleReplay");
  if (toggle) toggle.textContent = "Exit simulate";
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
  const openJobs = jobs.filter((job) => queueState(job) === "open");

  if (appMode === "replay") {
    setText("#cyclesMetricLabel", "Worker cycles");
    setText("#cyclesMetric", idleCyclesUsed);
    setText("#activeMetric", `${active.length} active`);
    setText("#proofsMetricNote", "replay simulation");
  } else {
    setText("#cyclesMetricLabel", "Open jobs");
    setText("#cyclesMetric", openJobs.length);
    setText("#activeMetric", `${active.length} claimed`);
    setText("#proofsMetricNote", "current live ledger");
  }
  setText("#proofsMetric", ledger.length);
  setText("#pendingMetricMain", `${money(pendingPayout)} USDC`);
  setText("#earnedMetric", `${money(settled)} USDC`);
  setText("#arcMetric", paidProofs.length);
  setText("#rejectedMetricMain", rejectedProofs.length);
  setText("#systemApi", systemStatus.api);
  setText("#systemArc", systemStatus.arc);
  setText("#systemMode", systemStatus.mode || "Operator host");
  setText("#systemBatch", systemStatus.batch || "—");
  setText(
    "#systemPayout",
    systemStatus.payout > 0 ? `${money(systemStatus.payout)} USDC` : "—",
  );
  if (latestBatchPayload) renderPreparedBatch(batch);
  const runCycleBtn = $("#runCycle");
  if (runCycleBtn) runCycleBtn.disabled = appMode !== "replay" || running || queued.length === 0;

  const eventsEl = $("#events");
  if (eventsEl) {
    eventsEl.innerHTML = events.length
      ? events.map((event) => `
    <article class="event-row ${eventKindClass(event.kind)}">
      <div class="event-dot"></div>
      <div>
        <strong>${escapeHtml(event.title)}</strong>
        <p>${escapeHtml(event.detail)}</p>
      </div>
      <span>${escapeHtml(event.meta)}</span>
    </article>
  `).join("")
      : `<div class="empty-state"><strong>No live events yet</strong><p>Claims, proofs, and releases will show up here as they happen.</p></div>`;
  }

  const visibleJobs = filteredJobs(jobs, activeQueueFilter).filter(job => !job.title?.includes("Fixture") && !job.title?.includes("fixture"));
  const jobsEl = $("#jobs");
  if (jobsEl) {
    jobsEl.innerHTML = visibleJobs.length ? visibleJobs.map((job) => `
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
  }
  document.querySelectorAll("[data-queue-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.queueFilter === activeQueueFilter);
    const count = filteredJobs(jobs, button.dataset.queueFilter).length;
    button.dataset.count = count;
  });

  const workforceSource = appMode === "live" ? "Live API" : appMode === "replay" ? "Replay" : "Unavailable";
  const workforceCount = `${agents.length} ${agents.length === 1 ? "agent" : "agents"}`;
  const agentsSource = $("#agentsSource");
  if (agentsSource) agentsSource.textContent = `${workforceSource} · ${workforceCount}`;

  const agentsEl = $("#agents");
  if (agentsEl) {
    if (!agents.length) {
      agentsEl.innerHTML = `<div class="empty-state workforce-empty"><strong>${appMode === "loading" ? "Loading workforce" : "No public agents yet"}</strong><p>${appMode === "loading" ? "Fetching registered agents from the hosted API." : "Junk test agents are filtered. Real registered agents appear here."}</p></div>`;
    } else {
      agentsEl.innerHTML = agents.map((agent) => {
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
    }
  }

  const visibleLedgerItems = ledger.filter(item => !item.job?.includes("Fixture") && !item.job?.includes("fixture"));
  const ledgerEl = $("#ledger");
  if (ledgerEl) {
    ledgerEl.innerHTML = visibleLedgerItems.length
      ? visibleLedgerItems.map((item) => `
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
  `).join("")
      : `<div class="empty-state"><strong>No proofs in the live ledger</strong><p>Verified agent work will appear here after submission.</p></div>`;
  }
}

function prepareBatch() {
  if (appMode !== "replay") return;
  setActionState("#prepareBatch", "loading", "Preparing…");
  const batch = buildSettlementBatch();
  latestBatchPayload = batch;
  renderPreparedBatch(batch);
  if (!batch.approvedProofs) {
    window.setTimeout(() => setActionState("#prepareBatch", "notice", "No payouts ready"), 260);
    return;
  }
  window.setTimeout(() => setActionState("#prepareBatch", "success", "Batch ready"), 260);
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
  if (appMode !== "replay") return;
  latestBatchPayload = batch;
  const payloadText = JSON.stringify(batch, null, 2);
  const pre = $("#batchPayload");
  const dl = $("#batchDownload");
  if (pre) {
    pre.textContent = payloadText;
    pre.hidden = false;
    pre.classList.add("visible");
  }
  if (dl) {
    dl.href = `data:application/json;charset=utf-8,${encodeURIComponent(payloadText)}`;
    dl.hidden = false;
    dl.classList.add("visible");
  }
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
    systemStatus.mode = "Operator host · autonomous";
    setLandingText("#landingApi", "Connected");
    renderLivePaymentTicker(dashboard);
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
    renderLivePaymentTicker(null);
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
  void hydrateEscrowV2ProtocolPanel();
  events = [];
  events = [{
    id: pendingPayout > 0 ? "evt_live_payout_ready" : "evt_live_empty_batch",
    kind: "settlement",
    title: pendingPayout > 0 ? "payout batch ready" : "no payout batch ready",
    detail: pendingPayout > 0
      ? `${money(pendingPayout)} testnet USDC is approved and awaiting operator-controlled release.`
      : "No payable proofs waiting for release.",
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

async function hydrateEscrowV2ProtocolPanel() {
  const countEl = document.getElementById("protoV2QueueCount");
  const contractEl = document.getElementById("protoEscrowV2");
  const sellerEl = document.getElementById("protoX402Seller");
  const body = document.getElementById("protocolV2Payable");
  const settleEl = document.getElementById("protoSettlementMode");
  const storageEl = document.getElementById("protoStorageMode");
  if (!body) return;
  try {
    const [cfgRes, payRes, healthRes] = await Promise.all([
      fetch(`${API_URL}/escrow/v2/config`),
      fetch(`${API_URL}/escrow/v2/payable`),
      fetch(`${API_URL}/health`),
    ]);
    const cfg = await cfgRes.json().catch(() => ({}));
    const payable = await payRes.json().catch(() => ({}));
    const health = await healthRes.json().catch(() => ({}));
    if (settleEl) {
      const mode = health.settlement?.mode || health.settlementMode || (health.ok ? "Hosted API · autonomous operator release" : "Unavailable");
      settleEl.textContent = mode;
    }
    if (storageEl) {
      const st = health.storage || {};
      storageEl.textContent = st.mode ? `${st.mode}${st.durable ? " · durable" : ""}` : "Unavailable";
    }
    if (contractEl) {
      contractEl.textContent = cfg.contract || "Not configured";
      if (cfg.contract) {
        contractEl.innerHTML = `<a href="${ARCSCAN}/address/${escapeHtml(cfg.contract)}" target="_blank" rel="noreferrer">${escapeHtml(cfg.contract)}</a>`;
      }
    }
    if (sellerEl) {
      try {
        const nano = await fetch(`${API_URL}/nanopayment/config`).then((r) => r.json());
        sellerEl.textContent = nano.sellerAddress || "—";
      } catch {
        sellerEl.textContent = "—";
      }
    }

    // Operator-gated queue: do not fake empty on 403. Use public dashboard ledger for transparency depth.
    if (payRes.status === 403 || payable.error) {
      const publicItems = ledger
        .filter((p) => p.fundingStatus === "payable")
        .map((p) => {
          const job = jobs.find((j) => j.id === p.jobId || j.jobId === p.jobId);
          return {
            jobId: p.jobId,
            proofId: p.id || p.proofId,
            agentId: p.agentId,
            rewardAmount: money(p.amount || job?.reward || 0),
            ready: true,
            public: true,
          };
        });
      if (countEl) countEl.textContent = String(publicItems.length);
      if (!publicItems.length) {
        body.innerHTML =
          '<tr><td colspan="5">No payable proofs in the public ledger. Detailed Escrow V2 operator queue is authenticated (403 without operator key).</td></tr>';
        return;
      }
      body.innerHTML =
        `<tr><td colspan="5" class="proto-note">Operator queue is key-gated. Public view uses live payable proofs (no payout addresses).</td></tr>` +
        publicItems
          .map(
            (item) => `<tr>
        <td class="mono-data">${escapeHtml(item.jobId)}</td>
        <td class="mono-data">${escapeHtml(item.proofId)}</td>
        <td class="mono-data">${escapeHtml(item.agentId)}</td>
        <td>${escapeHtml(item.rewardAmount)} USDC</td>
        <td><span class="state-badge completed">Payable</span></td>
      </tr>`,
          )
          .join("");
      return;
    }

    if (countEl) countEl.textContent = String(payable.count ?? (payable.items || []).length ?? "—");
    const items = payable.items || [];
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="5">No Escrow V2 proofs awaiting release</td></tr>';
      return;
    }
    body.innerHTML = items
      .map(
        (item) => `<tr>
      <td class="mono-data">${escapeHtml(item.jobId)}</td>
      <td class="mono-data">${escapeHtml(item.proofId)}</td>
      <td class="mono-data">${escapeHtml(item.agentId)}</td>
      <td>${escapeHtml(item.rewardAmount)} USDC</td>
      <td>${item.ready ? '<span class="state-badge completed">Ready</span>' : '<span class="state-badge draft">Missing payout</span>'}</td>
    </tr>`,
      )
      .join("");
  } catch {
    if (countEl) countEl.textContent = "Unavailable";
    if (contractEl) contractEl.textContent = "Unavailable";
    if (settleEl) settleEl.textContent = "Unavailable";
    if (storageEl) storageEl.textContent = "Unavailable";
    body.innerHTML = '<tr><td colspan="5">Unable to load Escrow V2 payable queue</td></tr>';
  }
}

function setLandingText(selector, value) { const element = document.querySelector(selector); if (element) element.textContent = value; }

/** Live ledger strip on landing — recent proofs only, no fabricated activity. */
function renderLivePaymentTicker(dashboard) {
  const track = document.querySelector("#livePaymentTickerTrack");
  if (!track) return;
  if (!dashboard?.proofs?.length) {
    track.innerHTML = "<em>No live proof events yet — create a job or run the LLM agent.</em>";
    return;
  }
  const items = [...dashboard.proofs]
    .sort((a, b) => String(b.proofTimestamp || "").localeCompare(String(a.proofTimestamp || "")))
    .slice(0, 8)
    .map((proof) => {
      const job = (dashboard.jobs || []).find((j) => j.jobId === proof.jobId);
      const amount = Number(job?.rewardAmount || 0);
      const status = proof.fundingStatus || proof.outcome || "unknown";
      const jobType = proof.jobType || job?.jobType || "job";
      const shortId = String(proof.proofId || proof.jobId || "").slice(0, 18);
      return `<span class="live-ticker-item" data-status="${escapeHtml(status)}"><b>${escapeHtml(status)}</b> ${escapeHtml(jobType)} · ${money(amount)} USDC · <code>${escapeHtml(shortId)}</code></span>`;
    });
  track.innerHTML = items.join("");
}

function jobStatus(job) {
  if (job.fundingRail === "arc_usdc_escrow" || job.fundingRail === "arc_usdc_escrow_v2") {
    if (job.escrowStatus === "released") return "Released";
    if (job.escrowStatus === "refunded") return "Refunded";
    if (job.escrowStatus === "funded") return job.fundingRail === "arc_usdc_escrow_v2" ? "Escrow V2" : "Escrowed";
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
  if (job.fundingStatus === "paid" || job.escrowStatus === "released") return "paid";
  if (job.fundingStatus === "rejected" || job.state === "rejected") return "rejected";
  if (job.fundingStatus === "payable") return "payable";
  if (job.state === "running" || job.claimedBy || job.agentId) return "claimed";
  if (job.state === "open" || job.state === "queued") return "open";
  // draft / completed / other — not "open" for queue badges
  return "other";
}

function queueRank(job) {
  return { open: 0, payable: 1, claimed: 2, paid: 3, rejected: 4, other: 5 }[queueState(job)] ?? 5;
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

$("#addJobs")?.addEventListener("click", addJobs);
$("#runCycle")?.addEventListener("click", runCycle);
$("#prepareBatch")?.addEventListener("click", prepareBatch);
$("#toggleReplay")?.addEventListener("click", () => {
  if (appMode === "replay") {
    const toggle = document.getElementById("toggleReplay");
    if (toggle) toggle.textContent = "Simulate";
    hydrateFromApi({ force: true });
  } else {
    enterReplayMode();
  }
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
  // Product routes live on app.html; pitch lives on index.html
  if (path === "/" || path === "") {
    window.location.href = "/";
    return;
  }
  const product = ["/dashboard", "/issuer", "/agents", "/protocol"];
  if (!product.includes(path)) {
    window.location.href = path;
    return;
  }
  // If we're still on the marketing page for some reason, hard-navigate to the product shell.
  if (!document.querySelector("#issuerWorkbench") && !document.querySelector(".protocol-route")) {
    window.location.href = path;
    return;
  }
  if (location.pathname !== path) history.pushState({}, "", path);
  renderRoute();
}

function setRouteSurface(el, visible) {
  if (!el) return;
  el.hidden = !visible;
  // Hard-stop CSS display:!important leaks
  if (visible) {
    el.style.removeProperty("display");
  } else {
    el.style.setProperty("display", "none", "important");
  }
}

function renderRoute() {
  const product = ["/dashboard", "/issuer", "/agents", "/protocol"];
  let route = product.includes(location.pathname) ? location.pathname : "/dashboard";
  const landing = document.querySelector("#landingRoute");
  if (landing) landing.hidden = true;

  // Always-on product chrome
  document.querySelectorAll(".console-bar, .system-strip, .protocol-footer").forEach((el) => {
    setRouteSurface(el, true);
  });

  // Dashboard-only surfaces
  document.querySelectorAll(".dashboard-surface").forEach((element) => {
    setRouteSurface(element, route === "/dashboard");
  });

  // Agents-only surfaces
  document.querySelectorAll(".agents-surface").forEach((element) => {
    setRouteSurface(element, route === "/agents");
  });

  // Protocol page
  setRouteSurface($("#protocolPage"), route === "/protocol");

  // Issuer / agent workbenches
  if (route === "/issuer") issuerWorkbench.show();
  else issuerWorkbench.hide();
  if (route === "/agents") agentWorkbench.show();
  else agentWorkbench.hide();

  // Ensure issuer workbench visibility is also hard-gated
  setRouteSurface($("#issuerWorkbench"), route === "/issuer");
  // agents-surface already gates agentWorkbench

  // Defensive pass: any protocol-route that is not shared chrome
  document.querySelectorAll(".protocol-route").forEach((element) => {
    if (element.matches(".console-bar, .system-strip, .protocol-footer")) return;
    if (element.matches(".dashboard-surface")) {
      setRouteSurface(element, route === "/dashboard");
      return;
    }
    if (element.matches(".agents-surface")) {
      setRouteSurface(element, route === "/agents");
      return;
    }
    if (element.id === "protocolPage") {
      setRouteSurface(element, route === "/protocol");
      return;
    }
    if (element.id === "issuerWorkbench") {
      setRouteSurface(element, route === "/issuer");
      return;
    }
  });

  document.querySelectorAll(".page-nav a").forEach((link) => link.classList.toggle("active", link.pathname === route));
  document.title =
    route === "/issuer"
      ? "Issuer Portal · Prooflet"
      : route === "/agents"
        ? "Agent Portal · Prooflet"
        : route === "/protocol"
          ? "Protocol · Prooflet"
          : "Ledger · Prooflet";
  window.scrollTo({ top: 0, behavior: "instant" });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-route], a[href^='/']");
  if (!link || link.origin !== location.origin) return;
  const path = link.pathname;
  if (path === "/" || path === "") return; // let browser load landing
  if (!["/dashboard", "/issuer", "/agents", "/protocol"].includes(path)) return;
  // From product shell, SPA-nav product routes
  if (document.querySelector("#issuerWorkbench") || document.querySelector(".protocol-route")) {
    event.preventDefault();
    navigate(path);
  }
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
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="leaderboard-empty">Leaderboard unavailable · check API</td></tr>';
}

function renderLeaderboard(rows) {
  const tbody = document.getElementById("leaderboardBody");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="leaderboard-empty">No ranked agents yet · junk test names are filtered</td></tr>';
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
