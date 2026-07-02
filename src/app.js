import "./styles.css";
import { initIssuerWorkbench } from "./issuer-workbench.js";

const ARCSCAN = "https://testnet.arcscan.app";
const DEFAULT_API_URL = import.meta.env.PROD ? "https://prooflet-api.onrender.com" : "http://127.0.0.1:8787";
const API_URL = window.UWP_API_URL || import.meta.env.VITE_UWP_API_URL || DEFAULT_API_URL;
const TREASURY = {
  issuer: "useful_waiting_protocol",
  network: "Arc Testnet",
  asset: "USDC",
  address: "0x709F18F797347FbB8D53Fb60567892751dd14B11",
  availableBalance: "1.761023 USDC at last check",
};

// Loading / error state
let apiConnected = false;
let apiLoading = true;
let apiError = null;

const SETTLED_BATCH = {
  batchId: "uwp_arc_20260618_001",
  settledAt: "2026-06-17T23:38:28.762Z",
  totalPayout: 0.054,
  txs: {
    agent_mira: {
      hash: "0x3732ce1d02eebb97c213bd88c1d169f6f01eb79fdd6c527f0e19ca9854751552",
      explorer: "https://testnet.arcscan.app/tx/0x3732ce1d02eebb97c213bd88c1d169f6f01eb79fdd6c527f0e19ca9854751552",
      blockNumber: "47501957",
    },
    agent_byte: {
      hash: "0x9ad7d702921178fc1c396bd6e0db2e862a0d3f6c87223a20d018237aeb6cde3d",
      explorer: "https://testnet.arcscan.app/tx/0x9ad7d702921178fc1c396bd6e0db2e862a0d3f6c87223a20d018237aeb6cde3d",
      blockNumber: "47501959",
    },
    agent_lynx: {
      hash: "0x3a68ec718ca3390f10a44a7435a78431dda0549ad14be1cc48088d5e91fa4e0a",
      explorer: "https://testnet.arcscan.app/tx/0x3a68ec718ca3390f10a44a7435a78431dda0549ad14be1cc48088d5e91fa4e0a",
      blockNumber: "47501962",
    },
  },
};

const SEEDED_DEMO_AGENT_IDS = new Set(["agent_lynx", "agent_mira", "agent_byte", "agent_vera"]);

const agents = [
  { id: "lynx", agentId: "agent_lynx", name: "Link Sentinel", skill: "Verifies stale links and redirect chains", icon: "LK", payoutWallet: "0xC2094270dc7d17C1578a975dd1Aa50578c034Be4", status: "idle", earned: 0.084, score: 97 },
  { id: "mira", agentId: "agent_mira", name: "Freshness Clerk", skill: "Checks source recency and cache freshness", icon: "FR", payoutWallet: "0x1DcB045123730e606A88380BCe534332F50332d2", status: "idle", earned: 0.062, score: 94 },
  { id: "byte", agentId: "agent_byte", name: "Context Press", skill: "Compresses long traces into reusable context", icon: "CP", payoutWallet: "0x110997DF4d76895ce37B64Bc2665ba2A8e639b1e", status: "idle", earned: 0.119, score: 99 },
  { id: "vera", agentId: "agent_vera", name: "Label Judge", skill: "Labels low-confidence snippets for eval sets", icon: "LB", payoutWallet: "0xE6cDb25252E0f07AE50560ee6F104d48Cfc33667", status: "idle", earned: 0.041, score: 91 },
];

let jobs = [
  { id: "J-1042", type: "link_verify", title: "Verify 12 CCTP docs links", reward: 0.018, issuer: "Prooflet protocol", fundingStatus: "payable", estimate: "22 sec", priority: "high", state: "done", proof: "HTTP 200/301 trace captured", secondsSaved: 22 },
  { id: "J-1043", type: "freshness_check", title: "Refresh Arc fee claim citations", reward: 0.014, issuer: "Prooflet protocol", fundingStatus: "paid", estimate: "18 sec", priority: "med", state: "done", proof: "cache TTL refreshed", secondsSaved: 18 },
  { id: "J-1044", type: "context_compress", title: "Compress 9-agent trace to 1.5K tokens", reward: 0.026, issuer: "Prooflet protocol", fundingStatus: "reserved", estimate: "35 sec", priority: "high", state: "queued" },
  { id: "J-1045", type: "label", title: "Label 20 eval rows for answer quality", reward: 0.011, issuer: "Prooflet protocol", fundingStatus: "reserved", estimate: "26 sec", priority: "low", state: "queued" },
];

let ledger = [
  {
    id: "0x9b31",
    jobId: "job_0002",
    jobType: "context_compression",
    agentId: "agent_byte",
    agent: "Context Press",
    job: "Compressed research trace",
    amount: 0.024,
    tx: SETTLED_BATCH.txs.agent_byte.hash,
    explorer: SETTLED_BATCH.txs.agent_byte.explorer,
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
    tx: SETTLED_BATCH.txs.agent_lynx.hash,
    explorer: SETTLED_BATCH.txs.agent_lynx.explorer,
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
    tx: SETTLED_BATCH.txs.agent_mira.hash,
    explorer: SETTLED_BATCH.txs.agent_mira.explorer,
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
const systemStatus = { api: "Connecting", arc: "Checking", mode: "Dry-run default", batch: SETTLED_BATCH.batchId, payout: SETTLED_BATCH.totalPayout };
let eventSeq = 5;
let events = [
  {
    id: "evt_005",
    kind: "settlement",
    title: "Arc batch settled",
    detail: `${SETTLED_BATCH.batchId} paid 0.054 testnet USDC across 3 agent wallets`,
    meta: "3 tx confirmed",
  },
  {
    id: "evt_004",
    kind: "approved",
    title: "proof paid",
    detail: "agent_byte proof settled on Arc Testnet in block 47501959",
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

const $ = (selector) => document.querySelector(selector);
const money = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function render() {
  // Show loading/error indicators
  const loadingEl = document.getElementById("loadingIndicator");
  const errorEl = document.getElementById("apiErrorBanner");
  if (loadingEl) loadingEl.hidden = !apiLoading;
  if (errorEl) errorEl.hidden = !apiError;
  if (errorEl) errorEl.textContent = apiError || "";
  // Update connection badge in nav
  document.querySelectorAll(".api-badge").forEach((el) => {
    el.textContent = apiConnected ? "API Connected" : "Local Demo Data";
    el.className = `api-badge ${apiConnected ? "connected" : "fallback"}`;
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
  $("#treasuryNetwork").textContent = TREASURY.network;
  $("#treasuryAsset").textContent = TREASURY.asset;
  $("#treasuryAddress").textContent = TREASURY.address;
  $("#treasuryBalance").textContent = TREASURY.availableBalance;
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
  $("#runCycle").disabled = running || queued.length === 0;

  $("#events").innerHTML = events.map((event) => `
    <article class="event-row ${event.kind}">
      <div class="event-dot"></div>
      <div>
        <strong>${event.title}</strong>
        <p>${event.detail}</p>
      </div>
      <span>${event.meta}</span>
    </article>
  `).join("");

  const visibleJobs = filteredJobs(jobs, activeQueueFilter).filter(job => !job.title?.includes("Fixture") && !job.title?.includes("fixture"));
  $("#jobs").innerHTML = visibleJobs.length ? visibleJobs.map((job) => `
    <article class="job ${job.state} ${job.compoundParentId ? 'is-subtask' : ''} ${job.type === 'compound_job' ? 'is-compound' : ''}">
      <div class="job-main">
        <div style="display:flex; gap: 8px; align-items: center;">
          <span class="state-badge ${jobStatus(job).toLowerCase().replace(' ', '-')}">${jobStatus(job)}</span>
          ${job.type === 'compound_job' ? '<span class="state-badge compound-badge">Compound</span>' : ''}
          ${job.compoundParentId ? `<span class="state-badge subtask-badge">↳ Sub-task</span>` : ''}
        </div>
        <h3>${job.title}</h3>
        <p>${job.id} - ${job.estimate} - ${job.issuer}${job.proof ? ` - ${job.proof}` : ""}</p>
      </div>
      <div class="payout"><strong>${money(job.reward)}</strong><span>USDC</span></div>
    </article>
  `).join("") : `<div class="queue-empty"><strong>No ${queueLabel(activeQueueFilter)} jobs</strong><p>Jobs will appear here when they enter this protocol state.</p></div>`;
  document.querySelectorAll("[data-queue-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.queueFilter === activeQueueFilter);
    const count = filteredJobs(jobs, button.dataset.queueFilter).length;
    button.dataset.count = count;
  });

  const workforceSource = apiConnected ? "Source: API / registered agents" : "Source: demo fallback data";
  const workforceCount = `${agents.length} registered ${agents.length === 1 ? "agent" : "agents"}`;
  const agentsSource = $("#agentsSource");
  if (agentsSource) agentsSource.textContent = `${workforceSource} · ${workforceCount}`;

  $("#agents").innerHTML = agents.map((agent) => {
    const agentKind = SEEDED_DEMO_AGENT_IDS.has(agent.agentId) ? "Seeded demo agent" : "Registered live agent";
    const walletKind = agent.circleWalletId ? "Circle wallet" : "Manual payout";
    return `
    <article class="agent ${agent.status}">
      <div class="agent-head">
        <div class="agent-icon">${escapeHtml(agent.icon)}</div>
        <span>${escapeHtml(agent.status)}</span>
      </div>
      <div class="agent-badges"><span>${agentKind}</span><span>${walletKind}</span></div>
      <h3>${escapeHtml(agent.name)}</h3>
      <p>${escapeHtml(agent.skill)}</p>
      <div class="agent-stats"><span>${money(agent.earned)} USDC</span><span>${Math.round(agent.score)} trust</span></div>
      <code>${escapeHtml(agent.payoutWallet || "No payout wallet")}</code>
    </article>`;
  }).join("");

  const visibleLedgerItems = ledger.filter(item => !item.job?.includes("Fixture") && !item.job?.includes("fixture"));
  $("#ledger").innerHTML = visibleLedgerItems.map((item) => `
    <article class="receipt ${item.outcome}">
      <div>
        <strong>${item.agent}</strong>
        <p>${item.job}</p>
        <small>${item.outcome === "accepted" ? (item.proof || "Awaiting decision") : (item.rejectionReason || "Awaiting decision")}</small>
        ${item.adjudicationRoute ? `<small>${adjudicationLabel(item)}</small>` : ""}
      </div>
      <div class="receipt-right">
        <span>${item.outcome === "accepted" ? `${money(item.amount)} USDC` : "No payout"}</span>
        ${item.tx ? `<a href="${item.explorer || `${ARCSCAN}/tx/${item.tx}`}" target="_blank" rel="noreferrer">Paid · Arc Testnet</a>` : `<em>${proofStatus(item)}</em>`}
        <a class="proof-link" href="${proofHref(item)}" download="${item.id}-proof.json">proof packet</a>
      </div>
    </article>
  `).join("");
}

function prepareBatch() {
  latestBatchPayload = buildSettlementBatch();
  renderPreparedBatch(latestBatchPayload);
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
      previousSettledBatch: SETTLED_BATCH.batchId,
    })),
  };
}

function addJobs() {
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
  const nextJob = jobs.find((job) => job.state === "queued");
  if (!nextJob || running) return;
  const agent = agents.find((item) => item.id === jobToAgent[nextJob.type]);
  idleCyclesUsed += 1;
  pushEvent("claim", "agent claimed job", `${agent.name} claimed ${nextJob.id}: ${nextJob.title}`, `${money(nextJob.reward)} USDC`);
  nextJob.state = "running";
  nextJob.agentId = agent.id;
  agent.status = "working";
  running = true;
  render();
  window.setTimeout(() => {
    pushEvent("measure", "measurement completed", measurementCopy(nextJob), nextJob.type);
    render();
  }, 320);
  window.setTimeout(() => {
    pushEvent("proof", "proof generated", proofFor(nextJob.type), "packet ready");
    render();
  }, 640);
  window.setTimeout(() => completeCycle(nextJob, agent), 980);
}

function completeCycle(job, agent) {
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
      explorer: item.explorer || (item.tx ? `${ARCSCAN}/tx/${item.tx}` : null),
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

async function hydrateFromApi() {
  apiLoading = true;
  apiConnected = false;
  apiError = null;
  render();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(`${API_URL}/dashboard`, { signal: controller.signal });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const dashboard = await response.json();
    applyDashboard(dashboard);
    apiConnected = true;
    apiLoading = false;
    $("#apiStatus").textContent = "API connected";
    systemStatus.api = "Connected";
    systemStatus.arc = dashboard.treasury?.network === "Arc Testnet" ? "Connected" : "Unavailable";
    setLandingText("#landingApi", "Connected");
    render();
    hydrateLeaderboard().catch(() => {});
  } catch (error) {
    apiConnected = false;
    apiLoading = false;
    apiError = "Demo data mode: Connect API for live issuer actions.";
    $("#apiStatus").textContent = "Demo data mode";
    systemStatus.api = "Demo data mode";
    systemStatus.arc = "Demo data";
    setLandingText("#landingApi", "Demo data mode");
    setLandingText("#landingLatestPaid", `${money(SETTLED_BATCH.totalPayout)} USDC`);
    setLandingText("#landingPayable", `${money(ledger.filter((proof) => proof.fundingStatus === "payable").reduce((sum, proof) => sum + proof.amount, 0))} USDC`);
    setLandingText("#landingRejected", ledger.filter((proof) => proof.fundingStatus === "rejected").length);
    setLandingText("#landingTreasury", "Demo data");
    render();
    renderLocalLeaderboard();
  } finally {
    window.clearTimeout(timeout);
  }
}

function applyDashboard(dashboard) {
  TREASURY.address = dashboard.issuer?.treasuryAddress || TREASURY.address;
  const existingAgents = new Map(agents.map((agent) => [agent.agentId, agent]));
  const paidByAgent = dashboard.proofs
    .filter((proof) => proof.fundingStatus === "paid")
    .reduce((totals, proof) => totals.set(proof.agentId, (totals.get(proof.agentId) || 0) + jobReward(dashboard.jobs, proof.jobId)), new Map());

  agents.splice(0, agents.length, ...dashboard.agents.map((agent, index) => {
    const fallback = existingAgents.get(agent.agentId);
    return {
      id: agent.agentId.replace(/^agent_/, ""),
      agentId: agent.agentId,
      name: agent.name,
      skill: capabilityLabel(agent.capabilities),
      icon: fallback?.icon || agent.name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
      payoutWallet: agent.payoutAddress,
      status: agent.status,
      earned: paidByAgent.get(agent.agentId) || 0,
      score: agent.reputationScore,
      circleWalletId: agent.circleWalletId,
      walletSource: agent.walletSource,
      source: SEEDED_DEMO_AGENT_IDS.has(agent.agentId) ? "seeded" : "registered",
    };
  }));

  const existingJobs = new Map(jobs.map((job) => [job.id.toLowerCase().replace("j-", "job_"), job]));
  jobs = dashboard.jobs.map((job) => {
    const fallback = existingJobs.get(job.jobId);
    return {
      id: job.jobId.toUpperCase().replace("JOB_", "J-"),
      type: apiJobType(job.jobType),
      title: fallback?.title || jobTitle(job),
      reward: Number(job.rewardAmount),
      issuer: job.issuerId,
      fundingStatus: job.fundingStatus,
      estimate: fallback?.estimate || "API job",
      priority: Number(job.rewardAmount) >= 0.018 ? "high" : Number(job.rewardAmount) >= 0.012 ? "med" : "low",
      state: job.status === "open" ? "queued" : job.status === "claimed" ? "running" : "done",
      proof: fallback?.proof,
      secondsSaved: fallback?.secondsSaved || 0,
      agentId: job.claimedBy,
      compoundParentId: job.compoundParentId,
      fundingRail: job.fundingRail,
      escrowStatus: job.escrowStatus,
    };
  });

  const existingProofs = new Map(ledger.map((proof) => [proof.id, proof]));
  ledger = dashboard.proofs.map((proof) => {
    const fallback = existingProofs.get(proof.proofId);
    const agent = dashboard.agents.find((item) => item.agentId === proof.agentId);
    const job = dashboard.jobs.find((item) => item.jobId === proof.jobId);
    return {
      id: proof.proofId,
      jobId: proof.jobId,
      jobType: proof.jobType,
      agentId: proof.agentId,
      agent: agent?.name || proof.agentId,
      job: fallback?.job || jobTitle(job),
      amount: Number(job?.rewardAmount || 0),
      tx: proof.txHash,
      explorer: proof.explorer,
      proof: fallback?.proof || proof.verificationRoute,
      outcome: proof.outcome,
      fundingStatus: proof.fundingStatus,
      settlementStatus: proof.settlementStatus,
      rejectionReason: proof.rejectionReason,
      input: proof.input,
      result: proof.result,
      secondsSaved: fallback?.secondsSaved || 0,
      proofTimestamp: proof.proofTimestamp,
      adjudicationRoute: proof.adjudicationRoute,
      genlayer: proof.genlayer,
    };
  });

  const latestSettled = dashboard.settlements?.batches?.find((batch) => batch.status === "settled");
  const payableTotal = dashboard.proofs.filter((proof) => proof.fundingStatus === "payable").reduce((total, proof) => total + jobReward(dashboard.jobs, proof.jobId), 0);
  const rejectedTotal = dashboard.proofs.filter((proof) => proof.fundingStatus === "rejected").length;
  setLandingText("#landingPayable", `${money(payableTotal)} USDC`);
  setLandingText("#landingRejected", rejectedTotal);
  setLandingText("#landingTreasury", dashboard.issuer?.treasuryAddress ? "Configured" : "Not configured");
  if (latestSettled) {
    systemStatus.batch = latestSettled.batch_id;
    systemStatus.payout = Number(latestSettled.total_payout);
    setLandingText("#landingLatestPaid", `${money(Number(latestSettled.total_payout))} USDC`);
    events = [{
      id: `evt_${latestSettled.batch_id}`,
      kind: "settlement",
      title: "Arc batch settled",
      detail: `${latestSettled.batch_id} paid ${money(Number(latestSettled.total_payout))} testnet USDC`,
      meta: "confirmed",
    }, ...events.filter((event) => event.title !== "Arc batch settled")].slice(0, 8);
  }
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
$("#queueTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-queue-filter]");
  if (!button) return;
  activeQueueFilter = button.dataset.queueFilter;
  render();
});
render();
hydrateFromApi();
const issuerWorkbench = initIssuerWorkbench({ apiUrl: API_URL, onNavigate: navigate });

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
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${API_URL}/leaderboard`, { signal: controller.signal });
    window.clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderLeaderboard(data.leaderboard || []);
  } catch {
    renderLocalLeaderboard();
  }
}

function renderLocalLeaderboard() {
  const sorted = [...agents].sort((a, b) => b.earned - a.earned || b.score - a.score);
  renderLeaderboard(sorted.map((agent, i) => ({
    rank: i + 1,
    agentId: agent.agentId,
    name: agent.name,
    score: agent.score,
    approvedProofs: "-",
    paidProofs: "-",
    settledVolume: `${agent.earned.toFixed(3)} USDC`,
    duplicateRate: 0,
    riskFlag: "clean",
    accessLevel: "starter",
    status: agent.status,
  })));
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
    const rankIcon = row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : `#${row.rank}`;
    return `<tr>
      <td class="leaderboard-rank">${rankIcon}</td>
      <td><strong>${escapeHtml(row.name)}</strong><br><small>${escapeHtml(row.agentId)}</small></td>
      <td class="leaderboard-score">${row.score ?? "-"}</td>
      <td>${row.approvedProofs ?? "-"}</td>
      <td>${row.paidProofs ?? "-"}</td>
      <td class="leaderboard-earned">${row.settledVolume || "0.000 USDC"}</td>
      <td><span class="risk-badge ${riskClass}">${row.riskFlag || "clean"}</span></td>
    </tr>`;
  }).join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
