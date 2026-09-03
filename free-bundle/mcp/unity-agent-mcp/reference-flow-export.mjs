/**
 * PKE Phase 4.5 — aggregate reference edges per codebase module.
 */
import fs from "node:fs";
import path from "node:path";
import { readReferenceEdges, referencesRoot } from "./reference-index.mjs";

export const FLOW_CAPS = {
  maxEdgesPerModule: 16,
  maxSampleFrom: 3,
};

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Map project-relative file path → moduleId from codebase-index modules. */
export function buildFileToModuleMap(projectRoot) {
  const modulesDir = path.join(projectRoot, ".cursor", "codebase-index", "modules");
  const map = new Map();
  if (!fs.existsSync(modulesDir)) return map;

  for (const file of fs.readdirSync(modulesDir)) {
    if (!file.endsWith(".json")) continue;
    const mod = readJsonSafe(path.join(modulesDir, file));
    if (!mod?.id) continue;
    for (const t of mod.types ?? []) {
      if (typeof t === "string") continue;
      if (t?.file) map.set(t.file.replace(/\\/g, "/"), mod.id);
    }
    for (const f of mod.files ?? []) {
      const rel = typeof f === "string" ? f : f?.path;
      if (rel) map.set(rel.replace(/\\/g, "/"), mod.id);
    }
  }
  return map;
}

function moduleIdForFile(fileToModule, fromFile) {
  const norm = fromFile.replace(/\\/g, "/");
  if (fileToModule.has(norm)) return fileToModule.get(norm);
  const parts = norm.split("/");
  if (parts.length > 2) return parts.slice(0, 3).join("/");
  return "_unknown";
}

export function flowByModulePath(projectRoot) {
  return path.join(referencesRoot(projectRoot), "flow-by-module.json");
}

/**
 * Build flow-by-module.json from references.jsonl edges.
 */
export function buildFlowByModule(projectRoot, edges = null) {
  const allEdges = edges ?? readReferenceEdges(projectRoot, { limit: 80_000 });
  const fileToModule = buildFileToModuleMap(projectRoot);
  const moduleAgg = new Map();

  for (const e of allEdges) {
    const modId = moduleIdForFile(fileToModule, e.fromFile);
    if (!moduleAgg.has(modId)) moduleAgg.set(modId, new Map());
    const toMap = moduleAgg.get(modId);
    if (!toMap.has(e.toType)) {
      toMap.set(e.toType, { toType: e.toType, count: 0, sampleFrom: new Set() });
    }
    const entry = toMap.get(e.toType);
    entry.count++;
    if (entry.sampleFrom.size < FLOW_CAPS.maxSampleFrom) {
      entry.sampleFrom.add(e.fromType);
    }
  }

  const modules = {};
  for (const [modId, toMap] of moduleAgg) {
    const topEdges = [...toMap.values()]
      .sort((a, b) => b.count - a.count || a.toType.localeCompare(b.toType))
      .slice(0, FLOW_CAPS.maxEdgesPerModule)
      .map((e) => ({
        toType: e.toType,
        count: e.count,
        sampleFrom: [...e.sampleFrom],
      }));
    if (topEdges.length) modules[modId] = { topEdges };
  }

  const out = {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    modules,
  };

  const outPath = flowByModulePath(projectRoot);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  return out;
}

export function readFlowByModule(projectRoot) {
  return readJsonSafe(flowByModulePath(projectRoot));
}

export function getModuleFlowEdges(projectRoot, moduleId, options = {}) {
  const flow = readFlowByModule(projectRoot);
  if (!flow?.modules) {
    return {
      text: "status=missing\n→ rebuild_reference_index",
      isError: true,
      topEdges: [],
    };
  }

  const limit = Math.min(Math.max(options.limit ?? FLOW_CAPS.maxEdgesPerModule, 1), 32);
  const id = (moduleId ?? "").trim();
  if (!id) {
    return { text: "status=error\nmoduleId required", isError: true, topEdges: [] };
  }

  const mod = flow.modules[id];
  if (!mod) {
    const partial = Object.keys(flow.modules).filter((k) => k.includes(id) || id.includes(k));
    const lines = [`status=ok`, `moduleId=${id}`, `hits=0`];
    if (partial.length) lines.push(`hint=${partial.slice(0, 5).join(",")}`);
    return { text: lines.join("\n"), isError: false, topEdges: [], moduleId: id };
  }

  const topEdges = (mod.topEdges ?? []).slice(0, limit);
  const lines = [`status=ok`, `moduleId=${id}`, `hits=${topEdges.length}`];
  for (const e of topEdges) {
    lines.push(`${e.toType} count=${e.count} from=${(e.sampleFrom ?? []).join(",")}`);
  }

  return {
    text: lines.join("\n"),
    isError: false,
    moduleId: id,
    topEdges,
    compact: { moduleId: id, topEdges },
  };
}
