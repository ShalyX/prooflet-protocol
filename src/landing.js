/**
 * Landing-only module: product pitch + continuous news-style proof ticker.
 */
import "./styles.css";

const API_URL = (import.meta.env.VITE_PROOFLET_API_URL || "https://prooflet-api.onrender.com").replace(/\/$/, "");

function money(n) {
  const x = Number(n) || 0;
  return x.toFixed(3);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setText(sel, value) {
  const el = document.querySelector(sel);
  if (el) el.textContent = value;
}

function renderTicker(proofs, jobs) {
  const track = document.querySelector("#livePaymentTickerTrack");
  if (!track) return;

  if (!proofs.length) {
    track.classList.remove("is-scrolling");
    track.style.removeProperty("--ticker-duration");
    track.innerHTML = `<span class="news-ticker-loading">No live proof events yet</span>`;
    return;
  }

  const items = [...proofs]
    .sort((a, b) => String(b.proofTimestamp || "").localeCompare(String(a.proofTimestamp || "")))
    .slice(0, 12)
    .map((proof) => {
      const job = (jobs || []).find((j) => j.jobId === proof.jobId);
      const amount = Number(job?.rewardAmount || 0);
      const status = proof.fundingStatus || proof.outcome || "unknown";
      const jobType = proof.jobType || job?.jobType || "job";
      const shortId = String(proof.proofId || proof.jobId || "").slice(0, 14);
      return (
        `<span class="news-ticker-item" data-status="${escapeHtml(status)}">` +
        `<b>${escapeHtml(status)}</b>` +
        `<span>${escapeHtml(jobType)}</span>` +
        `<em>${money(amount)} USDC</em>` +
        `<code>${escapeHtml(shortId)}</code>` +
        `</span>`
      );
    });

  // Duplicate strip for seamless marquee loop (news-channel style).
  const strip = items.join("");
  track.innerHTML = `<div class="news-ticker-seq">${strip}</div><div class="news-ticker-seq" aria-hidden="true">${strip}</div>`;
  track.classList.add("is-scrolling");

  // Speed scales gently with item count; keep readable.
  const seconds = Math.max(28, Math.min(70, items.length * 5));
  track.style.setProperty("--ticker-duration", `${seconds}s`);
}

async function hydrate() {
  try {
    const [healthRes, dashRes] = await Promise.all([
      fetch(`${API_URL}/health`),
      fetch(`${API_URL}/dashboard`),
    ]);
    if (!healthRes.ok || !dashRes.ok) throw new Error("API unavailable");
    const health = await healthRes.json();
    const dashboard = await dashRes.json();

    const pill = document.querySelector("#landingApiPill em");
    if (pill) pill.textContent = health.storage?.durable ? "Live · durable" : "Live";

    const proofs = dashboard.proofs || [];
    const jobs = dashboard.jobs || [];
    const payable = proofs.filter((p) => p.fundingStatus === "payable").length;
    const openJobs = jobs.filter((j) => j.status === "open").length;
    const rejected = proofs.filter((p) => p.fundingStatus === "rejected" || p.outcome === "rejected").length;

    setText("#landingLiveStat", `${proofs.length} proofs · ${payable} payable`);
    setText("#landingApi", health.ok ? "Connected" : "Degraded");
    setText(
      "#landingStorage",
      health.storage?.mode
        ? `${health.storage.mode}${health.storage.durable ? " · durable" : ""}`
        : "Unknown",
    );
    setText("#landingProofs", String(proofs.length));
    setText("#landingOpenJobs", String(openJobs));
    setText("#landingRejected", String(rejected));

    const payableUsdc = proofs
      .filter((p) => p.fundingStatus === "payable")
      .reduce((sum, p) => {
        const job = jobs.find((j) => j.jobId === p.jobId);
        return sum + Number(job?.rewardAmount || 0);
      }, 0);
    setText("#landingPayable", `${money(payableUsdc)} USDC · ${payable} proofs`);

    renderTicker(proofs, jobs);
  } catch {
    setText("#landingApiPill em", "API offline");
    setText("#landingApi", "Unavailable");
    setText("#landingStorage", "Unavailable");
    setText("#landingPayable", "Unavailable");
    setText("#landingProofs", "Unavailable");
    setText("#landingOpenJobs", "Unavailable");
    setText("#landingRejected", "Unavailable");
    setText("#landingLiveStat", "API unavailable");
    const track = document.querySelector("#livePaymentTickerTrack");
    if (track) {
      track.classList.remove("is-scrolling");
      track.innerHTML = `<span class="news-ticker-loading">Ledger unavailable</span>`;
    }
  }
}

hydrate();
setInterval(hydrate, 20000);
