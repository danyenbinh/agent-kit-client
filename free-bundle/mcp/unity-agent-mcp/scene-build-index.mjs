/**
 * Scene build index — offline read/query (zero Unity round-trip).
 * Cache written by Unity on scene Save or refresh_build_scene_index.
 * Phase 3.1: PKE scenes/{name}.json read-first, legacy unity-bridge fallback.
 */
import fs from "node:fs";
import path from "node:path";
import { compactSceneAnchors, readSceneDigest, resolveSceneQueryContext, readPkeScenesFresh } from "./project-knowledge.mjs";

export function bridgeRoot(projectRoot) {
  return path.join(projectRoot, ".cursor", "unity-bridge");
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function buildScenesPath(projectRoot) {
  return path.join(bridgeRoot(projectRoot), "build-scenes.json");
}

export function sceneIndexDir(projectRoot) {
  return path.join(bridgeRoot(projectRoot), "scene-index");
}

export function sceneIndexManifestPath(projectRoot) {
  return path.join(sceneIndexDir(projectRoot), "manifest.json");
}

export function sceneAnchorsDir(projectRoot) {
  return path.join(bridgeRoot(projectRoot), "scene-anchors");
}

const ANCHOR_RE =
  /Manager|Controller|Initializer|Context|Handler|Machine|Bootstrap|Spawner|Loader|HUD|System$/i;

export function isAnchorNode(node) {
  if (!node) return false;
  const name = node.p?.split("/").pop() ?? "";
  if (ANCHOR_RE.test(name)) return true;
  return (node.c || []).some((c) => ANCHOR_RE.test(c));
}

/** Fallback: extract anchors từ scene-index (không cần Unity). Thiếu GO nếu hierarchy truncated. */
export function extractAnchorsFromIndex(index) {
  if (!index) return [];
  const seen = new Set();
  const out = [];
  for (const n of index.nodes || []) {
    if (!isAnchorNode(n)) continue;
    if (seen.has(n.p)) continue;
    seen.add(n.p);
    out.push(n);
  }
  for (const root of index.roots || []) {
    const name = root.replace(/\s+\(off\)$/, "");
    const hit = (index.nodes || []).find((n) => n.p === name);
    if (hit && isAnchorNode(hit) && !seen.has(hit.p)) out.push(hit);
  }
  return out.sort((a, b) => (a.p || "").localeCompare(b.p || ""));
}

export function writeAnchorsFile(projectRoot, sceneName, anchors, meta = {}) {
  const dir = sceneAnchorsDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    version: 1,
    indexedAt: meta.indexedAt || new Date().toISOString(),
    scenePath: meta.scenePath || "",
    sceneName,
    anchors,
    source: meta.source || "extracted-from-index",
  };
  fs.writeFileSync(
    path.join(dir, `${sceneName}.json`),
    JSON.stringify(payload, null, 2) + "\n",
    "utf8"
  );
}

export function rebuildAnchorsFromIndexCache(projectRoot) {
  const build = readBuildScenesManifest(projectRoot);
  const written = [];
  for (const s of build.enabled || []) {
    const idx = readJsonFile(path.join(sceneIndexDir(projectRoot), `${s.name}.json`));
    if (!idx) continue;
    const anchors = extractAnchorsFromIndex(idx);
    writeAnchorsFile(projectRoot, s.name, anchors, {
      scenePath: idx.scenePath,
      indexedAt: idx.indexedAt,
      source: "extracted-from-index",
    });
    written.push({ scene: s.name, count: anchors.length });
  }
  return written;
}

export function readSceneAnchors(projectRoot, options = {}) {
  const { sceneName, all = false } = options;
  const registryPath = path.join(bridgeRoot(projectRoot), "build-scene-registry.json");
  const registry = readJsonFile(registryPath);

  if (all || !sceneName) {
    const build = readBuildScenesManifest(projectRoot);
    const lines = ["scene_anchors (compact) — đọc 1 scene: sceneName=X"];
    if (registry?.scenes) {
      lines.push("--- registry purpose ---");
      for (const s of build.enabled || []) {
        const reg = registry.scenes[s.name];
        lines.push(`${s.name}: ${reg?.purpose ?? "?"}`);
      }
    }
    lines.push("--- anchors count (pke-first) ---");
    for (const s of build.enabled || []) {
      const digest = readSceneDigest(projectRoot, s.name);
      let count = digest?.anchors?.length ?? 0;
      let src = count ? "pke" : "none";
      if (!count) {
        const legacy = readJsonFile(path.join(sceneAnchorsDir(projectRoot), `${s.name}.json`));
        count = legacy?.anchors?.length ?? 0;
        src = count ? "legacy" : "none";
      }
      lines.push(`  ${s.name}: ${count} anchors (${src})`);
    }
    lines.push("→ agent_read_scene_anchors sceneName=Login");
    return { text: lines.join("\n"), isError: false };
  }

  const reg = registry?.scenes?.[sceneName];
  const digest = readSceneDigest(projectRoot, sceneName);
  if (digest?.anchors?.length) {
    return {
      text: compactSceneAnchors(digest, {
        purpose: reg?.purpose,
        gameMode: reg?.gameMode,
        readClassNext: reg?.readClassNext,
        source: "pke",
      }),
      isError: false,
    };
  }

  let file = readJsonFile(path.join(sceneAnchorsDir(projectRoot), `${sceneName}.json`));
  if (!file?.anchors?.length) {
    const idx = readJsonFile(path.join(sceneIndexDir(projectRoot), `${sceneName}.json`));
    if (idx) {
      const anchors = extractAnchorsFromIndex(idx);
      writeAnchorsFile(projectRoot, sceneName, anchors, {
        scenePath: idx.scenePath,
        indexedAt: idx.indexedAt,
      });
      file = readJsonFile(path.join(sceneAnchorsDir(projectRoot), `${sceneName}.json`));
    }
  }

  if (!file?.anchors?.length) {
    return {
      text: `no anchors for ${sceneName} — Save scene in Unity or unity_refresh_build_scene_index`,
      isError: true,
    };
  }

  return {
    text: compactSceneAnchors(
      { sceneName, anchors: file.anchors },
      {
        purpose: reg?.purpose,
        gameMode: reg?.gameMode,
        readClassNext: reg?.readClassNext,
        source: file.source || "legacy",
      }
    ),
    isError: false,
  };
}

/** Parse ProjectSettings/EditorBuildSettings.asset — no Unity required. */
export function parseBuildScenesFromAsset(projectRoot) {
  const assetPath = path.join(projectRoot, "ProjectSettings", "EditorBuildSettings.asset");
  if (!fs.existsSync(assetPath)) {
    return { version: 1, source: "EditorBuildSettings.asset", updatedAt: new Date().toISOString(), enabled: [], disabled: [] };
  }

  const content = fs.readFileSync(assetPath, "utf8");
  const enabled = [];
  const disabled = [];
  const blocks = content.split(/\n\s*-\s+enabled:\s*/).slice(1);
  let index = 0;

  for (const block of blocks) {
    const enMatch = block.match(/^(\d+)/);
    const pathMatch = block.match(/path:\s*(Assets\/[^\r\n]+)/);
    const guidMatch = block.match(/guid:\s*([a-f0-9]+)/i);
    if (!pathMatch) continue;

    const isEnabled = enMatch ? enMatch[1] === "1" : false;
    const entry = {
      index,
      path: pathMatch[1].trim(),
      name: path.basename(pathMatch[1].trim(), ".unity"),
      enabled: isEnabled,
      guid: guidMatch ? guidMatch[1] : "",
    };
    index++;
    if (isEnabled) enabled.push(entry);
    else disabled.push(entry);
  }

  return {
    version: 1,
    source: "EditorBuildSettings.asset",
    updatedAt: new Date().toISOString(),
    enabled,
    disabled,
  };
}

export function writeBuildScenesManifest(projectRoot, data) {
  const dir = bridgeRoot(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(buildScenesPath(projectRoot), JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function readBuildScenesManifest(projectRoot) {
  const cached = readJsonFile(buildScenesPath(projectRoot));
  if (cached) return cached;
  return parseBuildScenesFromAsset(projectRoot);
}

function readSceneIndexFile(projectRoot, sceneName) {
  const ctx = resolveSceneQueryContext(projectRoot, sceneName, { anchorsOnly: false });
  if (!ctx) return null;

  return {
    version: 1,
    indexedAt: ctx.indexedAt,
    scenePath: ctx.scenePath,
    sceneName: ctx.sceneName,
    stats: ctx.stats,
    roots: ctx.roots,
    nodes: ctx.nodes,
    source: ctx.source,
  };
}

function isIndexStale(projectRoot, entry) {
  if (!entry?.path || !entry?.indexedAt) return true;
  const full = path.join(projectRoot, entry.path.replace(/\//g, path.sep));
  if (!fs.existsSync(full)) return true;
  const mtime = fs.statSync(full).mtimeMs;
  const indexed = Date.parse(entry.indexedAt);
  return !Number.isFinite(indexed) || mtime > indexed;
}

function roleCounts(nodes) {
  const counts = {};
  for (const n of nodes || []) {
    const r = n.r || "?";
    counts[r] = (counts[r] || 0) + 1;
  }
  return counts;
}

function topRoles(counts, limit = 8) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([r, c]) => `${r}:${c}`);
}

/** @param {"manifest"|"digest"|"roots"|"full"} mode */
export function readBuildSceneIndex(projectRoot, options = {}) {
  const { sceneName, mode = "digest", maxNodes = 60, maxAgeMinutes = 10080 } = options;
  const manifest = readJsonFile(sceneIndexManifestPath(projectRoot));

  if (!sceneName || sceneName === "manifest" || mode === "manifest") {
    const build = readBuildScenesManifest(projectRoot);
    const lines = [
      `build_scenes enabled=${build.enabled?.length ?? 0} disabled=${build.disabled?.length ?? 0}`,
      `source=${build.source ?? "?"}`,
    ];
    for (const s of build.enabled || []) {
      const m = manifest?.scenes?.[s.name];
      const stale = m ? isIndexStale(projectRoot, m) : true;
      const idx = m ? `indexed=${m.indexed} total=${m.total} stale=${stale}` : "no-index";
      lines.push(`  [${s.index}] ${s.name} | ${s.path} | ${idx}`);
    }
    if ((build.disabled || []).length) {
      lines.push(`disabled: ${build.disabled.map((d) => d.name).join(", ")}`);
    }
    lines.push("→ agent_read_build_scene_index sceneName=Login mode=digest");
    return { text: lines.join("\n"), isError: false };
  }

  const idx = readSceneIndexFile(projectRoot, sceneName);
  if (!idx) {
    return {
      text:
        `no index for scene=${sceneName}\n` +
        `→ Save scene in Unity (auto-index) or unity_refresh_build_scene_index`,
      isError: true,
    };
  }

  const m = manifest?.scenes?.[sceneName];
  const stale = m ? isIndexStale(projectRoot, m) : false;
  const indexedMs = idx.indexedAt ? Date.parse(idx.indexedAt) : 0;
  const ageStale =
    indexedMs > 0 && Date.now() - indexedMs > (maxAgeMinutes ?? 10080) * 60 * 1000;

  if (mode === "roots") {
    return {
      text: [
        `scene=${idx.scenePath} stale=${stale || ageStale}`,
        `roots=${JSON.stringify(idx.roots || [])}`,
        `stats total=${idx.stats?.total ?? "?"} indexed=${idx.stats?.indexed ?? "?"}`,
      ].join("\n"),
      isError: false,
    };
  }

  if (mode === "digest") {
    const roles = topRoles(roleCounts(idx.nodes));
    return {
      text: [
        `scene=${idx.scenePath} indexedAt=${idx.indexedAt ?? "?"} stale=${stale || ageStale}`,
        `stats total=${idx.stats?.total} indexed=${idx.stats?.indexed} truncated=${idx.stats?.truncated}`,
        `roots=${JSON.stringify(idx.roots || [])}`,
        `roles=${roles.join(" ")}`,
        `→ mode=full or agent_query_scene_index`,
      ].join("\n"),
      isError: false,
    };
  }

  const nodes = (idx.nodes || []).slice(0, maxNodes);
  const lines = [
    `scene=${idx.scenePath} mode=full nodes=${nodes.length}/${idx.nodes?.length ?? 0}`,
    "--- path | depth | active | role | components ---",
  ];
  for (const n of nodes) {
    const comps = n.c?.length ? ` [${n.c.slice(0, 4).join(", ")}]` : "";
    lines.push(`${n.p} | d${n.d} | ${n.a ? "on" : "off"} | ${n.r}${comps}`);
  }
  if ((idx.nodes?.length ?? 0) > maxNodes) {
    lines.push(`... +${idx.nodes.length - maxNodes} more — narrow with agent_query_scene_index`);
  }
  return { text: lines.join("\n"), isError: false };
}

export function querySceneIndex(projectRoot, options = {}) {
  const {
    pattern,
    sceneName,
    searchIn = "path",
    component,
    role,
    maxResults = 40,
    anchorsOnly = false,
  } = options;

  if (!pattern && !component && !role) {
    return { text: "query requires pattern, component, or role", isError: true };
  }

  const re = pattern ? new RegExp(pattern, "i") : null;
  const build = readBuildScenesManifest(projectRoot);
  const sceneNames = sceneName
    ? [sceneName]
    : (build.enabled || []).map((s) => s.name);

  const sourcesScanned = new Set();
  let anyTruncated = false;
  const hits = [];

  for (const name of sceneNames) {
    const ctx = resolveSceneQueryContext(projectRoot, name, { anchorsOnly });
    if (!ctx?.nodes?.length) continue;

    sourcesScanned.add(ctx.source);
    if (ctx.truncated) anyTruncated = true;

    for (const n of ctx.nodes) {
      if (hits.length >= maxResults) break;
      if (role && !(n.r || "").toLowerCase().includes(role.toLowerCase())) continue;
      if (component && !(n.c || []).some((c) => c.toLowerCase().includes(component.toLowerCase())))
        continue;
      if (re) {
        const hay =
          searchIn === "role"
            ? n.r || ""
            : searchIn === "component"
              ? (n.c || []).join(" ")
              : n.p || "";
        if (!re.test(hay)) continue;
      } else if (!component && !role) {
        continue;
      }

      const comps = n.c?.length ? ` [${n.c.slice(0, 3).join(", ")}]` : "";
      hits.push(`${name}: ${n.p} | ${n.r || "?"}${comps}`);
    }
  }

  let sourceLabel = "none";
  if (sourcesScanned.size === 1) sourceLabel = [...sourcesScanned][0];
  else if (sourcesScanned.size > 1) sourceLabel = "mixed";

  const headerParts = [
    `query hits=${hits.length}`,
    `source=${sourceLabel}`,
    `scenes=${sceneNames.length}`,
    `anchorsOnly=${!!anchorsOnly}`,
  ];
  if (anyTruncated) headerParts.push("truncated=true");

  const scenesFresh = readPkeScenesFresh(projectRoot);
  if (scenesFresh === false) {
    headerParts.push(
      "warning=scenes-stale → Save scene in Unity or unity_refresh_build_scene_index"
    );
  }

  const lines = [headerParts.join(" ")];

  if (!hits.length) {
    lines.push("0 hits — refresh index or widen pattern");
    return { text: lines.join("\n"), isError: false };
  }

  lines.push(...hits);
  return { text: lines.join("\n"), isError: false };
}

export function listBuildScenesText(projectRoot, writeDisk = true) {
  const data = parseBuildScenesFromAsset(projectRoot);
  if (writeDisk) writeBuildScenesManifest(projectRoot, data);

  const lines = [
    `build_scenes enabled=${data.enabled.length} disabled=${data.disabled.length} (offline)`,
    "--- enabled ---",
  ];
  for (const s of data.enabled) {
    lines.push(`  [${s.index}] ${s.name} → ${s.path}`);
  }
  if (data.disabled.length) {
    lines.push("--- disabled ---");
    for (const s of data.disabled) {
      lines.push(`  ${s.name}`);
    }
  }
  lines.push("cache: .cursor/unity-bridge/scene-index/ (auto on Save)");
  return { text: lines.join("\n"), isError: false };
}
