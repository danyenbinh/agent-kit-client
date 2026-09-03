/**
 * PKE Phase 7 — onboard live index (Unity bridge full scan or offline fallback).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { applyIndexDelta } from "./codebase-index.mjs";
import { buildModuleAnchors } from "./codebase-layers.mjs";
import { clearStaleMarker } from "./project-profile.mjs";
import { invokeBridgeBatch } from "./invoke-bridge-batch.mjs";
import { buildReferenceIndex } from "./reference-index.mjs";
import {
  compactManifest,
  manifestPath,
  readManifestHealth,
  readPkeScenesFresh,
  syncCsharpManifestFromNode,
  syncReferencesManifestFromNode,
} from "./project-knowledge.mjs";
import { readPkeReferencesFresh } from "./reference-index.mjs";

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readSummaryStats(projectRoot) {
  const summaryPath = path.join(projectRoot, ".cursor", "codebase-index", "project-summary.json");
  const summary = readJsonSafe(summaryPath);
  const stats = summary?.stats ?? summary ?? {};
  return {
    csharpFiles: stats.files ?? 0,
    types: stats.types ?? 0,
    modules: stats.modules ?? 0,
  };
}

/** True when PKE manifest missing or aggregate/subsystem not fresh. */
export function needsLiveIndexOnboard(projectRoot) {
  const mp = manifestPath(projectRoot);
  if (!fs.existsSync(mp)) return true;

  const m = readJsonSafe(mp);
  if (!m) return true;
  if (m.fresh !== true) return true;

  const cs = m.subsystems?.csharp ?? {};
  if (cs.enabled !== false && cs.fresh !== true) return true;

  return false;
}

function runCsharpDeltaOffline(projectRoot) {
  const script = path.join(projectRoot, "cursor-agent-kit", "scripts", "pke-apply-csharp-delta.mjs");
  if (fs.existsSync(script)) {
    const r = spawnSync(process.execPath, [script], {
      cwd: projectRoot,
      env: { ...process.env, AGENT_PROJECT_ROOT: projectRoot },
      encoding: "utf8",
    });
    const out = (r.stdout || "") + (r.stderr || "");
    if (r.status === 0) {
      for (const line of out.split(/\r?\n/)) {
        const trim = line.trim();
        if (!trim.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(trim);
          if (parsed.ok) {
            return {
              ok: true,
              csharpFiles: parsed.files ?? 0,
              types: parsed.types ?? 0,
              modules: parsed.modules ?? 0,
            };
          }
        } catch {
          /* next line */
        }
      }
    }
  }

  const out = applyIndexDelta(projectRoot, {});
  clearStaleMarker(projectRoot);
  buildModuleAnchors(projectRoot);
  const stats = out.summary?.stats ?? readSummaryStats(projectRoot);
  return {
    ok: true,
    csharpFiles: stats.files ?? stats.csharpFiles ?? 0,
    types: stats.types ?? 0,
    modules: stats.modules ?? 0,
  };
}

/**
 * Unity bridge full PKE scan or offline csharp + references.
 * @returns {Promise<object>}
 */
export async function tryOnboardLiveIndex(projectRoot, options = {}) {
  const { force = false } = options;

  if (!force && !needsLiveIndexOnboard(projectRoot)) {
    const health = readManifestHealth(projectRoot);
    const c = health.compact ?? {};
    return {
      ok: true,
      skipped: true,
      reason: "PKE manifest already fresh",
      fresh: c.fresh === true,
      csharpFresh: c.csharpFresh,
      referencesFresh: c.referencesFresh,
      scenesFresh: c.scenesFresh,
      bridge: false,
    };
  }

  const skipIfFresh = force ? "false" : "true";
  const batch = await invokeBridgeBatch(
    projectRoot,
    [
      { command: "ping" },
      { command: "rebuild_code_index", args: { skipIfFresh, reason: "onboard-live-index" } },
      { command: "rebuild_reference_index", args: { skipIfFresh: "true" } },
      { command: "refresh_build_scene_index", args: { restoreScene: "true" } },
    ],
    { timeoutMs: 180_000 }
  );

  const ping = batch.results.find((r) => r.command === "ping");
  if (ping?.ok) {
    const refresh = batch.results.find((r) => r.command === "rebuild_code_index");
    const health = readManifestHealth(projectRoot);
    const c = health.compact ?? {};
    return {
      ok: refresh?.ok !== false,
      skipped: false,
      bridge: true,
      fresh: c.fresh === true,
      csharpFresh: c.csharpFresh,
      referencesFresh: c.referencesFresh,
      scenesFresh: c.scenesFresh,
      indexHealth: refresh?.data?.indexHealth ?? null,
      timedOut: batch.timedOut,
    };
  }

  try {
    const csharp = runCsharpDeltaOffline(projectRoot);
    syncCsharpManifestFromNode(projectRoot, {
      reason: "onboard-live-index-offline",
      csharpFiles: csharp.csharpFiles,
      types: csharp.types,
    });

    const built = buildReferenceIndex(projectRoot, { reason: "onboard-live-index-offline" });
    syncReferencesManifestFromNode(projectRoot, {
      edgeCount: built.edgeCount,
      reason: "onboard-live-index-offline",
    });

    const health = readManifestHealth(projectRoot);
    const c = health.compact ?? compactManifest(readJsonSafe(manifestPath(projectRoot)));
    return {
      ok: true,
      skipped: false,
      bridge: false,
      offline: true,
      fresh: c?.fresh === true,
      csharpFresh: c?.csharpFresh,
      referencesFresh: readPkeReferencesFresh(projectRoot),
      scenesFresh: readPkeScenesFresh(projectRoot),
      csharpFiles: csharp.csharpFiles,
      types: csharp.types,
      edgeCount: built.edgeCount,
      scenesPending: true,
    };
  } catch (e) {
    return {
      ok: false,
      skipped: true,
      reason: String(e?.message ?? e),
      bridgeOk: false,
    };
  }
}
