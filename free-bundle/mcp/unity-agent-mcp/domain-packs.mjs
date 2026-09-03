/**
 * Domain pack registry — machine-readable SSOT for token-efficient routing.
 */
import fs from "node:fs";
import path from "node:path";

const IMPLICIT_PACK = "general";

export function resolveKitRoot(projectRoot) {
  const capPath = path.join(projectRoot, ".cursor", "agent-capabilities.json");
  if (fs.existsSync(capPath)) {
    try {
      const cap = JSON.parse(fs.readFileSync(capPath, "utf8"));
      const rel = cap._meta?.kitSubmodulePath || "cursor-agent-kit";
      return path.join(projectRoot, rel.replace(/\//g, path.sep));
    } catch {
      /* fall through */
    }
  }
  return path.join(projectRoot, "cursor-agent-kit");
}

export function registryPath(projectRoot) {
  return path.join(resolveKitRoot(projectRoot), "registry", "domain-packs.json");
}

export function activePacksPath(projectRoot) {
  return path.join(projectRoot, ".cursor", "active-domain-packs.json");
}

export function loadRegistry(projectRoot) {
  const p = registryPath(projectRoot);
  if (!fs.existsSync(p)) {
    throw new Error(`domain-packs registry missing: ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function detectPacks(projectRoot) {
  const detected = [];
  if (fs.existsSync(path.join(projectRoot, "Assets"))) detected.push("unity");
  if (fs.existsSync(path.join(projectRoot, "package.json"))) detected.push("web");
  if (
    fs.existsSync(path.join(projectRoot, "data")) ||
    fs.readdirSync(projectRoot).some((f) => f.endsWith(".csv"))
  ) {
    detected.push("market");
  }
  if (!detected.length) detected.push("general");
  return [...new Set(detected)];
}

export function readActivePacks(projectRoot) {
  const p = activePacksPath(projectRoot);
  if (!fs.existsSync(p)) {
    return { active: detectPacks(projectRoot), fromFile: false };
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const active = [...new Set([IMPLICIT_PACK, ...(data.active || [])])];
    return { active, fromFile: true, raw: data };
  } catch {
    return { active: [IMPLICIT_PACK, ...detectPacks(projectRoot)], fromFile: false };
  }
}

export function writeActivePacks(projectRoot, packIds) {
  const registry = loadRegistry(projectRoot);
  const valid = new Set(Object.keys(registry.packs || {}));
  const active = [...new Set(packIds.filter((id) => id !== IMPLICIT_PACK && valid.has(id)))];
  const data = {
    active,
    updatedAt: new Date().toISOString(),
    notes: "general is always implicit",
  };
  fs.mkdirSync(path.dirname(activePacksPath(projectRoot)), { recursive: true });
  fs.writeFileSync(activePacksPath(projectRoot), JSON.stringify(data, null, 2) + "\n", "utf8");
  return readActivePacks(projectRoot);
}

function mergePackLists(packs, ids, key) {
  const set = new Set();
  for (const id of ids) {
    const pack = packs[id];
    if (!pack) continue;
    for (const item of pack[key] || []) set.add(item);
  }
  return [...set];
}

export function buildPackDigest(projectRoot, options = {}) {
  const registry = loadRegistry(projectRoot);
  const { active, fromFile } = readActivePacks(projectRoot);
  const packId = options.packId;

  const targetIds = packId ? [packId] : active;
  const packs = registry.packs || {};

  for (const id of targetIds) {
    if (!packs[id]) {
      return {
        ok: false,
        text: `unknown pack: ${id}\nknown: ${Object.keys(packs).join(", ")}`,
        isError: true,
      };
    }
  }

  const mergedSkills = mergePackLists(packs, targetIds, "skills");
  const mergedGroups = mergePackLists(packs, targetIds, "mcpToolGroups");
  const mergedRules = mergePackLists(packs, targetIds, "rules");

  const lines = [
    `domainPacks active=${active.join("+")} fromFile=${fromFile}`,
    packId ? `pack=${packId}` : `merged=${targetIds.join("+")}`,
    `skills (${mergedSkills.length}): ${mergedSkills.join(", ")}`,
    `mcpGroups: ${mergedGroups.join(", ")}`,
    `rules: ${mergedRules.join(", ") || "(none extra)"}`,
    "--- digest per pack ---",
  ];

  for (const id of targetIds) {
    const p = packs[id];
    lines.push(`[${id}] ${p.label}: ${p.digest}`);
  }

  if (!fromFile && !packId) {
    lines.push("hint: set .cursor/active-domain-packs.json or agent_set_active_domain_packs");
  }

  return {
    ok: true,
    text: lines.join("\n"),
    active,
    packIds: targetIds,
    skills: mergedSkills,
    mcpToolGroups: mergedGroups,
    rules: mergedRules,
    isError: false,
  };
}

export function scaffoldActivePacks(projectRoot, defaults) {
  const p = activePacksPath(projectRoot);
  if (fs.existsSync(p)) return readActivePacks(projectRoot);
  const detected = defaults?.length ? defaults : detectPacks(projectRoot);
  const filtered = detected.filter((id) => id !== IMPLICIT_PACK);
  writeActivePacks(projectRoot, filtered);
  return readActivePacks(projectRoot);
}
