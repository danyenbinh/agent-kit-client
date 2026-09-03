/**
 * PKE Phase 9.5 — read playmode runtime errors from jsonl index.
 */
import fs from "node:fs";
import path from "node:path";

export function playmodeErrorsPath(projectRoot) {
  return path.join(projectRoot, ".cursor", "project-knowledge", "runtime", "playmode-errors.jsonl");
}

function readJsonl(filePath, limit = 50) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean);
  const slice = lines.slice(-limit);
  return slice
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    })
    .filter(Boolean);
}

export function readPlaymodeErrors(projectRoot, options = {}) {
  const limit = options.limit ?? 30;
  const p = playmodeErrorsPath(projectRoot);
  const entries = readJsonl(p, limit);
  const total = fs.existsSync(p)
    ? fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).length
    : 0;

  const lines = [
    `playmode_errors total=${total} showing=${entries.length}`,
    `path=${p}`,
  ];
  for (const e of entries) {
    lines.push(`--- ${e.ts ?? "?"} [${e.type ?? "?"}] scene=${e.scene ?? "?"}`);
    lines.push(String(e.message ?? e.raw ?? "").slice(0, 300));
  }
  if (total === 0) {
    lines.push("→ Enter Play mode; errors append on LogType Error/Exception");
  }

  return { text: lines.join("\n"), isError: false, total, entries };
}
