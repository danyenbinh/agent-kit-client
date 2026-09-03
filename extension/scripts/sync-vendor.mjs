/**
 * Copy tip MCP + core skill into extension/vendor for VSIX packaging.
 * Free marketplace package: Core only — no Unity Runtime / PKE packs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(__dirname, "..");
const clientRoot = path.resolve(extRoot, "..");
const vendorRoot = path.join(extRoot, "vendor");

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst, { skipNodeModules = true } = {}) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (skipNodeModules && name === "node_modules") continue;
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d, { skipNodeModules });
    else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
}

rmrf(vendorRoot);
fs.mkdirSync(vendorRoot, { recursive: true });

const mcpSrc = path.join(clientRoot, "mcp", "agent-kit-client");
const mcpDst = path.join(vendorRoot, "mcp", "agent-kit-client");
copyDir(mcpSrc, mcpDst);

const skillSrc = path.join(clientRoot, "skills", "agent-kit-runtime");
const skillDst = path.join(vendorRoot, "skills", "agent-kit-runtime");
if (fs.existsSync(skillSrc)) copyDir(skillSrc, skillDst);

fs.writeFileSync(
  path.join(vendorRoot, "MANIFEST.json"),
  JSON.stringify(
    {
      kind: "agent-kit-core-extension-vendor",
      packsAllowed: ["core", "unity-runtime", "pke"],
      note: "Free extension vendor - Agent Kit for Unity Core+PKE+basic MCP. VFX/Builder/Shader via portal Pro/Studio.",
      syncedAt: new Date().toISOString(),
    },
    null,
    2
  )
);

console.log("synced vendor ->", vendorRoot);
console.log("next: cd vendor/mcp/agent-kit-client && npm install --omit=dev");
