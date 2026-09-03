/**
 * Codebase index — multi-root C# scan, incremental updates, project profile integration.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildFileManifest,
  buildProjectProfile,
  clearStaleMarker,
  compareFileManifest,
  discoverCodeRoots,
  indexRoot,
  listCsFilesUnder,
  profilePath,
  readIndexStatus,
  readProjectProfileText,
  readStaleMarker,
  summaryPath,
} from "./project-profile.mjs";

export { readProjectProfileText, readIndexStatus, buildProjectProfile, discoverCodeRoots, indexRoot, summaryPath };

const TYPE_DECL =
  /^\s*(?:public|internal|protected|private)?\s*(?:partial\s+)?(?:sealed\s+|abstract\s+|static\s+)*?(class|interface|struct|enum|record)\s+(\w+)/gm;
const NS_DECL = /^\s*namespace\s+([\w.]+)/m;
const PUBLIC_MEMBER =
  /^\s*public\s+(?:static\s+|virtual\s+|override\s+|async\s+)*([\w<>,\[\]?]+)\s+(\w+)\s*\(/gm;

function relPosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function scanFile(filePath, rootMeta, projectRoot) {
  const text = fs.readFileSync(filePath, "utf8");
  const ns = text.match(NS_DECL)?.[1] ?? null;
  const relFile = relPosix(projectRoot, filePath);
  const types = [];
  TYPE_DECL.lastIndex = 0;
  let m;
  while ((m = TYPE_DECL.exec(text)) !== null) {
    const kind = m[1];
    const name = m[2];
    const slice = text.slice(m.index, m.index + 4000);
    const members = [];
    PUBLIC_MEMBER.lastIndex = 0;
    let mm;
    while ((mm = PUBLIC_MEMBER.exec(slice)) !== null) {
      if (mm[2] !== name) members.push(`${mm[1]} ${mm[2]}(...)`);
      if (members.length >= 12) break;
    }
    types.push({ name, kind, namespace: ns, publicMembers: members });
  }
  const relInRoot = relPosix(rootMeta.full, filePath);
  const parts = relInRoot.split("/");
  const sub = parts.length > 1 ? parts[0] : "_root";
  const moduleId =
    rootMeta.slug && rootMeta.slug !== "Scripts" ? `${rootMeta.slug}.${sub}` : sub;
  return { relFile, moduleId, types, rootPath: rootMeta.path };
}

function collectAllCsFiles(projectRoot, roots) {
  const all = [];
  for (const root of roots) all.push(...listCsFilesUnder(root.full, projectRoot));
  return [...new Set(all)].sort();
}

function mergeModuleMaps(maps) {
  const merged = new Map();
  for (const map of maps) {
    for (const [id, mod] of map) {
      if (!merged.has(id)) merged.set(id, { id, files: [], types: [], roots: new Set() });
      const m = merged.get(id);
      m.files.push(...mod.files);
      m.types.push(...mod.types);
      if (mod.rootPath) m.roots.add(mod.rootPath);
    }
  }
  return merged;
}

function writeIndexOutputs(projectRoot, moduleMap, codeRoots, profile) {
  const outDir = indexRoot(projectRoot);
  const modulesDir = path.join(outDir, "modules");
  fs.mkdirSync(modulesDir, { recursive: true });

  let fileCount = 0;
  let typeCount = 0;
  const modules = [];

  for (const m of moduleMap.values()) {
    fileCount += m.files.length;
    typeCount += m.types.length;
    modules.push({
      id: m.id,
      fileCount: m.files.length,
      typeCount: m.types.length,
      roots: [...m.roots],
      types: m.types.map((t) => t.name).sort(),
    });
    fs.writeFileSync(
      path.join(modulesDir, `${m.id}.json`),
      JSON.stringify(
        {
          id: m.id,
          roots: [...m.roots],
          fileCount: m.files.length,
          types: m.types.sort((a, b) => a.name.localeCompare(b.name)),
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
  }

  modules.sort((a, b) => a.id.localeCompare(b.id));

  const allFiles = [];
  for (const m of moduleMap.values()) allFiles.push(...m.files);

  const summary = {
    builtAt: new Date().toISOString(),
    codeRoots: codeRoots.map((r) => ({ path: r.path, kind: r.kind, slug: r.slug })),
    scriptsRoot: codeRoots[0]?.path ?? null,
    stats: { files: fileCount, types: typeCount, modules: modules.length },
    modules,
  };
  fs.writeFileSync(summaryPath(projectRoot), JSON.stringify(summary, null, 2) + "\n", "utf8");
  buildFileManifest(projectRoot, allFiles);
  clearStaleMarker(projectRoot);

  return { summary, profile };
}

function scanFiles(projectRoot, roots, fileRelPaths) {
  const rootByPrefix = roots.map((r) => ({ ...r, prefix: r.path + "/" }));
  const moduleMap = new Map();

  for (const relFile of fileRelPaths) {
    const full = path.join(projectRoot, relFile.replace(/\//g, path.sep));
    if (!fs.existsSync(full)) continue;
    const rootMeta = rootByPrefix.find((r) => relFile.startsWith(r.prefix) || relFile === r.path);
    if (!rootMeta) continue;
    const scanned = scanFile(full, rootMeta, projectRoot);
    if (!moduleMap.has(scanned.moduleId)) {
      moduleMap.set(scanned.moduleId, {
        id: scanned.moduleId,
        files: [],
        types: [],
        rootPath: scanned.rootPath,
        roots: new Set([scanned.rootPath]),
      });
    }
    const mod = moduleMap.get(scanned.moduleId);
    mod.files.push(scanned.relFile);
    mod.roots.add(scanned.rootPath);
    for (const t of scanned.types) mod.types.push({ ...t, file: scanned.relFile });
  }
  return moduleMap;
}

/** Fast: discover layout + tech stack only (no type parse). */
export function discoverProject(projectRoot, options = {}) {
  return buildProjectProfile(projectRoot, options);
}

/** Full index all discovered code roots. */
export function buildProjectIndex(projectRoot, options = {}) {
  const profile = buildProjectProfile(projectRoot, options);
  const roots = discoverCodeRoots(projectRoot, {
    scriptsRoots: profile.codeRoots?.map((r) => r.path),
    ...options,
  });
  if (!roots.length) {
    throw new Error("No code roots found under Assets/**/Scripts — set scriptsRoots in .cursor/project-map.json");
  }
  const allFiles = collectAllCsFiles(projectRoot, roots);
  const moduleMap = scanFiles(projectRoot, roots, allFiles);
  return writeIndexOutputs(projectRoot, moduleMap, roots, profile);
}

/** Alias */
export function buildCodebaseIndex(projectRoot, options = {}) {
  return buildProjectIndex(projectRoot, options).summary;
}

/** Incremental: rescan added/changed files; full rebuild if removed or no index. */
export function applyIndexDelta(projectRoot, options = {}) {
  const status = readIndexStatus(projectRoot);
  const roots = discoverCodeRoots(projectRoot, options);
  if (!roots.length) throw new Error("No code roots found");

  const forceRaw = options.forceFiles?.length
    ? [...new Set(options.forceFiles.map((f) => f.replace(/\\/g, "/")))]
    : null;
  const forceFiles = forceRaw
    ? forceRaw.filter((f) => f.endsWith(".cs") && /\/Scripts\//i.test(f))
    : null;

  if (forceFiles?.length && !status.hasIndex) {
    return buildProjectIndex(projectRoot, options);
  }

  if (forceFiles?.length) {
    const toScan = forceFiles;
    const modulesDir = path.join(indexRoot(projectRoot), "modules");
    const moduleMap = loadModuleMap(modulesDir);
    mergeDeltaScan(projectRoot, roots, moduleMap, toScan);
    const profile = readJson(profilePath(projectRoot)) ?? buildProjectProfile(projectRoot, options);
    const result = writeIndexOutputs(projectRoot, moduleMap, roots, profile);
    return {
      ...result,
      delta: { scanned: toScan.length, forced: true, added: 0, changed: toScan.length },
    };
  }

  const allFiles = collectAllCsFiles(projectRoot, roots);
  const diff = compareFileManifest(projectRoot, allFiles);

  if (diff.needsFullBuild || diff.removed > 0 || !status.hasIndex) {
    return buildProjectIndex(projectRoot, options);
  }

  const toScan = [...new Set([...(diff.newFiles || []), ...(diff.changedFiles || [])])];
  if (!toScan.length && !status.staleMarker) {
    return {
      summary: JSON.parse(fs.readFileSync(summaryPath(projectRoot), "utf8")),
      delta: { scanned: 0, message: "index up to date" },
    };
  }

  const modulesDir = path.join(indexRoot(projectRoot), "modules");
  const moduleMap = loadModuleMap(modulesDir);
  mergeDeltaScan(projectRoot, roots, moduleMap, toScan);

  const profile = readJson(profilePath(projectRoot)) ?? buildProjectProfile(projectRoot, options);
  const result = writeIndexOutputs(projectRoot, moduleMap, roots, profile);
  return { ...result, delta: { scanned: toScan.length, added: diff.added, changed: diff.changed } };
}

function loadModuleMap(modulesDir) {
  const moduleMap = new Map();
  if (!fs.existsSync(modulesDir)) return moduleMap;
  for (const f of fs.readdirSync(modulesDir).filter((x) => x.endsWith(".json"))) {
    const mod = JSON.parse(fs.readFileSync(path.join(modulesDir, f), "utf8"));
    moduleMap.set(mod.id, {
      id: mod.id,
      files: [...new Set(mod.types.map((t) => t.file))],
      types: [...mod.types],
      roots: new Set(mod.roots || []),
    });
  }
  return moduleMap;
}

function mergeDeltaScan(projectRoot, roots, moduleMap, toScan) {
  const scannedPaths = new Set(toScan);
  for (const mod of moduleMap.values()) {
    mod.types = mod.types.filter((t) => !scannedPaths.has(t.file));
  }

  const deltaMap = scanFiles(projectRoot, roots, toScan);
  for (const [modId, deltaMod] of deltaMap) {
    if (!moduleMap.has(modId)) {
      moduleMap.set(modId, { id: modId, files: [], types: [], roots: new Set() });
    }
    const mod = moduleMap.get(modId);
    for (const r of deltaMod.roots) mod.roots.add(r);
    mod.types.push(...deltaMod.types);
    mod.files = [...new Set(mod.types.map((t) => t.file))];
  }

  for (const [id, mod] of [...moduleMap.entries()]) {
    if (!mod.types.length) moduleMap.delete(id);
  }
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function readIndexStatusText(projectRoot) {
  const s = readIndexStatus(projectRoot);
  const stale = s.staleMarker;
  const lines = [
    `profile=${s.hasProfile} index=${s.hasIndex}`,
    `indexBuiltAt=${s.indexBuiltAt ?? "never"}`,
    `codeRoots=${s.codeRoots.map((r) => r.path).join("; ") || "none"}`,
    `stale=${s.stale}`,
  ];
  if (stale) lines.push(`staleReason=${stale.reason} at=${stale.at}`);
  if (s.diff) {
    lines.push(`diff added=${s.diff.added} changed=${s.diff.changed} removed=${s.diff.removed}`);
  }
  if (s.stale) lines.push("→ agent_apply_index_delta or agent_build_project_index");
  else if (!s.hasIndex) lines.push("→ agent_build_project_index");
  return { text: lines.join("\n"), isError: false, status: s };
}

export function readProjectSummary(projectRoot, projectMapPath) {
  const status = readIndexStatus(projectRoot);
  const staleLine = status.stale
    ? `WARN STALE — ${status.staleMarker?.reason ?? "files changed"} (+${status.diff.added} ~${status.diff.changed} -${status.diff.removed})\n`
    : "";

  const p = summaryPath(projectRoot);
  if (!fs.existsSync(p)) {
    const prof = readProjectProfileText(projectRoot);
    return {
      text:
        staleLine +
        "codebase index missing\n" +
        (prof.isError ? prof.text : prof.text.split("\n").slice(0, 6).join("\n") + "\n→ agent_build_project_index"),
      isError: true,
    };
  }
  const summary = JSON.parse(fs.readFileSync(p, "utf8"));
  let map = null;
  const mapPath = projectMapPath ?? path.join(projectRoot, ".cursor", "project-map.json");
  if (fs.existsSync(mapPath)) map = JSON.parse(fs.readFileSync(mapPath, "utf8"));

  const lines = [
    staleLine.trim(),
    `index builtAt=${summary.builtAt}`,
    `roots=${(summary.codeRoots || []).map((r) => r.path).join(", ")}`,
    `files=${summary.stats.files} types=${summary.stats.types} modules=${summary.stats.modules}`,
  ].filter(Boolean);
  if (map?.project) lines.push(`project=${map.project}`);
  if (map?.canonicalFlow) lines.push(`flow=${map.canonicalFlow}`);
  lines.push("--- modules (id | types | hint) ---");
  for (const m of summary.modules) {
    const hint = map?.modules?.[m.id.split(".").pop()]?.purpose ?? map?.modules?.[m.id]?.purpose ?? "";
    lines.push(`${m.id} | ${m.typeCount} types | ${hint}`.trimEnd());
  }
  if (map?.entryPoints?.length) {
    lines.push("--- entry points ---");
    for (const e of map.entryPoints) lines.push(`- ${e.label}: ${e.path}`);
  }
  if (status.stale) lines.push("→ agent_apply_index_delta before deep code read");
  return { text: lines.join("\n"), isError: false, summary };
}

export function readModuleIndex(projectRoot, moduleId, typeLimit = 40) {
  const modPath = path.join(indexRoot(projectRoot), "modules", `${moduleId}.json`);
  if (!fs.existsSync(modPath)) {
    return {
      text: `module not found: ${moduleId}\n→ agent_read_project_index for ids`,
      isError: true,
    };
  }
  const mod = JSON.parse(fs.readFileSync(modPath, "utf8"));
  const mapPath = path.join(projectRoot, ".cursor", "project-map.json");
  let hint = "";
  if (fs.existsSync(mapPath)) {
    const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    const key = moduleId.includes(".") ? moduleId.split(".").pop() : moduleId;
    hint = map.modules?.[key]?.purpose ?? map.modules?.[moduleId]?.purpose ?? "";
  }
  const lines = [
    `module=${moduleId} files=${mod.fileCount ?? "?"} types=${mod.types?.length}`,
    mod.roots?.length ? `roots=${mod.roots.join(", ")}` : "",
    hint ? `purpose=${hint}` : "",
    "--- types (name | kind | file | public API) ---",
  ].filter(Boolean);
  const show = (mod.types || []).slice(0, typeLimit);
  for (const t of show) {
    const api = (t.publicMembers || []).slice(0, 8).join(", ");
    lines.push(`${t.name} | ${t.kind} | ${t.file}${api ? ` | ${api}` : ""}`);
  }
  if ((mod.types || []).length > typeLimit) {
    lines.push(`... +${mod.types.length - typeLimit} types — agent_read_type_outline`);
  }
  return { text: lines.join("\n"), isError: false };
}

export function readTypeOutline(projectRoot, typeName, moduleId) {
  const modulesDir = path.join(indexRoot(projectRoot), "modules");
  const files = moduleId
    ? [path.join(modulesDir, `${moduleId}.json`)]
    : fs.existsSync(modulesDir)
      ? fs.readdirSync(modulesDir).map((f) => path.join(modulesDir, f))
      : [];
  for (const fp of files) {
    if (!fs.existsSync(fp)) continue;
    const mod = JSON.parse(fs.readFileSync(fp, "utf8"));
    const t = (mod.types || []).find((x) => x.name === typeName);
    if (t) {
      return {
        text: [
          `type=${t.name} kind=${t.kind} ns=${t.namespace ?? "?"}`,
          `file=${t.file}`,
          `publicMembers=${(t.publicMembers || []).join(", ") || "(none parsed)"}`,
          "→ Read file only if members insufficient",
        ].join("\n"),
        isError: false,
      };
    }
  }
  return {
    text: `type not found: ${typeName}${moduleId ? ` in ${moduleId}` : ""}\n→ agent_read_module_index`,
    isError: true,
  };
}

const INDEX_STALE_DAYS = 7;
const CONTENT_SEARCH_MAX_BYTES = 51200;

function isIndexStale(projectRoot) {
  const p = summaryPath(projectRoot);
  if (!fs.existsSync(p)) return true;
  const ageMs = Date.now() - fs.statSync(p).mtimeMs;
  return ageMs > INDEX_STALE_DAYS * 24 * 60 * 60 * 1000;
}

function resolveModuleFile(projectRoot, moduleId) {
  const exact = path.join(indexRoot(projectRoot), "modules", `${moduleId}.json`);
  if (fs.existsSync(exact)) return exact;

  const modulesDir = path.join(indexRoot(projectRoot), "modules");
  if (!fs.existsSync(modulesDir)) return null;

  const files = fs.readdirSync(modulesDir).filter((f) => f.endsWith(".json"));
  const lower = moduleId.toLowerCase();
  const matches = files.filter((f) => {
    const id = f.replace(/\.json$/, "");
    return id === moduleId || id.endsWith(`.${moduleId}`) || id.toLowerCase().includes(lower);
  });
  if (matches.length === 1) {
    return path.join(modulesDir, matches[0]);
  }
  if (matches.length > 1) {
    return { ambiguous: matches.map((f) => f.replace(/\.json$/, "")) };
  }
  return null;
}

function searchMembers(mod, pattern, maxResults) {
  const re = new RegExp(pattern, "i");
  const hits = [];
  const seenFiles = new Set(mod.files ?? []);

  for (const t of mod.types ?? []) {
    if (re.test(t.name)) {
      hits.push({ symbol: t.name, kind: t.kind ?? "type", file: t.file, matchIn: "type" });
    }
    for (const m of t.publicMembers ?? []) {
      if (re.test(m)) {
        hits.push({ symbol: m, kind: "member", file: t.file, type: t.name, matchIn: "member" });
      }
    }
    if (hits.length >= maxResults) break;
  }

  if (hits.length < maxResults && re.source.length >= 2) {
    for (const f of seenFiles) {
      const base = f.split("/").pop();
      if (re.test(base)) {
        hits.push({ symbol: base, kind: "file", file: f, matchIn: "filename" });
      }
      if (hits.length >= maxResults) break;
    }
  }
  return hits.slice(0, maxResults);
}

function searchContent(projectRoot, files, pattern, maxResults) {
  const re = new RegExp(pattern, "i");
  const hits = [];

  for (const rel of files) {
    const full = path.join(projectRoot, rel.replace(/\//g, path.sep));
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.size > CONTENT_SEARCH_MAX_BYTES) continue;

    const lines = fs.readFileSync(full, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      hits.push({
        file: rel,
        line: i + 1,
        text: lines[i].trim().slice(0, 120),
        matchIn: "content",
      });
      if (hits.length >= maxResults) return hits;
    }
  }
  return hits;
}

/**
 * Scoped search within one module index.
 * @param {string} projectRoot
 * @param {{ moduleId: string, pattern: string, searchIn?: string, maxResults?: number }} opts
 */
export function findInModule(projectRoot, opts) {
  const moduleId = opts.moduleId;
  const pattern = opts.pattern;
  const searchIn = opts.searchIn ?? "members";
  const maxResults = opts.maxResults ?? 20;

  if (!moduleId || !pattern) {
    return {
      text: "moduleId and pattern required",
      isError: true,
      hits: [],
    };
  }

  const resolved = resolveModuleFile(projectRoot, moduleId);
  if (!resolved) {
    return {
      text: `module not found: ${moduleId}\n→ agent_read_project_index for module ids`,
      isError: true,
      hits: [],
    };
  }
  if (resolved.ambiguous) {
    return {
      text: `ambiguous moduleId: ${moduleId}\nmatches: ${resolved.ambiguous.join(", ")}\n→ use full module id`,
      isError: true,
      hits: [],
    };
  }

  const mod = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const indexStale = isIndexStale(projectRoot);
  let hits = [];

  if (searchIn === "content") {
    const files = [...new Set((mod.types ?? []).map((t) => t.file).filter(Boolean))];
    if (!files.length && mod.files) {
      /* legacy */
    }
    const fileList = files.length
      ? files
      : [...new Set((mod.types ?? []).map((t) => t.file))];
    hits = searchContent(projectRoot, fileList, pattern, maxResults);
  } else if (searchIn === "files") {
    const re = new RegExp(pattern, "i");
    hits = [...new Set((mod.types ?? []).map((t) => t.file))]
      .filter((f) => re.test(f))
      .slice(0, maxResults)
      .map((f) => ({ file: f, matchIn: "filepath" }));
  } else {
    hits = searchMembers(mod, pattern, maxResults);
  }

  const lines = [
    `find_in_module module=${mod.id} pattern=${pattern} searchIn=${searchIn} hits=${hits.length}`,
    indexStale ? "indexStale=true (>7d) → agent_apply_index_delta" : "indexStale=false",
    "--- hits ---",
  ];
  for (const h of hits) {
    if (h.line) lines.push(`${h.file}:${h.line} | ${h.text}`);
    else if (h.symbol) lines.push(`${h.symbol} | ${h.kind} | ${h.file}${h.type ? ` (${h.type})` : ""}`);
    else lines.push(`${h.file}`);
  }
  if (!hits.length) lines.push("(no matches) → try searchIn=content or broader pattern");

  return { text: lines.join("\n"), isError: false, hits, indexStale, moduleId: mod.id };
}
