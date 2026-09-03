/**
 * PKE Phase 3.4 — onboard full scan of enabled build scenes via Unity bridge.
 */
import fs from "node:fs";
import { invokeBridgeBatch } from "./invoke-bridge-batch.mjs";
import {
  readPkeScenesFresh,
  readSceneDigest,
  scenesDir,
} from "./project-knowledge.mjs";
import { readBuildScenesManifest } from "./scene-build-index.mjs";

export function listExpectedBuildSceneNames(projectRoot) {
  const build = readBuildScenesManifest(projectRoot);
  return (build.enabled || []).map((s) => s.name).filter(Boolean);
}

export function countSceneDigests(projectRoot) {
  const dir = scenesDir(projectRoot);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

export function missingSceneDigestNames(projectRoot) {
  return listExpectedBuildSceneNames(projectRoot).filter(
    (name) => !readSceneDigest(projectRoot, name)?.sceneName
  );
}

/** True when first onboard scan or PKE scenes subsystem stale. */
export function needsSceneOnboardScan(projectRoot) {
  const names = listExpectedBuildSceneNames(projectRoot);
  if (!names.length) return false;

  if (missingSceneDigestNames(projectRoot).length > 0) return true;

  const fresh = readPkeScenesFresh(projectRoot);
  if (fresh === false) return true;

  return countSceneDigests(projectRoot) === 0;
}

/**
 * Ping + refresh_build_scene_index when Unity bridge available.
 * @returns {Promise<object>}
 */
export async function tryOnboardBuildSceneScan(projectRoot, options = {}) {
  const { force = false } = options;

  if (!force && !needsSceneOnboardScan(projectRoot)) {
    return {
      ok: true,
      skipped: true,
      reason: "scenes already indexed",
      sceneCount: countSceneDigests(projectRoot),
      scenesFresh: readPkeScenesFresh(projectRoot),
    };
  }

  const batch = await invokeBridgeBatch(
    projectRoot,
    [
      { command: "ping" },
      { command: "refresh_build_scene_index", args: { restoreScene: true } },
    ],
    { timeoutMs: 120_000 }
  );

  const ping = batch.results.find((r) => r.command === "ping");
  if (!ping?.ok) {
    return {
      ok: false,
      skipped: true,
      reason: "Unity bridge unavailable",
      bridgeOk: false,
      timedOut: batch.timedOut,
    };
  }

  const refresh = batch.results.find((r) => r.command === "refresh_build_scene_index");
  if (!refresh?.ok) {
    return {
      ok: false,
      skipped: false,
      reason: refresh?.error || "refresh_build_scene_index failed",
      bridgeOk: true,
      timedOut: batch.timedOut,
    };
  }

  const data = refresh.data?.refreshBuildSceneIndex ?? {};
  return {
    ok: true,
    skipped: false,
    refreshed: data.refreshed ?? 0,
    skippedScenes: data.skipped ?? 0,
    written: data.written ?? [],
    restoredScene: data.restoredScene ?? null,
    sceneCount: countSceneDigests(projectRoot),
    scenesFresh: readPkeScenesFresh(projectRoot),
    elapsedMs: batch.elapsedMs,
  };
}
