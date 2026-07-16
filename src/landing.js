/**
 * Landing-only module: sparse product surface + live ledger ticker.
 * No workbench chrome. Docs stay in the repo, not the homepage.
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

async function hydrate() {
  const pill = document.querySelector("#landingApiPill em");
  const stat = document.querySelector("#landingLiveStat");
  const track = document.querySelector("#livePaymentTickerTrack");
  try {
    const [healthRes, dashRes] = await Promise.all([
      fetch(`${API_URL}/health`),
      fetch(`${API_URL}/dashboard`),
    ]);
    if (!healthRes.ok || !dashRes.ok) throw new Error("API unavailable");
    const health = await healthRes.json();
    const dashboard = await dashRes.json();
    if (pill) {
      pill.textContent = health.storage?.durable ? "Live · durable" : "Live";
    }
    const proofs = dashboard.proofs || [];
    const payable = proofs.filter((p) => p.fundingStatus === "payable").length;
    if (stat) {
      stat.textContent = `${proofs.length} proofs · ${payable} payable`;
    }
    if (track) {
      if (!proofs.length) {
        track.innerHTML = "<em>No live proof events yet</em>";
      } else {
        const items = [...proofs]
          .sort((a, b) => String(b.proofTimestamp || "").localeCompare(String(a.proofTimestamp || "")))
          .slice(0, 8)
          .map((proof) => {
            const job = (dashboard.jobs || []).find((j) => j.jobId === proof.jobId);
            const amount = Number(job?.rewardAmount || 0);
            const status = proof.fundingStatus || proof.outcome || "unknown";
            const jobType = proof.jobType || job?.jobType || "job";
            const shortId = String(proof.proofId || proof.jobId || "").slice(0, 16);
            return `<span class="live-ticker-item" data-status="${escapeHtml(status)}"><b>${escapeHtml(status)}</b> ${escapeHtml(jobType)} · ${money(amount)} USDC · <code>${escapeHtml(shortId)}</code></span>`;
          });
        track.innerHTML = items.join("");
      }
    }
  } catch {
    if (pill) pill.textContent = "API offline";
    if (track) track.innerHTML = "<em>Ledger unavailable</em>";
    if (stat) stat.textContent = "API unavailable";
  }
}

hydrate();
setInterval(hydrate, 20000);
