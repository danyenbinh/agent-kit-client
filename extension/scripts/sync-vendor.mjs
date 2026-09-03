/**
 * Copy free-bundle into extension/vendor for VSIX (offline init, no portal).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(__dirname, "..");
const clientRoot = path.resolve(extRoot, "..");
const vendorRoot = path.join(extRoot, "vendor");
const freeBundle = path.join(clientRoot, "free-bundle");

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

const sync = spawnSync(process.execPath, [path.join(clientRoot, "scripts", "sync-free-bundle.mjs")], {
  cwd: clientRoot,
  encoding: "utf8",
  windowsHide: true,
});
if (sync.status !== 0) {
  console.error(sync.stdout || "");
  console.error(sync.stderr || "");
  process.exit(sync.status || 1);
}
console.log(sync.stdout || "");

if (!fs.existsSync(path.join(freeBundle, "MANIFEST.json"))) {
  console.error("free-bundle missing after sync");
  process.exit(1);
}

rmrf(vendorRoot);
copyDir(freeBundle, vendorRoot);

fs.writeFileSync(
  path.join(vendorRoot, "MANIFEST.json"),
  JSON.stringify(
    {
      ...JSON.parse(fs.readFileSync(path.join(freeBundle, "MANIFEST.json"), "utf8")),
      kind: "agent-kit-for-unity-extension-vendor",
      packsAllowed: ["core", "unity-runtime", "pke"],
      note: "Offline free init in VSIX. Pro VFX/Builder/Shader via portal.",
      syncedAt: new Date().toISOString(),
    },
    null,
    2
  )
);

console.log("extension vendor <- free-bundle ->", vendorRoot);
