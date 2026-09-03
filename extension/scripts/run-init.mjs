/**
 * Extension child: offline init from vendor free-bundle.
 * argv[2] = JSON { projectRoot, bundleRoot, hosts }
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raw = process.argv[2];
if (!raw) {
  console.log(JSON.stringify({ ok: false, error: "payload_required" }));
  process.exit(1);
}

const payload = JSON.parse(raw);
const initMod = path.resolve(
  payload.bundleRoot,
  "mcp",
  "agent-kit-client",
  "init-free.mjs"
);
const mod = await import(pathToFileURL(initMod).href);
const result = mod.initFreeBundleToProject(payload.projectRoot, {
  bundleRoot: payload.bundleRoot,
  hosts: payload.hosts || ["cursor"],
});
console.log(JSON.stringify(result));
