/**
 * Offline init of free Agent Kit into a project (no license web / portal).
 * Bundles: core + unity-runtime (unity-agent MCP) + pke + ISR meta tools allowlist.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TIP_TOOLS = [
  "agent_kit_client_status",
  "agent_kit_entitlements",
  "agent_kit_allowed_tools",
  "agent_kit_apply_packs",
  "agent_kit_save_license",
  "agent_kit_pack_status",
  "agent_kit_init",
];

const ISR_META_TOOLS = [
  "agent_record_turn",
  "agent_get_usage",
  "agent_get_capabilities",
  "agent_validate_registry",
  "agent_set_tool_profile",
  "agent_get_tool_profile",
];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
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
    if (name === "node_modules") continue;
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else {
      ensureDir(path.dirname(d));
      fs.copyFileSync(s, d);
    }
  }
}

function npmInstall(dir) {
  if (!fs.existsSync(path.join(dir, "package.json"))) return { skipped: true };
  if (fs.existsSync(path.join(dir, "node_modules"))) return { skipped: true };
  const isWin = process.platform === "win32";
  const npmCmd = isWin ? "npm.cmd" : "npm";
  const r = spawnSync(npmCmd, ["install", "--omit=dev", "--no-fund", "--no-audit"], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    shell: isWin,
    env: process.env,
  });
  if (r.error) {
    return { ok: false, error: String(r.error.message || r.error) };
  }
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || "").trim().slice(0, 800);
    return { ok: false, error: detail || `npm_exit_${r.status}` };
  }
  return { ok: true };
}

/**
 * Resolve free-bundle directory.
 * @param {{ bundleRoot?: string, extensionPath?: string, clientRoot?: string }} opts
 */
export function resolveFreeBundle(opts = {}) {
  const candidates = [];
  if (opts.bundleRoot) candidates.push(opts.bundleRoot);
  if (opts.extensionPath) {
    candidates.push(path.join(opts.extensionPath, "vendor"));
  }
  if (opts.clientRoot) {
    candidates.push(path.join(opts.clientRoot, "free-bundle"));
  }
  // tip MCP next to this file → ../../free-bundle or ../free-bundle via client
  candidates.push(path.resolve(__dirname, "..", "..", "free-bundle"));
  candidates.push(path.resolve(__dirname, "..", "free-bundle"));
  // extension vendor when tip is under extension/vendor/mcp/agent-kit-client
  candidates.push(path.resolve(__dirname, "..", "..", ".."));

  for (const c of candidates) {
    if (!c) continue;
    const manifest = path.join(c, "MANIFEST.json");
    const unity = path.join(c, "mcp", "unity-agent-mcp", "index.mjs");
    if (fs.existsSync(manifest) && fs.existsSync(unity)) return c;
  }
  return null;
}

function mergeMcpServers(mcpPath, servers) {
  const existing = readJsonSafe(mcpPath) || { mcpServers: {} };
  if (!existing.mcpServers || typeof existing.mcpServers !== "object") {
    existing.mcpServers = {};
  }
  Object.assign(existing.mcpServers, servers);
  ensureDir(path.dirname(mcpPath));
  fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + "\n");
  return mcpPath;
}

function buildAllowlist(bundleRoot) {
  const tools = new Set([...TIP_TOOLS, ...ISR_META_TOOLS]);
  const groups = new Set();
  const metaDir = path.join(bundleRoot, "meta");
  if (fs.existsSync(metaDir)) {
    for (const f of fs.readdirSync(metaDir)) {
      if (!f.endsWith(".mcp-fragment.json")) continue;
      const frag = readJson(path.join(metaDir, f));
      for (const t of frag.tools || []) if (t) tools.add(t);
      for (const g of frag.toolGroups || []) if (g) groups.add(g);
    }
  }
  return {
    version: 1,
    phase: "free-offline",
    skuHint: "core-free",
    packs: ["core", "unity-runtime", "pke"],
    toolGroups: [...groups],
    tools: [...tools],
    updatedAt: new Date().toISOString(),
    enforcement: "strict",
    note: "written by agent_kit_init (offline free bundle). Pro MCP modules (vfx/builder/shader/figma) not shipped — apply those packs separately.",
  };
}

/**
 * @param {string} projectRoot
 * @param {{ bundleRoot?: string, hosts?: string[], extensionPath?: string, clientRoot?: string }} [opts]
 */
export function initFreeBundleToProject(projectRoot, opts = {}) {
  const offlineSnap = path.join(projectRoot, ".cursor", "agent-kit", "offline-bundle");
  let bundleRoot = resolveFreeBundle({
    ...opts,
    bundleRoot: opts.bundleRoot,
  });
  if (!bundleRoot && fs.existsSync(path.join(offlineSnap, "MANIFEST.json"))) {
    bundleRoot = offlineSnap;
  }
  if (!bundleRoot) {
    return {
      ok: false,
      error: "free_bundle_missing",
      hint: "Install Agent Kit for Unity extension, or run: node agent-kit-client/scripts/sync-free-bundle.mjs && pwsh -File agent-kit-client/scripts/init-agent-kit.ps1",
    };
  }

  const hosts = opts.hosts?.length ? opts.hosts : ["cursor"];
  const cursorDir = path.join(projectRoot, ".cursor");
  const skillsRoot = path.join(cursorDir, "skills");
  const agentKitDir = path.join(cursorDir, "agent-kit");
  const installedDir = path.join(agentKitDir, "installed");
  const mcpInstallDir = path.join(agentKitDir, "mcp");

  ensureDir(skillsRoot);
  ensureDir(installedDir);
  ensureDir(mcpInstallDir);

  // Keep a project-local snapshot so agent_kit_init works after tip MCP moves into .cursor
  if (path.resolve(bundleRoot) !== path.resolve(offlineSnap)) {
    rmrf(offlineSnap);
    copyDir(bundleRoot, offlineSnap);
  }

  // Skills
  const skillsSrc = path.join(bundleRoot, "skills");
  const skillsInstalled = [];
  if (fs.existsSync(skillsSrc)) {
    for (const name of fs.readdirSync(skillsSrc)) {
      const src = path.join(skillsSrc, name);
      if (!fs.statSync(src).isDirectory()) continue;
      const dst = path.join(skillsRoot, name);
      rmrf(dst);
      copyDir(src, dst);
      skillsInstalled.push(name);
    }
  }

  // Tip MCP into project cache (stable path for mcp.json)
  const tipSrc = path.join(bundleRoot, "mcp", "agent-kit-client");
  const tipDst = path.join(mcpInstallDir, "agent-kit-client");
  rmrf(tipDst);
  copyDir(tipSrc, tipDst);
  const tipNpm = npmInstall(tipDst);

  // Unity MCP
  const unitySrc = path.join(bundleRoot, "mcp", "unity-agent-mcp");
  const unityDst = path.join(mcpInstallDir, "unity-agent-mcp");
  rmrf(unityDst);
  copyDir(unitySrc, unityDst);
  const unityNpm = npmInstall(unityDst);

  const tipEntry = path.join(tipDst, "index.mjs").replace(/\\/g, "/");
  const unityEntry = path.join(unityDst, "index.mjs").replace(/\\/g, "/");

  const serverBlock = {
    "agent-kit-client": {
      command: "node",
      args: [tipEntry],
      env: { AGENT_PROJECT_ROOT: "${workspaceFolder}" },
    },
    "unity-agent": {
      command: "node",
      args: [unityEntry],
      env: { AGENT_PROJECT_ROOT: "${workspaceFolder}" },
    },
  };

  const mcpPaths = [];
  if (hosts.includes("cursor")) {
    mcpPaths.push(mergeMcpServers(path.join(cursorDir, "mcp.json"), serverBlock));
  }
  if (hosts.includes("claude-code")) {
    mcpPaths.push(mergeMcpServers(path.join(projectRoot, ".mcp.json"), serverBlock));
  }

  const allowlist = buildAllowlist(bundleRoot);
  fs.writeFileSync(
    path.join(agentKitDir, "mcp-allowlist.json"),
    JSON.stringify(allowlist, null, 2) + "\n"
  );

  const now = new Date().toISOString();
  for (const packId of ["core", "unity-runtime", "pke"]) {
    const metaPath = path.join(bundleRoot, "meta", `${packId}.pack.json`);
    const meta = fs.existsSync(metaPath) ? readJson(metaPath) : { id: packId };
    fs.writeFileSync(
      path.join(installedDir, `${packId}.json`),
      JSON.stringify(
        {
          packId,
          version: meta.version || null,
          installedAt: now,
          source: "agent_kit_init-offline",
        },
        null,
        2
      ) + "\n"
    );
  }

  const licensePath = path.join(cursorDir, "agent-kit-license.json");
  const prev = readJsonSafe(licensePath) || {};
  fs.writeFileSync(
    licensePath,
    JSON.stringify(
      {
        ...prev,
        plan: prev.plan || "free",
        platforms: ["universal", "unity"],
        installedPacks: ["core", "unity-runtime", "pke"],
        initSource: "offline-free-bundle",
        appliedAt: now,
        updatedAt: now,
        note: prev.note || "Free offline init. Optional: set key+licenseApi later for Pro packs.",
      },
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    path.join(agentKitDir, "bootstrap-status.json"),
    JSON.stringify(
      {
        bootstrappedAt: now,
        mode: "free-offline",
        hosts,
        packs: ["core", "unity-runtime", "pke"],
        next: "Reload MCP in Cursor / Claude Code",
      },
      null,
      2
    ) + "\n"
  );

  return {
    ok: tipNpm.ok !== false && unityNpm.ok !== false,
    mode: "free-offline",
    projectRoot,
    bundleRoot,
    hosts,
    skillsInstalled,
    mcpPaths,
    tipNpm,
    unityNpm,
    allowlistTools: allowlist.tools.length,
    packs: ["core", "unity-runtime", "pke"],
    next: "Reload MCP, then try agent_kit_client_status / unity_ping / agent_get_index_health / agent_record_turn",
  };
}
