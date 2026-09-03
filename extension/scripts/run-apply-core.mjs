/**
 * Child process — Apply free Unity Core tier packs via tip apply-packs.mjs
 * Free: core + unity-runtime + pke. Never vfx/builder/shadergraph.
 * argv[2] = JSON payload
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

const FREE_PACK_IDS = ["core", "unity-runtime", "pke"];

const raw = process.argv[2];
if (!raw) {
  console.log(JSON.stringify({ ok: false, error: "payload_required" }));
  process.exit(1);
}

const payload = JSON.parse(raw);
const modPath = path.resolve(payload.applyModule);
const mod = await import(pathToFileURL(modPath).href);

const save = mod.saveLicenseFile(payload.projectRoot, {
  key: payload.key,
  licenseApi: payload.licenseApi,
  org: payload.org,
});

const requested = Array.isArray(payload.packIds) && payload.packIds.length
  ? payload.packIds.filter((id) => FREE_PACK_IDS.includes(id))
  : FREE_PACK_IDS;

const apply = await mod.applyPacksToProject(payload.projectRoot, {
  packIds: requested.length ? requested : FREE_PACK_IDS,
});

console.log(
  JSON.stringify({
    ok: Boolean(apply?.ok),
    save,
    apply,
    freePackIds: FREE_PACK_IDS,
  })
);
