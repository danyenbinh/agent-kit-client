/**
 * Download entitled packs from license API and apply into the project workspace.
 * Used by tip MCP agent_kit_apply_packs (Cursor Apply — no manual unzip).
 */
import fs from "node:fs";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import AdmZip from "adm-zip";

const NEVER_SHIP = new Set([
  "agent-kit-promotion",
  "agent-core-governance",
  "agent-north-star",
  "agent-skill-registry",
  "agent-skill-lifecycle",
  "agent-project-orchestrator",
]);

const TIP_TOOLS = [
  "agent_kit_client_status",
  "agent_kit_entitlements",
  "agent_kit_allowed_tools",
  "agent_kit_apply_packs",
  "agent_kit_save_license",
  "agent_kit_pack_status",
];

function readJson(p) {
  const raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return readJson(p);
  } catch {
    return null;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst) {
  ensureDir(dst);
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else {
      ensureDir(path.dirname(d));
      fs.copyFileSync(s, d);
    }
  }
}

async function downloadToFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`download_failed ${res.status} ${t.slice(0, 200)}`);
  }
  ensureDir(path.dirname(dest));
  const body = Readable.fromWeb(res.body);
  await pipeline(body, createWriteStream(dest));
}

function listInstalledMarkers(installedDir) {
  if (!fs.existsSync(installedDir)) return [];
  return fs
    .readdirSync(installedDir)
    .filter((f) => f.endsWith(".json") && !f.includes(".bridge."))
    .map((f) => {
      const meta = readJsonSafe(path.join(installedDir, f));
      return {
        packId: meta?.packId || f.replace(/\.json$/, ""),
        version: meta?.version ?? null,
        installedAt: meta?.installedAt || null,
      };
    });
}

function rebuildAllowlistFromExtract({
  projectRoot,
  extractRoot,
  installedPackIds,
  prevAllow,
}) {
  const mergedTools = new Set([
    ...(prevAllow?.tools || []),
    ...TIP_TOOLS,
  ]);
  const mergedGroups = new Set(prevAllow?.toolGroups || []);

  for (const packId of installedPackIds) {
    const fragPath = path.join(extractRoot, packId, "meta", "mcp-fragment.json");
    if (!fs.existsSync(fragPath)) continue;
    const frag = readJson(fragPath);
    for (const g of frag.toolGroups || []) if (g) mergedGroups.add(g);
    for (const t of frag.tools || []) if (t) mergedTools.add(t);
  }

  const tools = [...mergedTools];
  const enforcement =
    process.env.AGENT_KIT_ALLOWLIST_ADVISORY === "1"
      ? "advisory"
      : tools.length >= 10
        ? "strict"
        : "advisory";

  return {
    version: 1,
    phase: 3,
    skuHint:
      installedPackIds.includes("shadergraph") || installedPackIds.includes("builder")
        ? "unity-studio"
        : installedPackIds.includes("pke")
          ? "unity-pro"
          : "custom",
    packs: installedPackIds,
    toolGroups: [...mergedGroups],
    tools,
    updatedAt: new Date().toISOString(),
    enforcement,
    note: "written by agent_kit_apply_packs",
    projectRoot,
  };
}

async function postInstallReport(api, key, markers, projectRoot) {
  const packs = {};
  for (const m of markers) {
    packs[m.packId] = {
      version: m.version,
      installedAt: m.installedAt || new Date().toISOString(),
    };
  }
  try {
    const res = await fetch(`${api}/v1/install-report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key,
        source: "agent_kit_apply_packs",
        projectHint: path.basename(projectRoot),
        packs,
      }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Compare local installed markers vs license API packDetails.
 */
export async function packStatusForProject(projectRoot) {
  const licensePath = path.join(projectRoot, ".cursor", "agent-kit-license.json");
  const license = readJsonSafe(licensePath);
  if (!license?.key) {
    return { ok: false, error: "no_license", path: licensePath };
  }
  const api = String(license.licenseApi || "http://localhost:8787").replace(/\/$/, "");
  const installedDir = path.join(projectRoot, ".cursor", "agent-kit", "installed");
  const local = listInstalledMarkers(installedDir);
  const localMap = Object.fromEntries(local.map((m) => [m.packId, m]));

  const entRes = await fetch(`${api}/v1/entitlements?key=${encodeURIComponent(license.key)}`);
  const ent = await entRes.json();
  if (!entRes.ok) {
    return { ok: false, error: "entitlements_failed", status: entRes.status, body: ent };
  }

  // Prefer live local markers for status; also push report so portal stays in sync
  await postInstallReport(api, license.key, local, projectRoot);

  const remoteDetails = Array.isArray(ent.packDetails) ? ent.packDetails : [];
  const byId = Object.fromEntries(remoteDetails.map((p) => [p.id, p]));
  const packs = (ent.packs || []).map((id) => {
    const remote = byId[id] || { id, latestVersion: null };
    const loc = localMap[id];
    const latestVersion = remote.latestVersion || null;
    const installedVersion = loc?.version ?? remote.installedVersion ?? null;
    let status = "not_reported";
    let updateAvailable = false;
    if (installedVersion && latestVersion) {
      if (installedVersion === latestVersion) status = "up_to_date";
      else {
        status = "update_available";
        updateAvailable = installedVersion !== latestVersion;
      }
    } else if (!installedVersion) status = "not_reported";
    else status = "unknown";
    return {
      id,
      label: remote.label || id,
      latestVersion,
      installedVersion,
      installedAt: loc?.installedAt || remote.installedAt || null,
      status,
      updateAvailable,
    };
  });

  return {
    ok: true,
    api,
    packs,
    updates: packs.filter((p) => p.updateAvailable).map((p) => p.id),
    next: packs.some((p) => p.updateAvailable)
      ? `agent_kit_apply_packs with packIds=${JSON.stringify(packs.filter((p) => p.updateAvailable).map((p) => p.id))}`
      : "All reported packs match cloud latest (or no local install yet)",
  };
}

/**
 * @param {string} projectRoot
 * @param {{ packIds?: string[] }} [opts]
 */
export async function applyPacksToProject(projectRoot, opts = {}) {
  const licensePath = path.join(projectRoot, ".cursor", "agent-kit-license.json");
  if (!fs.existsSync(licensePath)) {
    return {
      ok: false,
      error: "no_license",
      hint: "Save license key from /app into .cursor/agent-kit-license.json (or use agent_kit_save_license)",
      path: licensePath,
    };
  }
  const license = readJson(licensePath);
  if (!license.key) return { ok: false, error: "license_missing_key" };
  const api = String(license.licenseApi || "http://localhost:8787").replace(/\/$/, "");

  const entRes = await fetch(`${api}/v1/entitlements?key=${encodeURIComponent(license.key)}`);
  const ent = await entRes.json();
  if (!entRes.ok) {
    return { ok: false, error: "entitlements_failed", status: entRes.status, body: ent };
  }

  let packs = Array.isArray(ent.packs) ? [...ent.packs] : [];
  if (opts.packIds?.length) {
    packs = packs.filter((p) => opts.packIds.includes(p));
  }
  if (!packs.length) return { ok: false, error: "no_packs" };

  const cacheRoot = path.join(projectRoot, ".cursor", "agent-kit", "cache", "packs");
  const extractRoot = path.join(projectRoot, ".cursor", "agent-kit", "cache", "extract");
  const skillsRoot = path.join(projectRoot, ".cursor", "skills");
  const installedDir = path.join(projectRoot, ".cursor", "agent-kit", "installed");
  const allowPath = path.join(projectRoot, ".cursor", "agent-kit", "mcp-allowlist.json");
  ensureDir(cacheRoot);
  ensureDir(extractRoot);
  ensureDir(skillsRoot);
  ensureDir(installedDir);

  const prevAllow = readJsonSafe(allowPath);
  const installed = [];
  const errors = [];

  for (const packId of packs) {
    try {
      const zipPath = path.join(cacheRoot, `${packId}.zip`);
      const url = `${api}/v1/packs/${encodeURIComponent(packId)}/download?key=${encodeURIComponent(license.key)}`;
      await downloadToFile(url, zipPath);

      const outDir = path.join(extractRoot, packId);
      rmrf(outDir);
      ensureDir(outDir);
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(outDir, true);

      const skillsDir = path.join(outDir, "skills");
      if (fs.existsSync(skillsDir)) {
        for (const name of fs.readdirSync(skillsDir)) {
          if (NEVER_SHIP.has(name)) continue;
          const src = path.join(skillsDir, name);
          if (!fs.statSync(src).isDirectory()) continue;
          const dst = path.join(skillsRoot, name);
          rmrf(dst);
          copyDir(src, dst);
        }
      }

      // Unity MCP from unity-runtime pack
      const mcpSrc = path.join(outDir, "mcp", "unity-agent-mcp");
      if (packId === "unity-runtime" && fs.existsSync(mcpSrc)) {
        const mcpDst = path.join(projectRoot, ".cursor", "agent-kit", "mcp", "unity-agent-mcp");
        rmrf(mcpDst);
        copyDir(mcpSrc, mcpDst);
      }

      const manifestPath = path.join(outDir, "meta", "pack.json");
      const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : { id: packId };
      fs.writeFileSync(
        path.join(installedDir, `${packId}.json`),
        JSON.stringify(
          {
            packId,
            platform: manifest.platform || null,
            hosts: manifest.hosts || ["*"],
            installedAt: new Date().toISOString(),
            version: manifest.version || null,
            source: "apply-packs",
          },
          null,
          2
        )
      );
      installed.push(packId);
    } catch (e) {
      errors.push({ packId, error: String(e?.message || e) });
    }
  }

  const markers = listInstalledMarkers(installedDir);
  const allInstalledIds = markers.map((m) => m.packId);
  const allowlist = rebuildAllowlistFromExtract({
    projectRoot,
    extractRoot,
    installedPackIds: allInstalledIds,
    prevAllow,
  });
  fs.writeFileSync(allowPath, JSON.stringify(allowlist, null, 2));

  license.installedPacks = allInstalledIds;
  license.org = ent.org || license.org;
  license.plan = ent.plan || license.plan;
  license.seats = ent.seats || license.seats;
  license.expiresAt = ent.expiresAt ?? license.expiresAt;
  license.platforms = ent.platforms || license.platforms;
  license.appliedAt = new Date().toISOString();
  fs.writeFileSync(licensePath, JSON.stringify(license, null, 2));

  const report = await postInstallReport(api, license.key, markers, projectRoot);

  return {
    ok: errors.length === 0,
    api,
    installed,
    allInstalled: allInstalledIds,
    errors,
    allowlistTools: allowlist.tools.length,
    enforcement: allowlist.enforcement,
    installReport: report,
    next:
      installed.includes("unity-runtime") || allInstalledIds.includes("unity-runtime")
        ? "npm install in .cursor/agent-kit/mcp/unity-agent-mcp ; merge MCP from mcp.entitled.hint if needed ; Reload MCP"
        : "Reload MCP / skills in Cursor ; refresh /app to see Installed versions",
  };
}

export function saveLicenseFile(projectRoot, { key, licenseApi, org }) {
  const dir = path.join(projectRoot, ".cursor");
  ensureDir(dir);
  const p = path.join(dir, "agent-kit-license.json");
  const prev = fs.existsSync(p) ? readJson(p) : {};
  const next = {
    ...prev,
    key,
    licenseApi: (licenseApi || prev.licenseApi || "http://localhost:8787").replace(/\/$/, ""),
    org: org || prev.org || null,
    installedPacks: prev.installedPacks || [],
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(p, JSON.stringify(next, null, 2));
  return { ok: true, path: p, keyPreview: `${String(key).slice(0, 8)}…` };
}
