/**
 * Public agent display filters — hide junk/test registrations from demos.
 * Post-submission development.
 */

const JUNK_NAME_RE =
  /^(test|tester|qa(\s+agent.*)?|probe(\s+.*)?|close\d*|close\s*agent.*|tmp|temp|foo|bar|baz|asdf|xxx|demo\s*agent|agent\s*test|minion|gremlin|load.?test|spam|junk)$/i;

const JUNK_ID_RE =
  /(^agent_)?(test|qa_|qa\d|probe|tmp|temp|close|foo|bar|load|spam|junk|demo_?agent|minion)/i;

const JUNK_HANDLE_RE = /^(test|qa|probe|tmp|close\d*|foo|bar)$/i;

/**
 * @param {{ name?: string, agentId?: string, agent_id?: string, handle?: string } | null | undefined} agent
 * @returns {boolean} true if agent should be hidden from public workforce/leaderboard
 */
export function isJunkPublicAgent(agent) {
  if (!agent) return true;
  const name = String(agent.name || "").trim();
  const id = String(agent.agentId || agent.agent_id || "").trim();
  const handle = String(agent.handle || "").trim();

  if (!name && !id) return true;
  if (name && JUNK_NAME_RE.test(name)) return true;
  if (name && /^close\b/i.test(name)) return true;
  if (name && /\b(test|qa|probe|minion|gremlin)\b/i.test(name) && /agent|demo|tmp|temp|probe|minion|gremlin/i.test(name)) return true;
  if (name && /^(minion|gremlin|probe)\b/i.test(name)) return true;
  if (handle && JUNK_HANDLE_RE.test(handle)) return true;
  if (id && JUNK_ID_RE.test(id)) return true;

  // Very short throwaway names
  if (name && name.length <= 2) return true;
  // pure digits
  if (name && /^\d+$/.test(name)) return true;

  return false;
}

/**
 * Filter a list of agent-like rows for public UI/API.
 * Keeps order; renumbers rank if present.
 */
export function filterPublicAgents(rows = []) {
  const kept = (rows || []).filter((row) => !isJunkPublicAgent(row));
  return kept.map((row, i) => (row && typeof row.rank === "number" ? { ...row, rank: i + 1 } : row));
}
