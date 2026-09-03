/**
 * PKE — read .cursor/project-knowledge/manifest.json (offline, no Unity).
 */
import fs from "node:fs";
import path from "node:path";
import { readIndexStatus } from "./project-profile.mjs";
import { findReferences as findReferencesIndex, readReferencesHealth, referencesManifestPath as refSubManifestPath } from "./reference-index.mjs";
import { getChangedSince as getChangedSinceChangelog } from "./change-changelog.mjs";

export { findReferencesIndex as findReferences };
export { getChangedSinceChangelog as getChangedSince };
export { queryScriptable } from "./scriptable-digest.mjs";
export {
  compactScriptableDigest,
  enforceScriptableDigestCaps,
  scriptablesDir,
  scriptableDigestPath,
  SCRIPTABLE_DIGEST_CAPS,
} from "./scriptable-digest.mjs";

function readReferencesSubManifestInline(projectRoot) {
  try {
    return JSON.parse(fs.readFileSync(refSubManifestPath(projectRoot), "utf8"));
  } catch {
    return null;
  }
}

/** Offline onboard — mark references subsystem fresh after Node build. */
export function syncReferencesManifestFromNode(projectRoot, options = {}) {
  const mp = manifestPath(projectRoot);
  const edgeCount = options.edgeCount ?? 0;
  const reason = options.reason ?? "onboard-offline";
  const at = new Date().toISOString();

  let data = readJsonSafe(mp);
  if (!data) {
    data = {
      schemaVersion: 1,
      pkeVersion: "1.0.0",
      fresh: false,
      counts: {},
      subsystems: {},
      legacy: { codebaseIndexStale: false },
    };
  }

  data.counts = data.counts ?? {};
  data.counts.references = edgeCount;
  data.subsystems = data.subsystems ?? {};
  data.subsystems.references = data.subsystems.references ?? {};
  data.subsystems.references.enabled = true;
  data.subsystems.references.fresh = true;
  data.subsystems.references.lastSyncAt = at;
  data.subsystems.references.error = null;
  data.lastSyncAt = at;
  data.lastTrigger = data.lastTrigger ?? {};
  data.lastTrigger.reason = reason;
  data.lastTrigger.at = at;

  const subs = data.subsystems;
  let allFresh = true;
  for (const key of ["csharp", "prefabs", "scenes", "references", "scriptables"]) {
    const s = subs[key];
    if (s?.enabled && !s.fresh) allFresh = false;
  }
  data.fresh = allFresh;

  fs.mkdirSync(path.dirname(mp), { recursive: true });
  fs.writeFileSync(mp, JSON.stringify(data, null, 2) + "\n", "utf8");
  return data;
}

/** Offline onboard — mark csharp subsystem fresh after Node index build. */
export function syncCsharpManifestFromNode(projectRoot, options = {}) {
  const mp = manifestPath(projectRoot);
  const reason = options.reason ?? "onboard-offline";
  const at = new Date().toISOString();
  const csharpFiles = options.csharpFiles ?? options.files ?? 0;
  const types = options.types ?? 0;

  let data = readJsonSafe(mp);
  if (!data) {
    data = {
      schemaVersion: 1,
      pkeVersion: "1.0.0",
      fresh: false,
      counts: {},
      subsystems: {},
      legacy: { codebaseIndexStale: true },
    };
  }

  data.counts = data.counts ?? {};
  data.counts.csharpFiles = csharpFiles;
  data.counts.types = types;
  data.subsystems = data.subsystems ?? {};
  data.subsystems.csharp = data.subsystems.csharp ?? {};
  data.subsystems.csharp.enabled = true;
  data.subsystems.csharp.fresh = true;
  data.subsystems.csharp.lastSyncAt = at;
  data.subsystems.csharp.error = null;
  data.legacy = data.legacy ?? {};
  data.legacy.codebaseIndexStale = false;
  data.lastSyncAt = at;
  data.lastTrigger = data.lastTrigger ?? {};
  data.lastTrigger.reason = reason;
  data.lastTrigger.at = at;

  const subs = data.subsystems;
  let allFresh = true;
  for (const key of ["csharp", "prefabs", "scenes", "references", "scriptables"]) {
    const s = subs[key];
    if (s?.enabled && !s.fresh) allFresh = false;
  }
  data.fresh = allFresh;

  fs.mkdirSync(path.dirname(mp), { recursive: true });
  fs.writeFileSync(mp, JSON.stringify(data, null, 2) + "\n", "utf8");
  return data;
}

export function manifestPath(projectRoot) {
  return path.join(projectRoot, ".cursor", "project-knowledge", "manifest.json");
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function compactManifest(m) {
  if (!m) return null;
  const cs = m.subsystems?.csharp ?? {};
  const sc = m.subsystems?.scenes ?? {};
  const rf = m.subsystems?.references ?? {};
  const so = m.subsystems?.scriptables ?? {};
  const fresh = !!m.fresh;
  return {
    fresh,
    stale: !fresh,
    pkeVersion: m.pkeVersion,
    lastSyncAt: m.lastSyncAt,
    trigger: m.lastTrigger?.reason,
    triggerAt: m.lastTrigger?.at,
    csharpFiles: m.counts?.csharpFiles ?? 0,
    types: m.counts?.types ?? 0,
    csharpFresh: cs.fresh,
    csharpError: cs.error ?? null,
    scenesCount: m.counts?.scenes ?? 0,
    scenesFresh: sc.enabled ? !!sc.fresh : null,
    scenesError: sc.error ?? null,
    referencesCount: m.counts?.references ?? 0,
    referencesFresh: rf.enabled ? !!rf.fresh : null,
    referencesError: rf.error ?? null,
    scriptablesCount: m.counts?.scriptables ?? 0,
    scriptablesFresh: so.enabled ? !!so.fresh : null,
    scriptablesError: so.error ?? null,
    legacyCodebaseStale: m.legacy?.codebaseIndexStale ?? false,
    legacyUnityBridgeSceneIndex: m.legacy?.unityBridgeSceneIndex ?? false,
  };
}

function formatManifestText(compact, m, verbose, projectRoot) {
  const status = compact.fresh ? "fresh" : "stale";
  const lines = [
    `status=${status}`,
    `csharpFiles=${compact.csharpFiles} types=${compact.types} trigger=${compact.trigger ?? "?"}`,
    `lastSyncAt=${compact.lastSyncAt ?? "never"} legacyStale=${compact.legacyCodebaseStale}`,
  ];
  if (verbose && m) {
    lines.push(
      `prefabs=${m.counts?.prefabs ?? 0} scenes=${m.counts?.scenes ?? 0} pkeVersion=${m.pkeVersion ?? "?"}`
    );
    const cs = m.subsystems?.csharp ?? {};
    const sc = m.subsystems?.scenes ?? {};
    const rf = m.subsystems?.references ?? {};
    const so = m.subsystems?.scriptables ?? {};
    lines.push(`csharp enabled=${cs.enabled} fresh=${cs.fresh}`);
    lines.push(`scenes enabled=${sc.enabled} fresh=${sc.fresh}`);
    lines.push(`references enabled=${rf.enabled} fresh=${rf.fresh} edges=${m.counts?.references ?? 0}`);
    lines.push(`scriptables enabled=${so.enabled} fresh=${so.fresh} count=${m.counts?.scriptables ?? 0}`);
    const subManifest = readReferencesSubManifestInline(projectRoot);
    if (subManifest?.formatVersion) lines.push(`referencesFormat=${subManifest.formatVersion}`);
  }
  if (compact.csharpError) lines.push(`csharpError=${compact.csharpError}`);
  if (compact.scenesError) lines.push(`scenesError=${compact.scenesError}`);
  if (compact.referencesError) lines.push(`referencesError=${compact.referencesError}`);
  if (compact.scriptablesError) lines.push(`scriptablesError=${compact.scriptablesError}`);
  if (compact.fresh) lines.push("→ agent_find_in_module / unity-code-map / agent_find_references");
  else lines.push("→ unity_bridge_invoke rebuild_code_index or wait for compile delta");
  if (compact.scenesFresh === false) lines.push("→ Save scene in Unity or unity_refresh_build_scene_index");
  if (compact.referencesFresh === false) lines.push("→ unity_bridge_invoke rebuild_reference_index or wait for csharp-sync");
  if (compact.scriptablesFresh === false) lines.push("→ enable SO tracking + reimport or unity_bridge_invoke rebuild_scriptable_digest");
  return lines.join("\n");
}

function missingManifestResult(projectRoot, verbose) {
  const legacy = readIndexStatus(projectRoot);
  const fresh = false;
  const lines = [
    "status=stale",
    `manifest=missing legacyIndex=${legacy.hasIndex} legacyStale=${legacy.stale}`,
  ];
  if (verbose) {
    lines.push(`indexBuiltAt=${legacy.indexBuiltAt ?? "never"}`);
  }
  lines.push("→ unity_bridge_invoke rebuild_code_index");
  lines.push("→ agent_apply_index_delta (MCP fallback, Unity off)");
  return {
    text: lines.join("\n"),
    isError: !legacy.hasIndex,
    fresh,
    stale: true,
    compact: null,
  };
}

export function readManifestHealth(projectRoot, options = {}) {
  const verbose = options.verbose === true;
  const mp = manifestPath(projectRoot);

  if (!fs.existsSync(mp)) {
    return missingManifestResult(projectRoot, verbose);
  }

  const m = readJsonSafe(mp);
  if (!m) {
    return {
      text: "status=stale\nmanifest=corrupt\n→ delete .cursor/project-knowledge/manifest.json then rebuild_code_index",
      isError: true,
      fresh: false,
      stale: true,
      compact: null,
    };
  }

  const compact = compactManifest(m);
  const refH = readReferencesHealth(projectRoot);
  if (compact) {
    compact.referenceSymbols = refH.referenceSymbols;
    compact.referenceEdges = refH.referenceEdges;
    compact.referencesFormat = refH.referencesFormat ?? null;
    if (compact.referencesFresh == null) compact.referencesFresh = refH.referencesFresh;
  }
  return {
    text: formatManifestText(compact, m, verbose, projectRoot),
    isError: false,
    fresh: compact.fresh,
    stale: compact.stale,
    compact,
  };
}

// --- Prefab fingerprint (Phase 2.3+) ---

/** SSOT caps — mirror pke-prefab-fingerprint.schema.json */
export const PREFAB_FINGERPRINT_CAPS = {
  maxComponents: 32,
  maxScriptTypes: 16,
  maxNamedRoots: 24,
  maxMissingRefs: 32,
  defaultSummaryDepth: 3,
  maxRootNameLength: 128,
  maxTypeNameLength: 128,
  maxGameObjectPathLength: 512,
  maxPropertyNameLength: 128,
};

function truncateStr(value, maxLen) {
  if (value == null || typeof value !== "string") return "";
  return value.length <= maxLen ? value : value.slice(0, maxLen);
}

export function enforceFingerprintCaps(fp) {
  if (!fp || fp.schemaVersion !== 1) return null;
  const caps = PREFAB_FINGERPRINT_CAPS;
  const out = { ...fp };
  out.rootName = truncateStr(out.rootName, caps.maxRootNameLength);
  out.components = (out.components ?? []).slice(0, caps.maxComponents).map((c) => ({
    type: truncateStr(c.type, caps.maxTypeNameLength),
    ...(c.scriptType ? { scriptType: truncateStr(c.scriptType, caps.maxTypeNameLength) } : {}),
    gameObjectPath: truncateStr(c.gameObjectPath ?? "", caps.maxGameObjectPathLength),
  }));
  out.scriptTypes = [...new Set((out.scriptTypes ?? []).map((s) => truncateStr(s, caps.maxTypeNameLength)))].slice(
    0,
    caps.maxScriptTypes
  );
  out.missingRefs = (out.missingRefs ?? []).slice(0, caps.maxMissingRefs).map((m) => ({
    component: truncateStr(m.component, caps.maxTypeNameLength),
    property: truncateStr(m.property, caps.maxPropertyNameLength),
    gameObjectPath: truncateStr(m.gameObjectPath ?? "", caps.maxGameObjectPathLength),
  }));
  out.hasMissingRefs = out.missingRefs.length > 0;
  if (out.childrenSummary?.namedRoots) {
    out.childrenSummary = {
      maxDepth: out.childrenSummary.maxDepth ?? caps.defaultSummaryDepth,
      namedRoots: out.childrenSummary.namedRoots.slice(0, caps.maxNamedRoots).map((n) => ({
        name: truncateStr(n.name, caps.maxRootNameLength),
        path: truncateStr(n.path, caps.maxGameObjectPathLength),
        childCount: n.childCount ?? 0,
      })),
    };
  }
  return out;
}

export function prefabsDir(projectRoot) {
  return path.join(projectRoot, ".cursor", "project-knowledge", "prefabs");
}

export function prefabFingerprintPath(projectRoot, guid) {
  return path.join(prefabsDir(projectRoot), `${normalizeGuid(guid)}.json`);
}

export function normalizeGuid(input) {
  if (!input || typeof input !== "string") return "";
  return input.replace(/-/g, "").toLowerCase();
}

export function normalizeAssetPath(assetPath) {
  if (!assetPath || typeof assetPath !== "string") return "";
  return assetPath.replace(/\\/g, "/").trim();
}

/** Phase 2.7 — mirror ProjectKnowledgeAssetFilter exclusions (C# SSOT). */
export const PKE_EXCLUDED_PATH_PREFIXES = ["Library/", "Temp/", "Packages/"];

export const PKE_EXCLUDED_PATH_SEGMENTS = [
  "/Library/",
  "/Temp/",
  "/PackageCache/",
];

export function isExcludedAssetPath(assetPath) {
  const normalized = normalizeAssetPath(assetPath);
  if (!normalized) return true;
  const lower = normalized.toLowerCase();
  for (const prefix of PKE_EXCLUDED_PATH_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) return true;
  }
  for (const segment of PKE_EXCLUDED_PATH_SEGMENTS) {
    if (lower.includes(segment.toLowerCase())) return true;
  }
  return false;
}

export function isTrackableAssetPath(assetPath) {
  const normalized = normalizeAssetPath(assetPath);
  if (!normalized.startsWith("Assets/")) return false;
  return !isExcludedAssetPath(normalized);
}

export function guidFromAssetMeta(projectRoot, assetPath) {
  const normalized = normalizeAssetPath(assetPath);
  if (!isTrackableAssetPath(normalized)) return null;
  const metaPath = path.join(projectRoot, `${normalized}.meta`);
  if (!fs.existsSync(metaPath)) return null;
  try {
    const text = fs.readFileSync(metaPath, "utf8");
    const match = text.match(/^guid:\s*([a-f0-9]{32})/im);
    return match ? normalizeGuid(match[1]) : null;
  } catch {
    return null;
  }
}

export function isValidGuid(normalized) {
  return (
    typeof normalized === "string" &&
    normalized.length === 32 &&
    /^[a-f0-9]{32}$/.test(normalized)
  );
}

export function findGuidByPathInIndex(projectRoot, assetPath) {
  const normalized = normalizeAssetPath(assetPath);
  if (!isTrackableAssetPath(normalized)) return null;

  const dir = prefabsDir(projectRoot);
  if (!fs.existsSync(dir)) return null;

  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const fp = readJsonSafe(path.join(dir, name));
    if (!fp?.path) continue;
    if (normalizeAssetPath(fp.path) === normalized) {
      const fromFile = normalizeGuid(fp.guid);
      if (isValidGuid(fromFile)) return fromFile;
      const fromName = normalizeGuid(name.slice(0, -5));
      if (isValidGuid(fromName)) return fromName;
    }
  }
  return null;
}

function crossValidatePathGuid(projectRoot, normalizedPath, fromGuid) {
  const metaGuid = guidFromAssetMeta(projectRoot, normalizedPath);
  if (metaGuid && metaGuid !== fromGuid) return "path_guid_mismatch";

  const indexGuid = findGuidByPathInIndex(projectRoot, normalizedPath);
  if (indexGuid && indexGuid !== fromGuid) return "path_guid_mismatch";

  const fpPath = prefabFingerprintPath(projectRoot, fromGuid);
  if (fs.existsSync(fpPath)) {
    const fp = readJsonSafe(fpPath);
    if (fp?.path && normalizeAssetPath(fp.path) !== normalizedPath) {
      return "path_guid_mismatch";
    }
  }

  return null;
}

export function resolvePrefabLookup(projectRoot, { path: assetPath, guid }) {
  const normalizedPath = assetPath ? normalizeAssetPath(assetPath) : null;
  if (normalizedPath && isExcludedAssetPath(normalizedPath)) {
    return { guid: null, assetPath: normalizedPath, error: "excluded_path" };
  }
  if (normalizedPath && !normalizedPath.startsWith("Assets/")) {
    return { guid: null, assetPath: normalizedPath, error: "invalid_path" };
  }
  const hasPathInput = !!normalizedPath && isTrackableAssetPath(normalizedPath);
  const rawGuid = guid != null && String(guid).trim() !== "" ? String(guid).trim() : "";
  const hasGuidInput = rawGuid.length > 0;
  const fromGuid = normalizeGuid(rawGuid);

  if (hasGuidInput && !isValidGuid(fromGuid)) {
    return { guid: null, assetPath: normalizedPath, error: "invalid_guid" };
  }

  if (isValidGuid(fromGuid) && hasPathInput) {
    const mismatch = crossValidatePathGuid(projectRoot, normalizedPath, fromGuid);
    if (mismatch) {
      return { guid: fromGuid, assetPath: normalizedPath, error: mismatch };
    }
    return { guid: fromGuid, assetPath: normalizedPath };
  }

  if (isValidGuid(fromGuid)) {
    return { guid: fromGuid, assetPath: null };
  }

  if (hasPathInput) {
    const resolvedGuid =
      guidFromAssetMeta(projectRoot, normalizedPath) ||
      findGuidByPathInIndex(projectRoot, normalizedPath);
    return { guid: resolvedGuid, assetPath: normalizedPath };
  }

  return { guid: null, assetPath: null };
}

export function compactPrefabFingerprint(fp, options = {}) {
  const normalized = enforceFingerprintCaps(fp);
  if (!normalized) return null;
  const verbose = options.verbose === true;
  const hasMissingRefs = !!normalized.hasMissingRefs;
  const compact = {
    path: normalized.path ?? "",
    guid: normalizeGuid(normalized.guid),
    root: normalized.rootName ?? "",
    childCount: normalized.childCount ?? 0,
    components: normalized.components ?? [],
    scriptTypes: normalized.scriptTypes ?? [],
    hasMissingRefs,
    missingRefs: hasMissingRefs || verbose ? normalized.missingRefs ?? [] : [],
  };
  if (normalized.capsApplied && Object.values(normalized.capsApplied).some(Boolean)) {
    compact.capsApplied = normalized.capsApplied;
  }
  if (verbose) {
    compact.updatedAt = normalized.updatedAt ?? null;
    compact.childrenSummary = normalized.childrenSummary ?? null;
  }
  return compact;
}

function formatPrefabFingerprintText(status, compact, lookup) {
  const lines = [`status=${status}`];
  if (lookup?.assetPath) lines.push(`path=${lookup.assetPath}`);
  if (lookup?.guid) lines.push(`guid=${lookup.guid}`);

  if (status === "ok" && compact) {
    lines.push(
      `root=${compact.root} childCount=${compact.childCount} scripts=${compact.scriptTypes.length} components=${compact.components.length} hasMissingRefs=${compact.hasMissingRefs}`
    );
    lines.push("→ use compact JSON; do not Read prefab YAML");
  } else if (status === "missing") {
    lines.push("meta=missing or path invalid");
    lines.push("→ unity_bridge_invoke rebuild_prefab_fingerprint args path=...");
  } else if (status === "stale") {
    lines.push("fingerprint=missing on disk");
    lines.push("→ save/reimport prefab in Unity or unity_bridge_invoke rebuild_prefab_fingerprint");
  } else if (status === "corrupt") {
    lines.push("fingerprint=corrupt JSON");
    lines.push("→ unity_bridge_invoke rebuild_prefab_fingerprint");
  } else if (status === "error") {
    lines.push(`error=${lookup?.error ?? "unknown"}`);
    if (lookup?.error === "invalid_guid") {
      lines.push("hint=guid must be 32 hex characters (dashes optional)");
    } else if (lookup?.error === "path_guid_mismatch") {
      lines.push("hint=path and guid refer to different prefabs");
    } else if (lookup?.error === "excluded_path") {
      lines.push("hint=path is Library/Temp/Packages/package-cache — not indexed");
    }
  }
  return lines.join("\n");
}

export function readPrefabFingerprint(projectRoot, options = {}) {
  const verbose = options.verbose === true;
  const lookup = resolvePrefabLookup(projectRoot, {
    path: options.path,
    guid: options.guid,
  });

  if (lookup.error) {
    return {
      text: formatPrefabFingerprintText("error", null, lookup),
      isError: true,
      status: "error",
      compact: null,
    };
  }

  if (!lookup.guid) {
    return {
      text: formatPrefabFingerprintText("missing", null, lookup),
      isError: true,
      status: "missing",
      compact: null,
    };
  }

  const fpPath = prefabFingerprintPath(projectRoot, lookup.guid);
  if (!fs.existsSync(fpPath)) {
    return {
      text: formatPrefabFingerprintText("stale", null, lookup),
      isError: true,
      status: "stale",
      compact: null,
    };
  }

  const fp = readJsonSafe(fpPath);
  const compact = compactPrefabFingerprint(fp, { verbose });
  if (!compact) {
    return {
      text: formatPrefabFingerprintText("corrupt", null, lookup),
      isError: true,
      status: "corrupt",
      compact: null,
    };
  }

  if (!lookup.assetPath && compact.path) {
    lookup.assetPath = compact.path;
  }

  return {
    text: formatPrefabFingerprintText("ok", compact, lookup),
    isError: false,
    status: "ok",
    compact,
  };
}

export function auditPrefabFolder(projectRoot, folderPath, options = {}) {
  const includeAll = options.includeAll === true;
  const folder = normalizeAssetPath(folderPath);
  if (!folder.startsWith("Assets/") || isExcludedAssetPath(folder)) {
    return {
      text: "status=error\nfolder must be under Assets/ (excludes Library, Temp, Packages, PackageCache)",
      isError: true,
      compact: [],
      audited: 0,
      missingRefs: 0,
    };
  }

  const dir = prefabsDir(projectRoot);
  if (!fs.existsSync(dir)) {
    return {
      text: `status=empty\naudited=0 missingRefs=0\nfolder=${folder}\n→ no prefabs indexed yet`,
      isError: false,
      compact: [],
      audited: 0,
      missingRefs: 0,
    };
  }

  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  const exactFolder = folder;
  const entries = [];
  let audited = 0;
  let missingRefCount = 0;

  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const fp = readJsonSafe(path.join(dir, name));
    const compact = compactPrefabFingerprint(enforceFingerprintCaps(fp), { verbose: true });
    if (!compact?.path) continue;
    const inFolder =
      compact.path === exactFolder ||
      compact.path.startsWith(prefix) ||
      compact.path.startsWith(`${folder}/`);
    if (!inFolder) continue;
    audited++;
    if (compact.hasMissingRefs) {
      missingRefCount++;
      entries.push(compact);
    } else if (includeAll) {
      entries.push(compact);
    }
  }

  const sample = entries
    .slice(0, 5)
    .map((e) => e.path)
    .join(", ");
  const lines = [
    `status=ok`,
    `audited=${audited} missingRefs=${missingRefCount} folder=${folder}`,
  ];
  if (sample) lines.push(`sample=${sample}`);
  if (audited === 0) lines.push("→ no fingerprints in folder; reimport prefabs or rebuild_prefab_fingerprint");

  return {
    text: lines.join("\n"),
    isError: false,
    compact: entries,
    audited,
    missingRefs: missingRefCount,
  };
}

// --- Scene digest (Phase 3.1+) ---

export function scenesDir(projectRoot) {
  return path.join(projectRoot, ".cursor", "project-knowledge", "scenes");
}

export function sceneDigestPath(projectRoot, sceneName) {
  return path.join(scenesDir(projectRoot), `${sceneName}.json`);
}

export function readSceneDigest(projectRoot, sceneName) {
  if (!sceneName) return null;
  return readJsonSafe(sceneDigestPath(projectRoot, sceneName));
}

export const ROLE_HINT_CAPS = {
  maxSamplePathsPerRole: 4,
  maxRoleHintGroups: 16,
};

/** Parity SceneKnowledgeBuilder.BuildRoleHints — derive or validate stored roleHints. */
export function buildRoleHints(anchors) {
  if (!anchors?.length) return [];

  const groups = new Map();
  for (const node of anchors) {
    if (!node?.p) continue;
    const role = node.r || "?";
    if (!groups.has(role)) groups.set(role, []);
    const paths = groups.get(role);
    if (paths.length < ROLE_HINT_CAPS.maxSamplePathsPerRole) paths.push(node.p);
  }

  for (const paths of groups.values()) paths.sort();

  return [...groups.entries()]
    .map(([role, paths]) => ({
      role,
      count: anchors.filter((a) => a && (a.r || "?") === role).length,
      paths,
    }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role))
    .slice(0, ROLE_HINT_CAPS.maxRoleHintGroups);
}

function roleHintsSummaryLine(roleHints) {
  return (roleHints || []).map((h) => `${h.role}:${h.count}`).join(" ");
}

/** L1.5 compact anchors text (~50–150 tok) from PKE digest or synthetic digest. */
export function compactSceneAnchors(digest, options = {}) {
  const anchors = digest?.anchors ?? [];
  const roleHints = digest?.roleHints?.length ? digest.roleHints : buildRoleHints(anchors);
  const sceneName = digest?.sceneName ?? "?";
  const {
    purpose,
    gameMode,
    readClassNext,
    source = "pke",
  } = options;

  const lines = [
    `${sceneName} purpose=${purpose ?? "see unity-scene-map"}`,
    `flow=${gameMode ?? "?"}`,
    `anchors=${anchors.length} source=${source}`,
    `roles=${roleHintsSummaryLine(roleHints)}`,
    "--- path → role [components] ---",
  ];

  for (const n of anchors) {
    const comps = (n.c || []).join(", ") || "(name only)";
    lines.push(`${n.p} → role=${n.r || "?"} [${comps}]`);
  }

  if (readClassNext) {
    lines.push(`→ agent_read_type_outline typeName=${readClassNext}`);
  }

  return lines.join("\n");
}

export function compactSceneDigest(digest) {
  if (!digest || digest.schemaVersion !== 1) return null;
  const h = digest.hierarchy ?? {};
  const stats = h.stats ?? {};
  const roleHints = digest.roleHints?.length ? digest.roleHints : buildRoleHints(digest.anchors);
  return {
    scenePath: digest.scenePath,
    sceneName: digest.sceneName,
    updatedAt: digest.updatedAt,
    isBuildScene: !!digest.isBuildScene,
    isCanonical: !!digest.isCanonical,
    total: stats.total ?? 0,
    indexed: stats.indexed ?? 0,
    truncated: !!stats.truncated,
    anchorCount: digest.anchors?.length ?? 0,
    hasContract: !!digest.contract,
    topRoles: roleHintsSummaryLine(roleHints).split(" ").filter(Boolean),
  };
}

/** Find canonical scene digest (contract block) for agent_read_scene_snapshot fallback. */
export function readCanonicalSceneDigest(projectRoot) {
  const dir = scenesDir(projectRoot);
  if (!fs.existsSync(dir)) return null;

  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const digest = readJsonSafe(path.join(dir, name));
    if (digest?.isCanonical && digest.contract) return digest;
  }

  return null;
}

export function sceneSnapshotFromDigest(digest) {
  if (!digest?.contract) return null;
  const c = digest.contract;
  return {
    savedAt: digest.updatedAt,
    scenePath: digest.scenePath,
    sceneName: digest.sceneName,
    layoutMode: c.layoutMode,
    totalGameObjects: c.totalGameObjects,
    roots: c.roots ?? [],
    uiPanels: c.uiPanels ?? [],
    components: c.components ?? [],
    missingRequiredComponents: c.missingRequiredComponents ?? [],
    missingRequiredUiPanels: c.missingRequiredUiPanels ?? [],
    hierarchySummary: c.hierarchySummary ?? [],
  };
}

// --- Scene query context (Phase 3.3) ---

const ANCHOR_RE =
  /Manager|Controller|Initializer|Context|Handler|Machine|Bootstrap|Spawner|Loader|HUD|System$/i;

function legacySceneIndexPath(projectRoot, sceneName) {
  return path.join(projectRoot, ".cursor", "unity-bridge", "scene-index", `${sceneName}.json`);
}

function isAnchorLike(node) {
  if (!node) return false;
  const name = node.p?.split("/").pop() ?? "";
  if (ANCHOR_RE.test(name)) return true;
  return (node.c || []).some((c) => ANCHOR_RE.test(c));
}

function filterLegacyAnchors(nodes) {
  return (nodes || []).filter(isAnchorLike);
}

/** PKE manifest scenes subsystem fresh flag; null if scenes not enabled. */
export function readPkeScenesFresh(projectRoot) {
  const m = readJsonSafe(manifestPath(projectRoot));
  const sc = m?.subsystems?.scenes;
  if (!sc?.enabled) return null;
  return !!sc.fresh;
}

/**
 * SSOT for scene index query — PKE digest first, legacy scene-index fallback.
 * @returns {object|null} context with source, nodes, roleHints, truncated, ...
 */
export function resolveSceneQueryContext(projectRoot, sceneName, options = {}) {
  const { anchorsOnly = false } = options;
  if (!sceneName) return null;

  const digest = readSceneDigest(projectRoot, sceneName);
  if (digest) {
    const h = digest.hierarchy ?? {};
    let nodes;
    if (anchorsOnly) {
      nodes = digest.anchors ?? [];
    } else {
      nodes = h.nodes ?? [];
      if (!nodes.length && digest.anchors?.length) nodes = digest.anchors;
    }

    if (nodes.length) {
      return {
        source: "pke",
        sceneName: digest.sceneName ?? sceneName,
        scenePath: digest.scenePath ?? h.scenePath ?? "",
        indexedAt: digest.updatedAt ?? h.indexedAt ?? null,
        nodes,
        roots: h.roots ?? [],
        stats: h.stats ?? null,
        roleHints: digest.roleHints?.length ? digest.roleHints : buildRoleHints(digest.anchors),
        truncated: !!h.stats?.truncated,
      };
    }
  }

  const legacy = readJsonSafe(legacySceneIndexPath(projectRoot, sceneName));
  if (!legacy) return null;

  let nodes = legacy.nodes ?? [];
  if (anchorsOnly) nodes = filterLegacyAnchors(nodes);
  if (!nodes.length) return null;

  return {
    source: "legacy",
    sceneName: legacy.sceneName ?? sceneName,
    scenePath: legacy.scenePath ?? "",
    indexedAt: legacy.indexedAt ?? null,
    nodes,
    roots: legacy.roots ?? [],
    stats: legacy.stats ?? null,
    roleHints: null,
    truncated: !!legacy.stats?.truncated,
  };
}
