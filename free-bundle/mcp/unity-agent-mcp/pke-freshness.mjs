/**
 * PKE Phase 9.3 — manifest freshness validation for CI.
 */
import fs from "node:fs";
import { manifestPath, readManifestHealth } from "./project-knowledge.mjs";

const DEFAULT_MAX_AGE_HOURS = 24;

export function validatePkeFreshness(projectRoot, options = {}) {
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const mp = manifestPath(projectRoot);

  if (!fs.existsSync(mp)) {
    return {
      ok: false,
      status: "missing",
      message: "manifest.json missing",
      maxAgeHours,
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(mp, "utf8"));
  } catch {
    return { ok: false, status: "corrupt", message: "manifest corrupt", maxAgeHours };
  }

  const lastSync = manifest.lastSyncAt || manifest.subsystems?.csharp?.lastSyncAt;
  if (!lastSync) {
    return { ok: false, status: "stale", message: "lastSyncAt missing", maxAgeHours };
  }

  const ageMs = Date.now() - new Date(lastSync).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const fresh = manifest.fresh === true;
  const csharpFresh = manifest.subsystems?.csharp?.fresh === true;
  const withinAge = ageHours <= maxAgeHours;

  const ok = fresh && csharpFresh && withinAge;
  const health = readManifestHealth(projectRoot);

  return {
    ok,
    status: ok ? "fresh" : "stale",
    fresh,
    csharpFresh,
    ageHours: Math.round(ageHours * 10) / 10,
    maxAgeHours,
    lastSyncAt: lastSync,
    message: ok
      ? `manifest fresh age=${ageHours.toFixed(1)}h`
      : `manifest stale fresh=${fresh} csharpFresh=${csharpFresh} age=${ageHours.toFixed(1)}h max=${maxAgeHours}h`,
    compact: health.compact ?? null,
  };
}

export function formatFreshnessText(result) {
  const lines = [`status=${result.status}`, `ok=${result.ok}`, result.message];
  if (result.lastSyncAt) lines.push(`lastSyncAt=${result.lastSyncAt}`);
  if (!result.ok) {
    lines.push("→ Unity open + compile or unity_bridge_invoke rebuild_code_index");
    lines.push("→ node cursor-agent-kit/scripts/onboard-project.mjs --from-phase live_index");
  }
  return lines.join("\n");
}
