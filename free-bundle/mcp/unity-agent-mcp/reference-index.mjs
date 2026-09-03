/**
 * PKE Phase 4.2 — reference index SSOT references.jsonl + derived symbol shards.
 */
import fs from "node:fs";
import path from "node:path";
import { discoverCodeRoots, listCsFilesUnder } from "./project-profile.mjs";
import {
  SCAN_CAPS,
  buildSymbolShardsFromEdges,
  scanFileForEdges,
  sortEdges,
} from "./reference-scan.mjs";
import { buildFlowByModule } from "./reference-flow-export.mjs";

export const REFERENCE_CAPS = {
  maxSitesPerSymbol: 48,
  maxTypeSymbols: 8000,
  formatVersion: 2,
};

const VALID_DIRECTIONS = new Set(["callers", "callees", "related"]);

export const REFERENCE_SCOPE = "Assets/**/Scripts";

const TYPE_DECL =
  /^\s*(?:public|internal|protected|private)?\s*(?:partial\s+)?(?:sealed\s+|abstract\s+|static\s+)*?(class|interface|struct|enum|record)\s+(\w+)/gm;

function relPosix(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

export function referencesRoot(projectRoot) {
  return path.join(projectRoot, ".cursor", "project-knowledge", "references");
}

export function referencesJsonlPath(projectRoot) {
  return path.join(referencesRoot(projectRoot), "references.jsonl");
}

export function referencesSymbolsDir(projectRoot) {
  return path.join(referencesRoot(projectRoot), "symbols");
}

export function referencesManifestPath(projectRoot) {
  return path.join(referencesRoot(projectRoot), "manifest.json");
}

export function symbolShardPath(projectRoot, symbol) {
  return path.join(referencesSymbolsDir(projectRoot), `${sanitizeSymbolFileName(symbol)}.json`);
}

export function sanitizeSymbolFileName(symbol) {
  if (!symbol) return "_";
  return symbol.replace(/[^A-Za-z0-9_.-]/g, "_");
}

export function discoverScriptCsFiles(projectRoot) {
  const roots = discoverCodeRoots(projectRoot, {});
  const files = new Set();
  for (const root of roots) {
    for (const rel of listCsFilesUnder(root.full, projectRoot)) {
      if (/\/Scripts\//i.test(rel)) files.add(rel);
    }
  }
  return [...files].sort();
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function loadTypesFromSummary(projectRoot) {
  const summaryPath = path.join(projectRoot, ".cursor", "codebase-index", "project-summary.json");
  const summary = readJsonSafe(summaryPath);
  if (!summary) return null;
  const names = new Set();
  for (const mod of summary.modules ?? []) {
    for (const t of mod.types ?? []) {
      if (t) names.add(t);
    }
  }
  return names.size ? names : null;
}

function loadTypesFromModuleShards(projectRoot) {
  const modulesDir = path.join(projectRoot, ".cursor", "codebase-index", "modules");
  if (!fs.existsSync(modulesDir)) return new Set();
  const names = new Set();
  for (const file of fs.readdirSync(modulesDir)) {
    if (!file.endsWith(".json")) continue;
    const mod = readJsonSafe(path.join(modulesDir, file));
    for (const t of mod?.types ?? []) {
      if (typeof t === "string") names.add(t);
      else if (t?.name) names.add(t.name);
    }
  }
  return names;
}

function fallbackScanTypes(projectRoot, scriptFiles) {
  const names = new Set();
  for (const rel of scriptFiles) {
    const full = path.join(projectRoot, rel.replace(/\//g, path.sep));
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, "utf8");
    TYPE_DECL.lastIndex = 0;
    let m;
    while ((m = TYPE_DECL.exec(text)) !== null) {
      names.add(m[2]);
      if (names.size >= REFERENCE_CAPS.maxTypeSymbols) return names;
    }
  }
  return names;
}

export function loadTypeSymbols(projectRoot, scriptFiles = null) {
  const fromSummary = loadTypesFromSummary(projectRoot);
  let names = fromSummary ?? loadTypesFromModuleShards(projectRoot);
  if (!names.size) {
    names = fallbackScanTypes(projectRoot, scriptFiles ?? discoverScriptCsFiles(projectRoot));
  }
  if (names.size > REFERENCE_CAPS.maxTypeSymbols) {
    const trimmed = [...names].sort().slice(0, REFERENCE_CAPS.maxTypeSymbols);
    return new Set(trimmed);
  }
  return names;
}

function loadFilePrimaryTypes(projectRoot) {
  const modulesDir = path.join(projectRoot, ".cursor", "codebase-index", "modules");
  const map = new Map();
  if (!fs.existsSync(modulesDir)) return map;
  for (const file of fs.readdirSync(modulesDir)) {
    if (!file.endsWith(".json")) continue;
    const mod = readJsonSafe(path.join(modulesDir, file));
    for (const t of mod?.types ?? []) {
      if (typeof t === "string") continue;
      if (t?.name && t?.file && !map.has(t.file)) map.set(t.file, t.name);
    }
  }
  return map;
}

function writeJsonlAtomic(jsonlPath, edges) {
  const dir = path.dirname(jsonlPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${jsonlPath}.tmp`;
  const body = edges.map((e) => JSON.stringify(e)).join("\n") + (edges.length ? "\n" : "");
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, jsonlPath);
}

function writeDerivedShards(projectRoot, siteMap) {
  const symbolsDir = referencesSymbolsDir(projectRoot);
  if (fs.existsSync(symbolsDir)) {
    for (const f of fs.readdirSync(symbolsDir)) {
      if (f.endsWith(".json")) fs.unlinkSync(path.join(symbolsDir, f));
    }
  } else {
    fs.mkdirSync(symbolsDir, { recursive: true });
  }

  let symbolCount = 0;
  for (const [symbol, sites] of siteMap) {
    if (!sites?.length) continue;
    symbolCount++;
    const shard = { schemaVersion: 1, symbol, sites };
    fs.writeFileSync(
      path.join(symbolsDir, `${sanitizeSymbolFileName(symbol)}.json`),
      JSON.stringify(shard, null, 2) + "\n",
      "utf8"
    );
  }
  return symbolCount;
}

export function buildReferenceIndex(projectRoot, options = {}) {
  const scriptFiles = options.scriptFiles ?? discoverScriptCsFiles(projectRoot);
  const typeSet = loadTypeSymbols(projectRoot, scriptFiles);
  const filePrimaryTypes = loadFilePrimaryTypes(projectRoot);
  const allEdges = [];
  let capsApplied = false;

  for (const relFile of scriptFiles) {
    if (allEdges.length >= SCAN_CAPS.maxEdgesProject) {
      capsApplied = true;
      break;
    }
    const full = path.join(projectRoot, relFile.replace(/\//g, path.sep));
    if (!fs.existsSync(full)) continue;
    const fileEdges = scanFileForEdges(
      relFile,
      full,
      typeSet,
      filePrimaryTypes.get(relFile) ?? null
    );
    for (const e of fileEdges) {
      allEdges.push(e);
      if (allEdges.length >= SCAN_CAPS.maxEdgesProject) {
        capsApplied = true;
        break;
      }
    }
  }

  const edges = sortEdges(allEdges);
  fs.mkdirSync(referencesRoot(projectRoot), { recursive: true });
  writeJsonlAtomic(referencesJsonlPath(projectRoot), edges);

  const siteMap = buildSymbolShardsFromEdges(edges, REFERENCE_CAPS.maxSitesPerSymbol);
  const symbolCount = writeDerivedShards(projectRoot, siteMap);
  const edgeCount = edges.length;

  const subManifest = {
    schemaVersion: 1,
    formatVersion: REFERENCE_CAPS.formatVersion,
    builtAt: new Date().toISOString(),
    scope: REFERENCE_SCOPE,
    fileCount: scriptFiles.length,
    symbolCount,
    edgeCount,
    capsApplied: capsApplied || undefined,
    reason: options.reason ?? null,
  };
  fs.writeFileSync(referencesManifestPath(projectRoot), JSON.stringify(subManifest, null, 2) + "\n", "utf8");

  buildFlowByModule(projectRoot, edges);

  return { subManifest, symbolCount, edgeCount, fileCount: scriptFiles.length, edges };
}

function readAllReferenceEdges(projectRoot) {
  const jsonlPath = referencesJsonlPath(projectRoot);
  if (!fs.existsSync(jsonlPath)) return [];
  const edges = [];
  for (const line of fs.readFileSync(jsonlPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      edges.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return edges;
}

/**
 * Incremental reference update — rescan only scriptFiles in batch.
 */
export function applyReferenceDelta(projectRoot, options = {}) {
  const scriptFiles = (options.scriptFiles ?? [])
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => f.endsWith(".cs") && /\/Scripts\//i.test(f));

  if (!scriptFiles.length) {
    return buildReferenceIndex(projectRoot, options);
  }

  const allProjectFiles = discoverScriptCsFiles(projectRoot);
  if (scriptFiles.length > allProjectFiles.length * 0.5) {
    return buildReferenceIndex(projectRoot, { ...options, reason: options.reason ?? "git-import-full" });
  }

  const fileSet = new Set(scriptFiles);
  let edges = readAllReferenceEdges(projectRoot);
  edges = edges.filter((e) => !fileSet.has(e.fromFile));

  const typeSet = loadTypeSymbols(projectRoot, allProjectFiles);
  const filePrimaryTypes = loadFilePrimaryTypes(projectRoot);
  let capsApplied = false;

  for (const relFile of scriptFiles) {
    if (edges.length >= SCAN_CAPS.maxEdgesProject) {
      capsApplied = true;
      break;
    }
    const full = path.join(projectRoot, relFile.replace(/\//g, path.sep));
    if (!fs.existsSync(full)) continue;
    const fileEdges = scanFileForEdges(relFile, full, typeSet, filePrimaryTypes.get(relFile) ?? null);
    for (const e of fileEdges) {
      edges.push(e);
      if (edges.length >= SCAN_CAPS.maxEdgesProject) {
        capsApplied = true;
        break;
      }
    }
  }

  edges = sortEdges(edges);
  fs.mkdirSync(referencesRoot(projectRoot), { recursive: true });
  writeJsonlAtomic(referencesJsonlPath(projectRoot), edges);

  const siteMap = buildSymbolShardsFromEdges(edges, REFERENCE_CAPS.maxSitesPerSymbol);
  const symbolCount = writeDerivedShards(projectRoot, siteMap);
  const edgeCount = edges.length;

  const subManifest = {
    schemaVersion: 1,
    formatVersion: REFERENCE_CAPS.formatVersion,
    builtAt: new Date().toISOString(),
    scope: REFERENCE_SCOPE,
    fileCount: allProjectFiles.length,
    symbolCount,
    edgeCount,
    capsApplied: capsApplied || undefined,
    reason: options.reason ?? "git-import-delta",
    deltaFiles: scriptFiles.length,
  };
  fs.writeFileSync(referencesManifestPath(projectRoot), JSON.stringify(subManifest, null, 2) + "\n", "utf8");

  buildFlowByModule(projectRoot, edges);

  return { subManifest, symbolCount, edgeCount, fileCount: scriptFiles.length, edges, delta: true };
}

export function readReferencesSubManifest(projectRoot) {
  return readJsonSafe(referencesManifestPath(projectRoot));
}

export function readSymbolShard(projectRoot, symbol) {
  const p = symbolShardPath(projectRoot, symbol);
  if (!fs.existsSync(p)) return null;
  return readJsonSafe(p);
}

export function readReferenceEdges(projectRoot, filter = {}) {
  const jsonlPath = referencesJsonlPath(projectRoot);
  if (!fs.existsSync(jsonlPath)) return [];

  const { toType, fromType, fromFile, limit = 80_000 } = filter;
  const out = [];
  const lines = fs.readFileSync(jsonlPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    let edge;
    try {
      edge = JSON.parse(line);
    } catch {
      continue;
    }
    if (toType && edge.toType !== toType) continue;
    if (fromType && edge.fromType !== fromType) continue;
    if (fromFile && !edge.fromFile.includes(fromFile)) continue;
    out.push(edge);
    if (out.length >= limit) break;
  }
  return out;
}

export function queryReferencesToType(projectRoot, toType, options = {}) {
  return readReferenceEdges(projectRoot, {
    toType,
    fromType: options.fromType,
    fromFile: options.fromFile,
    limit: options.limit ?? REFERENCE_CAPS.maxSitesPerSymbol,
  });
}

export function queryReferencesFromType(projectRoot, fromType, options = {}) {
  return readReferenceEdges(projectRoot, {
    fromType,
    fromFile: options.fromFile,
    limit: options.limit ?? REFERENCE_CAPS.maxSitesPerSymbol,
  });
}

function edgeToCaller(edge) {
  return {
    file: edge.fromFile,
    line: edge.line,
    kind: "type",
    fromType: edge.fromType,
    toType: edge.toType,
  };
}

function edgeToCallee(edge) {
  return {
    file: edge.fromFile,
    line: edge.line,
    kind: "type",
    fromType: edge.fromType,
    toType: edge.toType,
  };
}

function normalizeDirection(direction) {
  const d = (direction ?? "related").trim().toLowerCase();
  return VALID_DIRECTIONS.has(d) ? d : "related";
}

/**
 * Unified reference lookup with direction=callers|callees|related.
 */
export function findReferencesCompact(projectRoot, options = {}) {
  const symbol = (options.symbol ?? "").trim();
  if (!symbol) {
    return {
      text: "status=error\nsymbol required",
      isError: true,
      source: "missing",
      callers: [],
      callees: [],
    };
  }

  const ctx = resolveReferenceContext(projectRoot);
  const limit = Math.min(Math.max(options.limit ?? 24, 1), REFERENCE_CAPS.maxSitesPerSymbol);
  const direction = normalizeDirection(options.direction);
  const fromTypeFilter = options.fromType?.trim() || null;
  const fromFileFilter = options.fromFile?.trim() || null;

  if (ctx.source === "missing") {
    return {
      text: "status=missing\nsource=missing\n→ unity_bridge_invoke rebuild_reference_index or compile in Unity",
      isError: true,
      source: "missing",
      callers: [],
      callees: [],
    };
  }

  let callers = [];
  let callees = [];
  const format = ctx.hasJsonl ? "jsonl" : "shard";

  if (ctx.hasJsonl) {
    if (direction === "callers" || direction === "related") {
      const edges = queryReferencesToType(projectRoot, symbol, {
        fromType: fromTypeFilter,
        fromFile: fromFileFilter,
        limit: 10_000,
      });
      callers = edges
        .filter((e) => e.fromType !== e.toType)
        .slice(0, limit)
        .map(edgeToCaller);
    }
    if (direction === "callees" || direction === "related") {
      const edges = queryReferencesFromType(projectRoot, symbol, {
        fromFile: fromFileFilter,
        limit: 10_000,
      });
      callees = edges
        .filter((e) => e.fromType !== e.toType)
        .slice(0, limit)
        .map(edgeToCallee);
    }
  } else {
    const shard = readSymbolShard(projectRoot, symbol);
    if (shard?.sites?.length) {
      callers = shard.sites
        .filter((s) => s.fromType !== symbol)
        .slice(0, limit)
        .map((s) => ({
          file: s.file,
          line: s.line,
          kind: s.kind ?? "type",
          fromType: s.fromType,
          toType: symbol,
        }));
    }
  }

  const hits = direction === "callers" ? callers.length : direction === "callees" ? callees.length : callers.length + callees.length;

  const lines = [
    `status=ok`,
    `source=${ctx.source}`,
    `format=${format}`,
    `direction=${direction}`,
    `symbol=${symbol}`,
    fromTypeFilter ? `fromType=${fromTypeFilter}` : null,
    fromFileFilter ? `fromFile=${fromFileFilter}` : null,
    `hits=${hits}`,
  ].filter(Boolean);

  if (ctx.stale) lines.push("warning=references-stale");

  if (direction === "callers" || direction === "related") {
    for (const c of callers) {
      lines.push(`caller ${c.file}:${c.line} from=${c.fromType} → ${symbol}`);
    }
  }
  if (direction === "callees" || direction === "related") {
    for (const c of callees) {
      lines.push(`callee ${c.file}:${c.line} → ${c.toType} (from ${symbol})`);
    }
  }

  const compact = {
    symbol,
    direction,
    callers: direction === "callees" ? [] : callers,
    callees: direction === "callers" ? [] : callees,
    hits,
    format,
  };

  return {
    text: lines.join("\n"),
    isError: false,
    source: ctx.source,
    format,
    direction,
    callers,
    callees,
    stale: ctx.stale,
    compact,
  };
}

export function findReferences(projectRoot, options = {}) {
  const method = options.method?.trim() || null;
  if (method) {
    return findReferencesLegacyMethod(projectRoot, options);
  }
  return findReferencesCompact(projectRoot, options);
}

function findReferencesLegacyMethod(projectRoot, options) {
  const symbol = (options.symbol ?? "").trim();
  const ctx = resolveReferenceContext(projectRoot);
  const limit = Math.min(Math.max(options.limit ?? 24, 1), REFERENCE_CAPS.maxSitesPerSymbol);
  const method = options.method?.trim();
  const shard = readSymbolShard(projectRoot, symbol);
  const callers = (shard?.sites ?? [])
    .filter((s) => s.kind === "call" && s.method === method)
    .slice(0, limit)
    .map((s) => ({
      file: s.file,
      line: s.line,
      kind: s.kind,
      method: s.method,
    }));

  const lines = [
    `status=ok`,
    `source=${ctx.source}`,
    `format=shard`,
    `symbol=${symbol}`,
    `method=${method}`,
    `hits=${callers.length}`,
  ];
  for (const c of callers) {
    lines.push(`${c.file}:${c.line} call:${c.method}`);
  }
  return {
    text: lines.join("\n"),
    isError: false,
    source: ctx.source,
    format: "shard",
    callers,
    compact: { symbol, method, hits: callers.length, callers },
  };
}

export function resolveReferenceContext(projectRoot) {
  const pkeManifestPath = path.join(projectRoot, ".cursor", "project-knowledge", "manifest.json");
  const pke = readJsonSafe(pkeManifestPath);
  const refs = pke?.subsystems?.references ?? {};
  const sub = readReferencesSubManifest(projectRoot);
  const hasJsonl = fs.existsSync(referencesJsonlPath(projectRoot));
  const hasShards = fs.existsSync(referencesSymbolsDir(projectRoot));
  const stale = refs.enabled && refs.fresh === false;
  const formatVersion = sub?.formatVersion ?? (hasJsonl ? 2 : 1);
  let source = "missing";
  if (hasJsonl) source = "pke";
  else if (sub && hasShards) source = "pke";
  return { source, stale, pke, sub, refs, formatVersion, hasJsonl };
}

export function readReferencesHealth(projectRoot) {
  const ctx = resolveReferenceContext(projectRoot);
  const sub = ctx.sub;
  return {
    referencesFresh: ctx.refs.fresh === true,
    referencesEnabled: ctx.refs.enabled === true,
    referenceSymbols: sub?.symbolCount ?? 0,
    referenceEdges: sub?.edgeCount ?? 0,
    referencesFormat: sub?.formatVersion ?? ctx.formatVersion,
    referencesError: ctx.refs.error ?? null,
    referencesBuiltAt: sub?.builtAt ?? null,
    referencesStale: ctx.stale,
  };
}

export function readPkeReferencesFresh(projectRoot) {
  const pke = readJsonSafe(path.join(projectRoot, ".cursor", "project-knowledge", "manifest.json"));
  const refs = pke?.subsystems?.references;
  if (!refs?.enabled) return null;
  return refs.fresh === true;
}
