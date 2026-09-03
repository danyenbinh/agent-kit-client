/**
 * PKE Phase 5 — changes/changelog.jsonl SSOT for git-import and asset batches.
 */
import fs from "node:fs";
import path from "node:path";

export const CHANGELOG_CAPS = {
  maxPathsPerEntry: 512,
  maxEntriesRead: 100,
  maxFileLines: 2000,
};

export function changesRoot(projectRoot) {
  return path.join(projectRoot, ".cursor", "project-knowledge", "changes");
}

export function changelogPath(projectRoot) {
  return path.join(changesRoot(projectRoot), "changelog.jsonl");
}

function normalizePath(p) {
  return String(p ?? "")
    .replace(/\\/g, "/")
    .trim();
}

function readJsonlLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim());
}

function parseEntry(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function trimChangelogFile(filePath) {
  const lines = readJsonlLines(filePath);
  if (lines.length <= CHANGELOG_CAPS.maxFileLines) return;
  const tail = lines.slice(-CHANGELOG_CAPS.maxFileLines);
  fs.writeFileSync(filePath, tail.join("\n") + (tail.length ? "\n" : ""), "utf8");
}

/**
 * Append one changelog entry; caps paths at 512.
 */
export function appendChangeEntry(projectRoot, entry) {
  const at = entry.at ?? new Date().toISOString();
  const reason = entry.reason ?? "git-import";
  const rawPaths = (entry.paths ?? []).map(normalizePath).filter(Boolean);
  const capsApplied = rawPaths.length > CHANGELOG_CAPS.maxPathsPerEntry;
  const paths = capsApplied
    ? rawPaths.slice(0, CHANGELOG_CAPS.maxPathsPerEntry)
    : rawPaths;

  const row = {
    at,
    reason,
    pathCount: rawPaths.length,
    paths,
    ...(entry.imported != null ? { imported: entry.imported } : {}),
    ...(entry.moved != null ? { moved: entry.moved } : {}),
    ...(entry.deleted != null ? { deleted: entry.deleted } : {}),
    ...(capsApplied ? { capsApplied: true } : {}),
  };

  const outPath = changelogPath(projectRoot);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.appendFileSync(outPath, JSON.stringify(row) + "\n", "utf8");
  trimChangelogFile(outPath);
  return row;
}

/**
 * Read changelog entries (newest last in file; returned newest-first).
 */
export function readChangeEntries(projectRoot, options = {}) {
  const lines = readJsonlLines(changelogPath(projectRoot));
  const sinceMs = options.since ? Date.parse(options.since) : null;
  const reasonFilter = options.reason?.trim() || null;
  const limit = Math.min(Math.max(options.limit ?? 20, 1), CHANGELOG_CAPS.maxEntriesRead);

  const entries = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    const e = parseEntry(lines[i]);
    if (!e?.at) continue;
    if (sinceMs != null && !Number.isNaN(sinceMs) && Date.parse(e.at) < sinceMs) continue;
    if (reasonFilter && e.reason !== reasonFilter) continue;
    entries.push(e);
  }
  return entries;
}

/**
 * MCP helper — paths changed since timestamp.
 */
export function getChangedSince(projectRoot, options = {}) {
  const since =
    options.since?.trim() ||
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const entries = readChangeEntries(projectRoot, {
    since,
    reason: options.reason,
    limit: options.limit ?? 20,
  });

  const pathSet = new Set();
  const reasons = new Set();
  for (const e of entries) {
    reasons.add(e.reason);
    for (const p of e.paths ?? []) pathSet.add(normalizePath(p));
  }

  const paths = [...pathSet].sort();
  const compact = {
    since,
    entries: entries.length,
    pathCount: paths.length,
    paths: paths.slice(0, CHANGELOG_CAPS.maxPathsPerEntry),
    reasons: [...reasons],
  };

  const lines = [
    "status=ok",
    `since=${since}`,
    `entries=${entries.length}`,
    `pathCount=${paths.length}`,
    `reasons=${[...reasons].join(",") || "none"}`,
  ];
  if (!paths.length) lines.push("hits=0");
  else {
    lines.push(`hits=${Math.min(paths.length, 48)}`);
    for (const p of paths.slice(0, 48)) lines.push(p);
  }

  return {
    text: lines.join("\n"),
    isError: false,
    since,
    entries,
    paths,
    compact,
  };
}
