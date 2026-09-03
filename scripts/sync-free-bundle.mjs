/**
 * Build agent-kit-client/free-bundle from cloud dist (core + unity-runtime + pke).
 * MCP modules are per-pack: free merges unity-runtime host + pke addon only.
 * Never ships VFX / Builder / Shader / Figma catalog modules.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, "..");
const cloudRoot = path.resolve(clientRoot, "..", "agent-kit-cloud");
const distRoot = process.env.AGENT_KIT_DIST_ROOT || path.join(cloudRoot, "dist");
const outRoot = path.join(clientRoot, "free-bundle");

const FREE_PACKS = ["core", "unity-runtime", "pke"];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst, { skipNodeModules = true, skipTests = false } = {}) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (skipNodeModules && name === "node_modules") continue;
    if (skipTests && /^test-.*\.mjs$/i.test(name)) continue;
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d, { skipNodeModules, skipTests });
    else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
  return true;
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function mergeMcpPack(packId, mcpOut, neverInFree) {
  const src = path.join(distRoot, packId, "mcp", "unity-agent-mcp");
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(src)) {
    if (neverInFree.has(name)) continue;
    if (name === "node_modules") continue;
    if (/^test-.*\.mjs$/i.test(name)) continue;
    const s = path.join(src, name);
    if (!fs.statSync(s).isFile()) continue;
    copyFile(s, path.join(mcpOut, name));
    n++;
  }
  return n;
}

if (!fs.existsSync(path.join(distRoot, "core"))) {
  console.error("Missing dist packs at", distRoot);
  console.error("Build packs in agent-kit-cloud first (factory/build-all-packs.ps1).");
  process.exit(1);
}

const modulesPath = path.join(cloudRoot, "registry", "mcp-modules.json");
const neverInFree = new Set(
  fs.existsSync(modulesPath) ? readJson(modulesPath).neverInFree || [] : []
);

rmrf(outRoot);
fs.mkdirSync(outRoot, { recursive: true });

const skillsOut = path.join(outRoot, "skills");
const metaOut = path.join(outRoot, "meta");
const mcpOut = path.join(outRoot, "mcp", "unity-agent-mcp");
fs.mkdirSync(skillsOut, { recursive: true });
fs.mkdirSync(metaOut, { recursive: true });
fs.mkdirSync(mcpOut, { recursive: true });

for (const packId of FREE_PACKS) {
  const packDir = path.join(distRoot, packId);
  const skillsDir = path.join(packDir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const name of fs.readdirSync(skillsDir)) {
      const src = path.join(skillsDir, name);
      if (!fs.statSync(src).isDirectory()) continue;
      copyDir(src, path.join(skillsOut, name));
    }
  }
  const frag = path.join(packDir, "meta", "mcp-fragment.json");
  if (fs.existsSync(frag)) {
    fs.copyFileSync(frag, path.join(metaOut, `${packId}.mcp-fragment.json`));
  }
  const packJson = path.join(packDir, "meta", "pack.json");
  if (fs.existsSync(packJson)) {
    fs.copyFileSync(packJson, path.join(metaOut, `${packId}.pack.json`));
  }
}

// Tip MCP (client-owned)
copyDir(
  path.join(clientRoot, "mcp", "agent-kit-client"),
  path.join(outRoot, "mcp", "agent-kit-client")
);

// Merge per-pack Unity MCP (host + pke only)
const mergedCounts = {};
for (const packId of ["unity-runtime", "pke"]) {
  mergedCounts[packId] = mergeMcpPack(packId, mcpOut, neverInFree);
}

// Final strip (belt) — never leave Pro catalogs in free-bundle
for (const name of neverInFree) {
  const p = path.join(mcpOut, name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

if (!fs.existsSync(path.join(mcpOut, "index.mjs"))) {
  console.error("free-bundle missing unity-agent-mcp/index.mjs — rebuild unity-runtime pack");
  process.exit(1);
}
if (!fs.existsSync(path.join(mcpOut, "codebase-index.mjs"))) {
  console.error("free-bundle missing PKE modules — rebuild pke pack with mcp-modules.json");
  process.exit(1);
}

const tipSkill = path.join(clientRoot, "skills", "agent-kit-runtime");
if (fs.existsSync(tipSkill)) {
  copyDir(tipSkill, path.join(skillsOut, "agent-kit-runtime"));
}

fs.writeFileSync(
  path.join(outRoot, "MANIFEST.json"),
  JSON.stringify(
    {
      kind: "agent-kit-free-bundle",
      packs: FREE_PACKS,
      hosts: ["cursor", "claude-code"],
      mcpPolicy: "per-pack-modules",
      mcpMergedFrom: mergedCounts,
      neverInFree: [...neverInFree],
      note: "Offline free: tip + unity-runtime host MCP + pke modules. No VFX/Builder/Shader/Figma MCP.",
      sourceDist: distRoot,
      syncedAt: new Date().toISOString(),
    },
    null,
    2
  )
);

console.log("free-bundle ->", outRoot);
console.log("packs:", FREE_PACKS.join(", "));
console.log("mcp merged:", JSON.stringify(mergedCounts));
console.log("stripped neverInFree:", neverInFree.size);
