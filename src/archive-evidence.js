export const ARCHIVED_SUBMISSION_EVIDENCE = Object.freeze({
  label: "Archived Lepton submission evidence",
  sourceCommit: "298415b1bcca803436812327a07a93e77aadb590",
  batchId: "uwp_arc_20260618_001",
  totalPayout: "0.054 USDC",
  network: "Arc Testnet",
  settledAt: "2026-06-17T23:38:28.762Z",
  receipts: [
    {
      agentId: "agent_mira",
      hash: "0x3732ce1d02eebb97c213bd88c1d169f6f01eb79fdd6c527f0e19ca9854751552",
      blockNumber: "47501957",
    },
    {
      agentId: "agent_byte",
      hash: "0x9ad7d702921178fc1c396bd6e0db2e862a0d3f6c87223a20d018237aeb6cde3d",
      blockNumber: "47501959",
    },
    {
      agentId: "agent_lynx",
      hash: "0x3a68ec718ca3390f10a44a7435a78431dda0549ad14be1cc48088d5e91fa4e0a",
      blockNumber: "47501962",
    },
  ],
});

export function createReplayState() {
  return {
    agents: [
      { id: "lynx", agentId: "replay_agent_lynx", name: "Link Sentinel", skill: "Verifies links and redirect chains", icon: "LK", payoutWallet: "Replay wallet", status: "idle", earned: 0, score: 97 },
      { id: "mira", agentId: "replay_agent_mira", name: "Freshness Clerk", skill: "Checks source recency", icon: "FR", payoutWallet: "Replay wallet", status: "idle", earned: 0, score: 94 },
      { id: "byte", agentId: "replay_agent_byte", name: "Context Press", skill: "Compresses traces", icon: "CP", payoutWallet: "Replay wallet", status: "idle", earned: 0, score: 99 },
      { id: "vera", agentId: "replay_agent_vera", name: "Label Judge", skill: "Labels evaluation rows", icon: "LB", payoutWallet: "Replay wallet", status: "idle", earned: 0, score: 91 },
    ],
    jobs: [
      { id: "REPLAY-1", type: "link_verify", title: "Replay: verify documentation links", reward: 0.003, issuer: "Browser replay", fundingStatus: "reserved", estimate: "22 sec", priority: "high", state: "queued" },
      { id: "REPLAY-2", type: "freshness_check", title: "Replay: check source freshness", reward: 0.002, issuer: "Browser replay", fundingStatus: "reserved", estimate: "18 sec", priority: "med", state: "queued" },
    ],
    ledger: [],
    events: [{ id: "replay_ready", kind: "claim", title: "replay ready", detail: "Browser-only data is loaded. No API writes or settlement will occur.", meta: "simulation" }],
  };
}
