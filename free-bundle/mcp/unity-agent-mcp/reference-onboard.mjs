/**
 * PKE Phase 4.2 — onboard reference index (jsonl SSOT).
 */
import fs from "node:fs";
import { invokeBridgeBatch } from "./invoke-bridge-batch.mjs";
import {
  buildReferenceIndex,
  readPkeReferencesFresh,
  readReferencesSubManifest,
  referencesJsonlPath,
} from "./reference-index.mjs";
import { syncReferencesManifestFromNode } from "./project-knowledge.mjs";

export function readPkeReferencesFormat(projectRoot) {
  return readReferencesSubManifest(projectRoot)?.formatVersion ?? null;
}

/** True when jsonl missing, format < 2, or PKE references stale. */
export function needsReferenceOnboardScan(projectRoot) {
  if (!fs.existsSync(referencesJsonlPath(projectRoot))) return true;

  const format = readPkeReferencesFormat(projectRoot);
  if (!format || format < 2) return true;

  const fresh = readPkeReferencesFresh(projectRoot);
  if (fresh !== true) return true;

  return false;
}

/**
 * Unity bridge rebuild or offline Node build + manifest sync.
 * @returns {Promise<object>}
 */
export async function tryOnboardReferenceBuild(projectRoot, options = {}) {
  const { force = false } = options;

  if (!force && !needsReferenceOnboardScan(projectRoot)) {
    const sub = readReferencesSubManifest(projectRoot);
    return {
      ok: true,
      skipped: true,
      reason: "references already indexed",
      edgeCount: sub?.edgeCount ?? 0,
      formatVersion: sub?.formatVersion ?? 2,
      referencesFresh: readPkeReferencesFresh(projectRoot),
    };
  }

  const batch = await invokeBridgeBatch(
    projectRoot,
    [
      { command: "ping" },
      { command: "rebuild_reference_index", args: { skipIfFresh: force ? "false" : "true" } },
    ],
    { timeoutMs: 120_000 }
  );

  const ping = batch.results.find((r) => r.command === "ping");
  if (ping?.ok) {
    const refresh = batch.results.find((r) => r.command === "rebuild_reference_index");
    const sub = readReferencesSubManifest(projectRoot);
    return {
      ok: refresh?.ok !== false,
      skipped: false,
      bridge: true,
      edgeCount: sub?.edgeCount ?? 0,
      formatVersion: sub?.formatVersion ?? null,
      referencesFresh: readPkeReferencesFresh(projectRoot),
      indexHealth: refresh?.data?.indexHealth ?? null,
    };
  }

  try {
    const built = buildReferenceIndex(projectRoot, { reason: "onboard-offline" });
    syncReferencesManifestFromNode(projectRoot, {
      edgeCount: built.edgeCount,
      reason: "onboard-offline",
    });
    return {
      ok: true,
      skipped: false,
      bridge: false,
      offline: true,
      edgeCount: built.edgeCount,
      formatVersion: built.subManifest?.formatVersion ?? 2,
      referencesFresh: true,
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
