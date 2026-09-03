/**
 * Unity project discovery — roots, packages, stale markers (no Unity required).
 */
import fs from "node:fs";
import path from "node:path";
import { parseBuildScenesFromAsset } from "./scene-build-index.mjs";

export function indexRoot(projectRoot) {
  return path.join(projectRoot, ".cursor", "codebase-index");
}

export function summaryPath(projectRoot) {
  return path.join(indexRoot(projectRoot), "project-summary.json");
}

export function profilePath(projectRoot) {
  return path.join(indexRoot(projectRoot), "project-profile.json");
}

export function staleMarkerPath(projectRoot) {
  return path.join(indexRoot(projectRoot), "stale-marker.json");
}

export function fileManifestPath(projectRoot) {
  return path.join(indexRoot(projectRoot), "file-manifest.json");
}

function relPosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

const PLUGIN_DIR_HINTS = new Set([
  "Plugins",
  "GooglePlayPlugins",
  "GooglePlayGames",
  "ExternalPackages",
  "TextMesh Pro",
  "Graphy - Ultimate Stats Monitor",
]);

function hasCsFiles(dir) {
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isFile() && ent.name.endsWith(".cs")) return true;
      if (ent.isDirectory() && ent.name !== "Editor" && hasCsFiles(full)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function rootKind(relPath) {
  const parts = relPath.split("/");
  if (parts.some((p) => PLUGIN_DIR_HINTS.has(p))) return "plugin";
  if (relPath.includes("_Project/") || relPath.includes("0_workspace/")) return "game";
  if (parts[1] === "Scripts") return "game";
  return "other";
}

function rootSlug(rel) {
  return rel
    .replace(/^Assets\//, "")
    .replace(/\/Scripts$/, "")
    .replace(/\//g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "") || "Scripts";
}

export function discoverCodeRoots(projectRoot, options = {}) {
  if (options.scriptsRoots?.length) {
    return options.scriptsRoots.map((rel) => ({
      path: rel.replace(/\\/g, "/"),
      full: path.join(projectRoot, rel.replace(/\//g, path.sep)),
      kind: rootKind(rel.replace(/\\/g, "/")),
      slug: rootSlug(rel.replace(/\\/g, "/")),
    }));
  }

  const mapPath = path.join(projectRoot, ".cursor", "project-map.json");
  if (fs.existsSync(mapPath)) {
    try {
      const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
      const roots = map.scriptsRoots ?? (map.scriptsRoot ? [map.scriptsRoot] : []);
      if (roots.length) {
        return roots.map((rel) => ({
          path: rel.replace(/\\/g, "/"),
          full: path.join(projectRoot, rel.replace(/\//g, path.sep)),
          kind: map.codeRootKind?.[rel] ?? rootKind(rel),
          slug: rootSlug(rel),
        }));
      }
    } catch {
      /* fall through */
    }
  }

  const assets = path.join(projectRoot, "Assets");
  if (!fs.existsSync(assets)) return [];

  const found = new Map();
  function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const full = path.join(dir, ent.name);
      const rel = relPosix(projectRoot, full);
      if (ent.name === "Scripts" && hasCsFiles(full)) {
        found.set(rel, {
          path: rel,
          full,
          kind: rootKind(rel),
          slug: rootSlug(rel),
        });
      }
      if (ent.name === "Library" || ent.name === ".git") continue;
      walk(full, depth + 1);
    }
  }
  walk(assets, 0);

  const list = [...found.values()].sort((a, b) => {
    const order = { game: 0, other: 1, plugin: 2 };
    return (order[a.kind] ?? 1) - (order[b.kind] ?? 1) || a.path.localeCompare(b.path);
  });
  return list;
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readUnityVersion(projectRoot) {
  const p = path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt");
  if (!fs.existsSync(p)) return null;
  const m = fs.readFileSync(p, "utf8").match(/m_EditorVersion:\s*(\S+)/);
  return m?.[1] ?? null;
}

function readPackageSummary(projectRoot) {
  const manifest = readJsonSafe(path.join(projectRoot, "Packages", "manifest.json"));
  if (!manifest?.dependencies) return { packages: [], technologies: [] };
  const deps = Object.keys(manifest.dependencies);
  const tech = [];
  if (deps.some((d) => d.includes("render-pipelines.universal"))) tech.push("URP");
  if (deps.some((d) => d.includes("addressables"))) tech.push("Addressables");
  if (deps.some((d) => d.includes("entities"))) tech.push("DOTS/Entities");
  if (deps.some((d) => d.includes("localization"))) tech.push("Localization");
  if (deps.some((d) => d.includes("purchasing"))) tech.push("IAP");
  if (deps.some((d) => d.includes("applovin") || d.includes("ads"))) tech.push("Ads/Mediation");
  if (deps.some((d) => d.includes("inputsystem"))) tech.push("Input System");
  tech.push("Unity");
  const keyPackages = deps
    .filter((d) => d.startsWith("com.unity.") && !d.includes("test-framework"))
    .slice(0, 12);
  return { packages: keyPackages, technologies: [...new Set(tech)] };
}

function discoverScenes(projectRoot, limit = 20) {
  const assets = path.join(projectRoot, "Assets");
  if (!fs.existsSync(assets)) return [];
  const scenes = [];
  function walk(dir, depth) {
    if (depth > 6 || scenes.length >= limit) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory() && ent.name.endsWith(".unity")) {
        scenes.push(relPosix(projectRoot, path.join(dir, ent.name)));
      } else if (ent.isDirectory() && !ent.name.startsWith(".")) {
        walk(path.join(dir, ent.name), depth + 1);
      }
    }
  }
  walk(assets, 0);
  return scenes.sort();
}

function discoverAsmdefs(projectRoot, limit = 30) {
  const assets = path.join(projectRoot, "Assets");
  if (!fs.existsSync(assets)) return [];
  const out = [];
  function walk(dir, depth) {
    if (depth > 8 || out.length >= limit) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isFile() && ent.name.endsWith(".asmdef")) {
        const j = readJsonSafe(full);
        out.push({
          path: relPosix(projectRoot, full),
          name: j?.name ?? ent.name,
          kind: rootKind(relPosix(projectRoot, path.dirname(full))),
        });
      } else if (ent.isDirectory()) walk(full, depth + 1);
    }
  }
  walk(assets, 0);
  return out;
}

export function buildProjectProfile(projectRoot, options = {}) {
  const codeRoots = discoverCodeRoots(projectRoot, options);
  const pkg = readPackageSummary(projectRoot);
  const profile = {
    builtAt: new Date().toISOString(),
    unityVersion: readUnityVersion(projectRoot),
    technologies: pkg.technologies,
    keyPackages: pkg.packages,
    codeRoots: codeRoots.map((r) => ({ path: r.path, kind: r.kind, slug: r.slug })),
    scenes: discoverScenes(projectRoot),
    buildScenes: parseBuildScenesFromAsset(projectRoot),
    asmdefs: discoverAsmdefs(projectRoot),
    agentBridgePath: fs.existsSync(
      path.join(projectRoot, "Assets/_Project/Editor/AgentBridge/AgentBridgeHost.cs")
    )
      ? "Assets/_Project/Editor/AgentBridge/AgentBridgeHost.cs"
      : null,
  };

  fs.mkdirSync(indexRoot(projectRoot), { recursive: true });
  fs.writeFileSync(profilePath(projectRoot), JSON.stringify(profile, null, 2) + "\n", "utf8");
  return profile;
}

export function readStaleMarker(projectRoot) {
  const p = staleMarkerPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  return readJsonSafe(p);
}

export function clearStaleMarker(projectRoot) {
  const p = staleMarkerPath(projectRoot);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function hashFileMeta(fullPath) {
  const st = fs.statSync(fullPath);
  return { mtimeMs: st.mtimeMs, size: st.size };
}

export function buildFileManifest(projectRoot, csFiles) {
  const manifest = { builtAt: new Date().toISOString(), files: {} };
  for (const rel of csFiles) {
    const full = path.join(projectRoot, rel.replace(/\//g, path.sep));
    if (!fs.existsSync(full)) continue;
    manifest.files[rel] = hashFileMeta(full);
  }
  fs.writeFileSync(fileManifestPath(projectRoot), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

export function compareFileManifest(projectRoot, currentFiles) {
  const prev = readJsonSafe(fileManifestPath(projectRoot));
  if (!prev?.files) {
    return { needsFullBuild: true, added: currentFiles.length, changed: 0, removed: 0, newFiles: currentFiles };
  }
  const prevSet = new Set(Object.keys(prev.files));
  const curSet = new Set(currentFiles);
  const added = [];
  const changed = [];
  const removed = [];
  for (const f of currentFiles) {
    if (!prevSet.has(f)) added.push(f);
    else {
      const full = path.join(projectRoot, f.replace(/\//g, path.sep));
      if (fs.existsSync(full)) {
        const now = hashFileMeta(full);
        const old = prev.files[f];
        if (now.mtimeMs !== old.mtimeMs || now.size !== old.size) changed.push(f);
      }
    }
  }
  for (const f of prevSet) {
    if (!curSet.has(f)) removed.push(f);
  }
  return {
    needsFullBuild: false,
    added: added.length,
    changed: changed.length,
    removed: removed.length,
    newFiles: added,
    changedFiles: changed,
    removedFiles: removed,
  };
}

export function readIndexStatus(projectRoot) {
  const stale = readStaleMarker(projectRoot);
  const profile = readJsonSafe(profilePath(projectRoot));
  const summary = readJsonSafe(path.join(indexRoot(projectRoot), "project-summary.json"));
  const manifest = readJsonSafe(fileManifestPath(projectRoot));

  let diskFiles = [];
  if (profile?.codeRoots?.length) {
    for (const root of discoverCodeRoots(projectRoot)) {
      diskFiles.push(...listCsFilesUnder(root.full, projectRoot));
    }
  }
  const diff = manifest ? compareFileManifest(projectRoot, diskFiles) : { needsFullBuild: !summary };

  return {
    hasProfile: !!profile,
    hasIndex: !!summary,
    indexBuiltAt: summary?.builtAt ?? null,
    profileBuiltAt: profile?.builtAt ?? null,
    staleMarker: stale,
    stale: !!stale?.needsRebuild || diff.added > 0 || diff.changed > 0 || diff.removed > 0,
    diff,
    codeRoots: profile?.codeRoots ?? [],
  };
}

export function listCsFilesUnder(rootFull, projectRoot) {
  const out = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.name.endsWith(".cs")) {
        out.push(relPosix(projectRoot, full));
      }
    }
  }
  if (fs.existsSync(rootFull)) walk(rootFull);
  return out;
}

export function readProjectProfileText(projectRoot) {
  const p = profilePath(projectRoot);
  if (!fs.existsSync(p)) {
    return {
      text: "project profile missing\n→ agent_discover_project (fast scan, no type index)",
      isError: true,
    };
  }
  const profile = JSON.parse(fs.readFileSync(p, "utf8"));
  const status = readIndexStatus(projectRoot);
  const lines = [
    `profile builtAt=${profile.builtAt}`,
    `unity=${profile.unityVersion ?? "?"}`,
    `tech=${(profile.technologies ?? []).join(", ")}`,
    `agentBridge=${profile.agentBridgePath ? "yes" : "no"}`,
    "--- code roots (path | kind) ---",
  ];
  for (const r of profile.codeRoots ?? []) lines.push(`${r.path} | ${r.kind}`);
  if (profile.buildScenes?.enabled?.length) {
    lines.push(`--- build scenes (enabled ${profile.buildScenes.enabled.length}) ---`);
    for (const s of profile.buildScenes.enabled.slice(0, 10)) {
      lines.push(`- [${s.index}] ${s.name} → ${s.path}`);
    }
    lines.push("→ agent_read_build_scene_index (cache, 0 Unity)");
  } else if (profile.scenes?.length) {
    lines.push(`--- scenes (${profile.scenes.length}) ---`);
    for (const s of profile.scenes.slice(0, 8)) lines.push(`- ${s}`);
    if (profile.scenes.length > 8) lines.push(`... +${profile.scenes.length - 8}`);
  }
  if (profile.keyPackages?.length) {
    lines.push(`--- packages (sample) ---`);
    lines.push(profile.keyPackages.slice(0, 6).join(", "));
  }
  if (status.stale) {
    lines.push("--- index status ---");
    lines.push(`STALE reason=${status.staleMarker?.reason ?? "file-diff"}`);
    lines.push(`added=${status.diff.added} changed=${status.diff.changed} removed=${status.diff.removed}`);
    lines.push("→ agent_apply_index_delta (incremental) or agent_build_project_index (full)");
  } else if (status.hasIndex) {
    lines.push(`index ok builtAt=${status.indexBuiltAt}`);
  } else {
    lines.push("index missing → agent_build_project_index");
  }
  return { text: lines.join("\n"), isError: false, profile, status };
}
