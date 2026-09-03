/**
 * PKE Phase 6 — scriptable object digests (.cursor/project-knowledge/scriptables/{guid}.json).
 */
import fs from "node:fs";
import path from "node:path";
import {
  guidFromAssetMeta,
  isExcludedAssetPath,
  isTrackableAssetPath,
  isValidGuid,
  normalizeAssetPath,
  normalizeGuid,
} from "./project-knowledge.mjs";

export const SCRIPTABLE_DIGEST_CAPS = {
  maxFields: 32,
  maxProjectFields: 16,
  maxArraySample: 8,
  maxStringValue: 128,
  maxTypeQueryResults: 24,
  maxCompactFields: 12,
  maxCompactProjectFields: 8,
};

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function truncateStr(value, maxLen) {
  if (value == null) return "";
  const s = String(value);
  return s.length <= maxLen ? s : s.slice(0, maxLen);
}

export function scriptablesDir(projectRoot) {
  return path.join(projectRoot, ".cursor", "project-knowledge", "scriptables");
}

export function scriptableDigestPath(projectRoot, guid) {
  return path.join(scriptablesDir(projectRoot), `${normalizeGuid(guid)}.json`);
}

export function findGuidByPathInScriptablesIndex(projectRoot, assetPath) {
  const normalized = normalizeAssetPath(assetPath);
  if (!isTrackableAssetPath(normalized)) return null;

  const dir = scriptablesDir(projectRoot);
  if (!fs.existsSync(dir)) return null;

  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const digest = readJsonSafe(path.join(dir, name));
    if (!digest?.path) continue;
    if (normalizeAssetPath(digest.path) === normalized) {
      const fromFile = normalizeGuid(digest.guid);
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

  const indexGuid = findGuidByPathInScriptablesIndex(projectRoot, normalizedPath);
  if (indexGuid && indexGuid !== fromGuid) return "path_guid_mismatch";

  const digestPath = scriptableDigestPath(projectRoot, fromGuid);
  if (fs.existsSync(digestPath)) {
    const digest = readJsonSafe(digestPath);
    if (digest?.path && normalizeAssetPath(digest.path) !== normalizedPath) {
      return "path_guid_mismatch";
    }
  }

  return null;
}

export function resolveScriptableLookup(projectRoot, { path: assetPath, guid }) {
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
      findGuidByPathInScriptablesIndex(projectRoot, normalizedPath);
    return { guid: resolvedGuid, assetPath: normalizedPath };
  }

  return { guid: null, assetPath: null };
}

export function enforceScriptableDigestCaps(digest) {
  if (!digest || typeof digest !== "object") return null;
  const caps = SCRIPTABLE_DIGEST_CAPS;
  const out = { ...digest };
  let capsApplied = false;

  if (Array.isArray(out.fields)) {
    if (out.fields.length > caps.maxFields) capsApplied = true;
    out.fields = out.fields.slice(0, caps.maxFields).map((f) => {
      const entry = { ...f };
      if (entry.value != null) entry.value = truncateStr(entry.value, caps.maxStringValue);
      if (Array.isArray(entry.sample)) {
        if (entry.sample.length > caps.maxArraySample) capsApplied = true;
        entry.sample = entry.sample
          .slice(0, caps.maxArraySample)
          .map((s) => truncateStr(s, caps.maxStringValue));
      }
      return entry;
    });
  } else {
    out.fields = [];
  }

  if (Array.isArray(out.projectFields)) {
    if (out.projectFields.length > caps.maxProjectFields) capsApplied = true;
    out.projectFields = out.projectFields.slice(0, caps.maxProjectFields);
  } else {
    out.projectFields = [];
  }

  if (capsApplied) {
    out.capsApplied = { ...(out.capsApplied ?? {}), fields: true };
  }

  return out;
}

function summarizeProjectField(pf) {
  if (!pf) return "";
  const parts = [pf.key ?? pf.kind ?? "?"];
  if (pf.count != null) parts.push(`count=${pf.count}`);
  if (Array.isArray(pf.names) && pf.names.length) {
    parts.push(`names=${pf.names.slice(0, 4).join(",")}`);
  }
  if (Array.isArray(pf.paths) && pf.paths.length) {
    parts.push(`paths=${pf.paths.length}`);
  }
  if (Array.isArray(pf.slotCounts) && pf.slotCounts.length) {
    parts.push(`slots=${pf.slotCounts.join(",")}`);
  }
  return parts.join(" ");
}

export function compactScriptableDigest(digest, options = {}) {
  const normalized = enforceScriptableDigestCaps(digest);
  if (!normalized) return null;
  const verbose = options.verbose === true;
  const caps = SCRIPTABLE_DIGEST_CAPS;

  const fields = (normalized.fields ?? []).slice(0, verbose ? caps.maxFields : caps.maxCompactFields).map((f) => {
    const entry = { name: f.name, kind: f.kind };
    if (f.value != null) entry.value = f.value;
    if (f.count != null) entry.count = f.count;
    if (f.sample?.length) entry.sample = f.sample;
    if (f.refPath) entry.refPath = f.refPath;
    if (f.refType) entry.refType = f.refType;
    return entry;
  });

  const projectFields = (normalized.projectFields ?? [])
    .slice(0, verbose ? caps.maxProjectFields : caps.maxCompactProjectFields)
    .map((pf) => ({
      key: pf.key,
      kind: pf.kind,
      count: pf.count,
      summary: summarizeProjectField(pf),
      names: verbose ? pf.names : pf.names?.slice(0, 8),
      paths: verbose ? pf.paths : undefined,
      slotCounts: verbose ? pf.slotCounts : undefined,
    }));

  const compact = {
    path: normalized.path ?? "",
    guid: normalizeGuid(normalized.guid),
    typeName: normalized.typeName ?? "",
    shortType: normalized.shortType ?? "",
    fieldCount: normalized.fields?.length ?? 0,
    projectFieldCount: normalized.projectFields?.length ?? 0,
    fields,
    projectFields,
  };

  if (normalized.capsApplied && Object.values(normalized.capsApplied).some(Boolean)) {
    compact.capsApplied = normalized.capsApplied;
  }
  if (verbose) {
    compact.updatedAt = normalized.updatedAt ?? null;
    compact.schemaVersion = normalized.schemaVersion ?? 1;
  }
  return compact;
}

function formatScriptableDigestText(status, compact, lookup, typeMatches) {
  const lines = [`status=${status}`];
  if (lookup?.assetPath) lines.push(`path=${lookup.assetPath}`);
  if (lookup?.guid) lines.push(`guid=${lookup.guid}`);

  if (status === "ok" && compact) {
    lines.push(
      `type=${compact.shortType || compact.typeName} fields=${compact.fieldCount} projectFields=${compact.projectFieldCount}`
    );
    if (compact.projectFields?.length) {
      lines.push(`project=${compact.projectFields.map((p) => p.summary || p.key).join("; ")}`);
    }
    lines.push("→ use compact JSON; do not Read .asset YAML");
  } else if (status === "type_matches" && typeMatches?.length) {
    lines.push(`matches=${typeMatches.length}`);
    for (const m of typeMatches.slice(0, 8)) {
      lines.push(`  ${m.shortType || m.typeName} path=${m.path}`);
    }
    lines.push("→ narrow with path= or guid=");
  } else if (status === "missing") {
    lines.push("meta=missing or path invalid");
    lines.push("→ enable SO tracking + reimport, or unity_bridge_invoke rebuild_scriptable_digest args path=...");
  } else if (status === "stale") {
    lines.push("digest=missing on disk");
    lines.push("→ enable SO tracking + reimport or unity_bridge_invoke rebuild_scriptable_digest");
  } else if (status === "corrupt") {
    lines.push("digest=corrupt JSON");
    lines.push("→ unity_bridge_invoke rebuild_scriptable_digest");
  } else if (status === "error") {
    lines.push(`error=${lookup?.error ?? "unknown"}`);
    if (lookup?.error === "invalid_guid") {
      lines.push("hint=guid must be 32 hex characters (dashes optional)");
    } else if (lookup?.error === "path_guid_mismatch") {
      lines.push("hint=path and guid refer to different scriptables");
    } else if (lookup?.error === "excluded_path") {
      lines.push("hint=path is Library/Temp/Packages/package-cache — not indexed");
    }
  }
  return lines.join("\n");
}

export function findScriptablesByType(projectRoot, typeQuery) {
  const q = String(typeQuery ?? "").trim().toLowerCase();
  if (!q) return [];

  const dir = scriptablesDir(projectRoot);
  if (!fs.existsSync(dir)) return [];

  const matches = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const digest = readJsonSafe(path.join(dir, name));
    if (!digest?.path) continue;
    const shortType = (digest.shortType ?? "").toLowerCase();
    const typeName = (digest.typeName ?? "").toLowerCase();
    if (shortType === q || typeName === q || shortType.endsWith(`.${q}`) || typeName.endsWith(`.${q}`)) {
      matches.push({
        path: digest.path,
        guid: normalizeGuid(digest.guid),
        typeName: digest.typeName,
        shortType: digest.shortType,
      });
    }
    if (matches.length >= SCRIPTABLE_DIGEST_CAPS.maxTypeQueryResults) break;
  }
  return matches;
}

export function queryScriptable(projectRoot, options = {}) {
  const verbose = options.verbose === true;
  const typeQuery = options.type;

  if (typeQuery && !options.path && !options.guid) {
    const matches = findScriptablesByType(projectRoot, typeQuery);
    if (matches.length === 0) {
      return {
        text: formatScriptableDigestText("stale", null, { error: "no_type_matches" }, []),
        isError: true,
        status: "stale",
        compact: null,
        typeMatches: [],
      };
    }
    if (matches.length === 1) {
      return queryScriptable(projectRoot, { path: matches[0].path, verbose });
    }
    return {
      text: formatScriptableDigestText("type_matches", null, null, matches),
      isError: false,
      status: "type_matches",
      compact: null,
      typeMatches: matches,
    };
  }

  const lookup = resolveScriptableLookup(projectRoot, {
    path: options.path,
    guid: options.guid,
  });

  if (lookup.error) {
    return {
      text: formatScriptableDigestText("error", null, lookup),
      isError: true,
      status: "error",
      compact: null,
    };
  }

  if (!lookup.guid) {
    return {
      text: formatScriptableDigestText("missing", null, lookup),
      isError: true,
      status: "missing",
      compact: null,
    };
  }

  const digestPath = scriptableDigestPath(projectRoot, lookup.guid);
  if (!fs.existsSync(digestPath)) {
    return {
      text: formatScriptableDigestText("stale", null, lookup),
      isError: true,
      status: "stale",
      compact: null,
    };
  }

  const digest = readJsonSafe(digestPath);
  const compact = compactScriptableDigest(digest, { verbose });
  if (!compact) {
    return {
      text: formatScriptableDigestText("corrupt", null, lookup),
      isError: true,
      status: "corrupt",
      compact: null,
    };
  }

  if (!lookup.assetPath && compact.path) {
    lookup.assetPath = compact.path;
  }

  return {
    text: formatScriptableDigestText("ok", compact, lookup),
    isError: false,
    status: "ok",
    compact,
  };
}
