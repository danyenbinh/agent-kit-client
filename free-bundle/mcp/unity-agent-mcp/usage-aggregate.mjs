/**
 * PKE Phase 8 — weekly usage dashboard from agent-turns + MCP session logs.
 */
import fs from "node:fs";
import path from "node:path";

const PKE_TOOL_PREFIXES = [
  "agent_get_index_health",
  "agent_get_prefab_fingerprint",
  "agent_query_scriptable",
  "agent_find_references",
  "agent_get_changed_since",
  "agent_get_module_flow_edges",
  "agent_prefab_audit",
];

export function isoWeekKey(isoTs) {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return "unknown";
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function emptyWeek() {
  return {
    turns: 0,
    grepCount: 0,
    readCount: 0,
    pkeQueries: 0,
    mcpToolCalls: 0,
    mcpTokensEst: 0,
    agentTokensEst: 0,
    byTaskType: {},
  };
}

function isPkeTool(name) {
  if (!name || typeof name !== "string") return false;
  return PKE_TOOL_PREFIXES.some((p) => name === p || name.startsWith(p));
}

/** Aggregate turns + MCP session by ISO week. */
export function aggregateWeeklyUsage(projectRoot, options = {}) {
  const bridgeRoot = path.join(projectRoot, ".cursor", "unity-bridge");
  const turnLog = path.join(bridgeRoot, "usage", "agent-turns.jsonl");
  const mcpLog = path.join(bridgeRoot, "usage", "mcp-session.jsonl");

  const weeks = {};
  const addWeek = (key) => {
    if (!weeks[key]) weeks[key] = emptyWeek();
    return weeks[key];
  };

  for (const t of readJsonl(turnLog)) {
    const key = isoWeekKey(t.ts);
    const w = addWeek(key);
    w.turns += 1;
    w.grepCount += t.grepCount ?? 0;
    w.readCount += t.readCount ?? 0;
    w.pkeQueries += t.pkeQueries ?? 0;
    w.agentTokensEst += t.totalTokensEst ?? 0;
    const tt = t.taskType ?? "unknown";
    w.byTaskType[tt] = (w.byTaskType[tt] ?? 0) + 1;
  }

  for (const m of readJsonl(mcpLog)) {
    const key = isoWeekKey(m.ts);
    const w = addWeek(key);
    w.mcpToolCalls += 1;
    w.mcpTokensEst += m.totalTokens ?? 0;
    if (isPkeTool(m.tool)) {
      w.pkeQueries += 1;
    }
  }

  const sortedKeys = Object.keys(weeks).sort();
  const limit = options.weeks ?? 2;
  const recentKeys = sortedKeys.slice(-limit);
  const recent = {};
  for (const k of recentKeys) recent[k] = weeks[k];

  let comparison = null;
  if (recentKeys.length >= 2) {
    const prev = weeks[recentKeys[recentKeys.length - 2]];
    const curr = weeks[recentKeys[recentKeys.length - 1]];
    comparison = {
      grepDelta: deltaPct(prev.grepCount, curr.grepCount),
      readDelta: deltaPct(prev.readCount, curr.readCount),
      pkeDelta: deltaPct(prev.pkeQueries, curr.pkeQueries),
      turnsDelta: deltaPct(prev.turns, curr.turns),
    };
  }

  return { weeks: recent, allWeeks: weeks, comparison, weekKeys: recentKeys };
}

function deltaPct(prev, curr) {
  if (prev === 0 && curr === 0) return 0;
  if (prev === 0) return 100;
  return Math.round(((curr - prev) / prev) * 100);
}

export function formatWeeklyDashboard(agg) {
  const lines = ["=== Weekly usage dashboard (ADHD baseline) ==="];
  if (!agg.weekKeys.length) {
    lines.push("no data — call agent_record_turn at end of tasks");
    return lines.join("\n");
  }

  for (const key of agg.weekKeys) {
    const w = agg.weeks[key];
    lines.push(
      `${key}: turns=${w.turns} grep=${w.grepCount} read=${w.readCount} pkeQueries=${w.pkeQueries} mcpCalls=${w.mcpToolCalls} agentTok~${w.agentTokensEst}`
    );
    const types = Object.entries(w.byTaskType)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
    if (types) lines.push(`  taskTypes: ${types}`);
  }

  if (agg.comparison) {
    const c = agg.comparison;
    lines.push(
      `WoW: grep ${fmtDelta(c.grepDelta)} | read ${fmtDelta(c.readDelta)} | pkeQueries ${fmtDelta(c.pkeDelta)} | turns ${fmtDelta(c.turnsDelta)}`
    );
  }

  lines.push("Target: grep/read ↓ after PKE ladder; pkeQueries ↑");
  return lines.join("\n");
}

function fmtDelta(n) {
  if (n > 0) return `+${n}%`;
  if (n < 0) return `${n}%`;
  return "0%";
}
