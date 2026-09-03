/**
 * Cross-device task handoff — domain-agnostic (universal meta).
 * SSOT: .cursor/task-handoff.json per project repo.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const HANDOFF_PHASES = ["implement", "test", "blocked", "done"];

export function handoffPath(projectRoot) {
  return path.join(projectRoot, ".cursor", "task-handoff.json");
}

export function readTaskHandoff(projectRoot) {
  const p = handoffPath(projectRoot);
  if (!fs.existsSync(p)) {
    return {
      exists: false,
      text: "task-handoff missing\n→ agent_update_task_handoff to start tracking",
      data: null,
    };
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const lines = [
      `handoff taskId=${data.taskId ?? "?"}`,
      `title=${data.title ?? "(untitled)"}`,
      `phase=${data.phase ?? "implement"}`,
      `domainPack=${data.domainPack ?? "general"}`,
      data.summary ? `summary=${data.summary}` : "",
      data.nextActions?.length ? `next:\n${data.nextActions.map((a) => `  - ${a}`).join("\n")}` : "",
      data.blockers?.length ? `blockers:\n${data.blockers.map((b) => `  - ${b}`).join("\n")}` : "",
      data.touchedFiles?.length ? `files=${data.touchedFiles.slice(0, 12).join(", ")}${data.touchedFiles.length > 12 ? "..." : ""}` : "",
      data.updatedAt ? `updatedAt=${data.updatedAt}` : "",
    ].filter(Boolean);
    return { exists: true, text: lines.join("\n"), data };
  } catch (e) {
    return { exists: true, text: `task-handoff parse error: ${e.message}`, data: null, isError: true };
  }
}

/**
 * @param {string} projectRoot
 * @param {object} patch — fields to merge; use clearTask=true to reset
 */
export function updateTaskHandoff(projectRoot, patch = {}) {
  const p = handoffPath(projectRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });

  if (patch.clearTask === true) {
    const empty = defaultHandoff();
    fs.writeFileSync(p, JSON.stringify(empty, null, 2) + "\n", "utf8");
    return { ok: true, data: empty, text: "handoff cleared" };
  }

  let current = defaultHandoff();
  if (fs.existsSync(p)) {
    try {
      current = { ...current, ...JSON.parse(fs.readFileSync(p, "utf8")) };
    } catch {
      /* overwrite corrupt */
    }
  }

  const next = { ...current };
  if (!next.taskId) next.taskId = randomUUID();

  const allowed = [
    "title",
    "summary",
    "phase",
    "domainPack",
    "nextActions",
    "touchedSkills",
    "touchedFiles",
    "blockers",
    "machineHint",
    "appendNextAction",
    "appendTouchedFile",
    "appendBlocker",
  ];

  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    if (key === "appendNextAction") {
      next.nextActions = [...(next.nextActions ?? []), patch.appendNextAction];
    } else if (key === "appendTouchedFile") {
      const set = new Set([...(next.touchedFiles ?? []), patch.appendTouchedFile]);
      next.touchedFiles = [...set];
    } else if (key === "appendBlocker") {
      next.blockers = [...(next.blockers ?? []), patch.appendBlocker];
    } else {
      next[key] = patch[key];
    }
  }

  if (next.phase && !HANDOFF_PHASES.includes(next.phase)) {
    throw new Error(`phase must be one of: ${HANDOFF_PHASES.join(", ")}`);
  }

  next.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(next, null, 2) + "\n", "utf8");
  const r = readTaskHandoff(projectRoot);
  return { ok: true, data: next, text: `handoff updated\n${r.text}` };
}

export function defaultHandoff() {
  return {
    taskId: "",
    title: "",
    phase: "implement",
    summary: "",
    domainPack: "general",
    nextActions: [],
    touchedSkills: [],
    touchedFiles: [],
    blockers: [],
    machineHint: "",
    updatedAt: "",
  };
}
