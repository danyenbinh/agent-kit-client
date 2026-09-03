/**
 * Code layers — L0 registry → L1.5 module anchors → L2 module → L3 type digest.
 * Offline; rebuild anchors sau index delta.
 */
import fs from "node:fs";
import path from "node:path";
import { indexRoot, summaryPath } from "./project-profile.mjs";
import { readIndexStatus } from "./project-profile.mjs";

const TYPE_ANCHOR_RE =
  /Manager$|Controller$|System$|Handler$|Initializer$|Bootstrap|Helper$|Facade$|Hub$|Machine$|Context$|Spawner$|Panel$|BattleManager|GameManager/i;

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

export function layerRegistryPath(projectRoot) {
  return path.join(indexRoot(projectRoot), "code-layer-registry.json");
}

export function projectMapPath(projectRoot) {
  return path.join(projectRoot, ".cursor", "project-map.json");
}

export function moduleAnchorsDir(projectRoot) {
  return path.join(indexRoot(projectRoot), "module-anchors");
}

export function readProjectMap(projectRoot) {
  return readJson(projectMapPath(projectRoot)) ?? {};
}

export function readLayerRegistry(projectRoot) {
  const reg = readJson(layerRegistryPath(projectRoot));
  if (reg) return reg;
  const map = readProjectMap(projectRoot);
  if (map.layers) return map;
  return null;
}

function moduleKey(moduleId) {
  const parts = moduleId.split(".");
  return parts[parts.length - 1];
}

function layerForModule(moduleId, registry, map) {
  const prefix = moduleId.split(".")[0];
  for (const layer of registry?.layers ?? []) {
    if (layer.modulePrefix && prefix === layer.modulePrefix) return layer.id;
    if (layer.roots?.some((r) => moduleId.includes(r.replace(/\//g, "_")))) return layer.id;
  }
  if (prefix === "_DangerDungeon" || prefix === "Scripts") return "game";
  if (prefix === "_Skybull") return "framework";
  if (prefix.includes("External") || prefix.includes("Facebook")) return "plugins";
  const hint = map.modules?.[moduleKey(moduleId)]?.layer;
  return hint ?? "other";
}

export function extractModuleAnchors(mod, maxAnchors = 35) {
  const anchors = [];
  for (const t of mod.types ?? []) {
    const name = t.name ?? "";
    const members = t.publicMembers ?? [];
    const isAnchor =
      TYPE_ANCHOR_RE.test(name) ||
      members.length >= 6 ||
      (t.kind === "class" && /MonoBehaviour/.test(members.join(" ")));
    if (!isAnchor && members.length < 4) continue;

    anchors.push({
      name,
      kind: t.kind,
      file: t.file,
      api: members.slice(0, 24),
      score:
        (TYPE_ANCHOR_RE.test(name) ? 10 : 0) +
        Math.min(members.length, 8) +
        (name.endsWith("Manager") ? 5 : 0),
    });
  }
  anchors.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return anchors.slice(0, maxAnchors).map(({ score, ...rest }) => rest);
}

export function buildModuleAnchors(projectRoot) {
  const modulesDir = path.join(indexRoot(projectRoot), "modules");
  if (!fs.existsSync(modulesDir)) return [];

  const outDir = moduleAnchorsDir(projectRoot);
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];

  for (const file of fs.readdirSync(modulesDir).filter((f) => f.endsWith(".json"))) {
    const mod = readJson(path.join(modulesDir, file));
    if (!mod?.id) continue;
    const anchors = extractModuleAnchors(mod);
    if (!anchors.length) continue;

    const payload = {
      version: 1,
      moduleId: mod.id,
      builtAt: new Date().toISOString(),
      typeCount: mod.types?.length ?? 0,
      anchors,
    };
    const safeName = mod.id.replace(/[/\\?%*:|"<>]/g, "_");
    fs.writeFileSync(path.join(outDir, `${safeName}.json`), JSON.stringify(payload, null, 2) + "\n", "utf8");
    written.push({ moduleId: mod.id, anchors: anchors.length });
  }

  const manifest = {
    version: 1,
    builtAt: new Date().toISOString(),
    modules: written,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return written;
}

export function readCodeLayers(projectRoot) {
  const registry = readLayerRegistry(projectRoot);
  const map = readProjectMap(projectRoot);
  const summary = readJson(summaryPath(projectRoot));
  const status = readIndexStatus(projectRoot);
  const lines = ["code_layers (L0)"];

  if (registry?.layers) {
    for (const layer of registry.layers) {
      const mods = (summary?.modules ?? []).filter((m) => layerForModule(m.id, registry, map) === layer.id);
      const types = mods.reduce((s, m) => s + (m.typeCount ?? 0), 0);
      lines.push(`${layer.id}: ${layer.purpose ?? "?"} | modules=${mods.length} types≈${types}`);
    }
  } else {
    lines.push("(no code-layer-registry — see project-map.json)");
  }

  if (map.entryPoints?.length) {
    lines.push("--- entry points ---");
    for (const e of map.entryPoints) lines.push(`  ${e.label}: ${e.type ?? e.path}`);
  }

  if (status.stale) {
    lines.push(`STALE → agent_apply_index_delta then agent_rebuild_module_anchors`);
  } else {
    lines.push("→ agent_read_module_anchors moduleId=GameMechanic");
  }
  return { text: lines.join("\n"), isError: false };
}

export function readModuleAnchors(projectRoot, options = {}) {
  const { moduleId, layer, maxResults = 35 } = options;
  const map = readProjectMap(projectRoot);
  const registry = readLayerRegistry(projectRoot);

  if (layer && !moduleId) {
    const summary = readJson(summaryPath(projectRoot));
    const mods = (summary?.modules ?? []).filter(
      (m) => layerForModule(m.id, registry, map) === layer
    );
    const lines = [`module_anchors layer=${layer} count=${mods.length}`, "--- modules ---"];
    for (const m of mods.slice(0, 25)) {
      const key = moduleKey(m.id);
      const purpose = map.modules?.[key]?.purpose ?? "";
      lines.push(`  ${m.id} | ${m.typeCount} types | ${purpose}`);
    }
    lines.push("→ agent_read_module_anchors moduleId=_DangerDungeon.GameMechanic");
    return { text: lines.join("\n"), isError: false };
  }

  if (!moduleId) {
    const manifest = readJson(path.join(moduleAnchorsDir(projectRoot), "manifest.json"));
    const lines = ["module_anchors manifest", `modules=${manifest?.modules?.length ?? 0}`];
    for (const m of (manifest?.modules ?? []).slice(0, 30)) {
      lines.push(`  ${m.moduleId}: ${m.anchors} anchors`);
    }
    lines.push("→ agent_read_module_anchors moduleId=...");
    return { text: lines.join("\n"), isError: false };
  }

  let modPath = path.join(indexRoot(projectRoot), "modules", `${moduleId}.json`);
  if (!fs.existsSync(modPath)) {
    const modulesDir = path.join(indexRoot(projectRoot), "modules");
    const match = fs
      .readdirSync(modulesDir)
      .filter((f) => f.replace(".json", "") === moduleId || f.includes(moduleId));
    if (match.length === 1) modPath = path.join(modulesDir, match[0]);
  }

  const safeName = moduleId.replace(/[/\\?%*:|"<>]/g, "_");
  let anchorFile = readJson(path.join(moduleAnchorsDir(projectRoot), `${safeName}.json`));

  if (!anchorFile?.anchors?.length) {
    const mod = readJson(modPath);
    if (mod) {
      const anchors = extractModuleAnchors(mod, maxResults);
      anchorFile = { moduleId: mod.id, anchors };
    }
  }

  if (!anchorFile?.anchors?.length) {
    return {
      text: `no anchors for ${moduleId} — agent_build_project_index or agent_rebuild_module_anchors`,
      isError: true,
    };
  }

  const key = moduleKey(anchorFile.moduleId ?? moduleId);
  const purpose = map.modules?.[key]?.purpose ?? "";
  const lines = [
    `module=${anchorFile.moduleId ?? moduleId}`,
    purpose ? `purpose=${purpose}` : "",
    `anchors=${anchorFile.anchors.length}`,
    "--- type | kind | public API (index) ---",
  ].filter(Boolean);

  for (const a of anchorFile.anchors.slice(0, maxResults)) {
    const api = (a.api ?? []).slice(0, 10).join(", ");
    lines.push(`${a.name} | ${a.kind} | ${api || "(no public methods parsed)"}`);
    lines.push(`  file=${a.file}`);
  }
  lines.push("→ agent_read_type_digest typeName=...");
  return { text: lines.join("\n"), isError: false };
}

export function readTypeDigest(projectRoot, typeName, moduleId) {
  const modulesDir = path.join(indexRoot(projectRoot), "modules");
  const files = moduleId
    ? [path.join(modulesDir, `${moduleId}.json`)]
    : fs.existsSync(modulesDir)
      ? fs.readdirSync(modulesDir).map((f) => path.join(modulesDir, f))
      : [];

  for (const fp of files) {
    if (!fs.existsSync(fp)) continue;
    const mod = readJson(fp);
    const t = (mod?.types ?? []).find((x) => x.name === typeName);
    if (!t) continue;

    const members = t.publicMembers ?? [];
    const lines = [
      `type=${t.name} kind=${t.kind} ns=${t.namespace ?? "?"}`,
      `module=${mod.id} file=${t.file}`,
      `methods=${members.length}`,
      "--- public API ---",
    ];
    for (const m of members.slice(0, 40)) {
      lines.push(`  ${m}`);
    }
    if (members.length > 40) lines.push(`  ... +${members.length - 40} more — Read file`);
    else if (!members.length) lines.push("  (none parsed — may be private API or properties)");
    lines.push("→ Read .cs only if implementation detail needed");
    return { text: lines.join("\n"), isError: false };
  }

  return {
    text: `type not found: ${typeName}\n→ agent_find_in_module or agent_read_module_anchors`,
    isError: true,
  };
}
