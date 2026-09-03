/**
 * PKE Phase 8 — episodic insights from ISR (.cursor/agent-episodes.jsonl).
 */
import fs from "node:fs";
import path from "node:path";

export function episodesPath(projectRoot) {
  return path.join(projectRoot, ".cursor", "agent-episodes.jsonl");
}

function readLines(filePath) {
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

/** Append one ISR-derived episode (1 line JSON). */
export function appendEpisode(projectRoot, entry) {
  const p = episodesPath(projectRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });

  const row = {
    ts: new Date().toISOString(),
    source: entry.source ?? "isr",
    taskType: entry.taskType ?? "unknown",
    insight: String(entry.insight ?? entry.episodeInsight ?? "").slice(0, 512),
    skillId: entry.skillId ?? null,
    label: entry.label ?? null,
    pkeQueries: entry.pkeQueries ?? 0,
    grepCount: entry.grepCount ?? 0,
    readCount: entry.readCount ?? 0,
  };

  if (!row.insight) {
    return { ok: false, reason: "insight required" };
  }

  fs.appendFileSync(p, JSON.stringify(row) + "\n", "utf8");
  return { ok: true, episode: row };
}

export function readRecentEpisodes(projectRoot, limit = 8) {
  const lines = readLines(episodesPath(projectRoot));
  return lines.slice(-limit);
}

export function formatEpisodesText(episodes) {
  if (!episodes.length) return "episodes=0";
  const lines = [`episodes=${episodes.length}`];
  for (const e of episodes) {
    lines.push(
      `  ${e.ts?.slice(0, 10) ?? "?"} [${e.taskType}] ${e.skillId ?? "-"}: ${e.insight?.slice(0, 120)}`
    );
  }
  return lines.join("\n");
}
