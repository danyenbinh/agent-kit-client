"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { resolvePaths } = require("./paths");
const { wireCursorTipMcp, installCoreSkill } = require("./mcpWire");

function runCmd(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...(opts.env || {}) },
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${command}_exit_${code}`));
    });
  });
}

function runNode(args, opts = {}) {
  return runCmd(process.execPath || "node", args, opts);
}

/**
 * Offline Init — free packs from extension vendor (no license web).
 */
async function initAgentKitToWorkspace({
  extensionPath,
  workspaceFolder,
  hosts,
}) {
  const vendor = path.join(extensionPath, "vendor");
  const manifest = path.join(vendor, "MANIFEST.json");
  if (!fs.existsSync(manifest)) {
    return {
      ok: false,
      error: "vendor_missing",
      hint: "Reinstall extension or run npm run sync-vendor in agent-kit-client/extension",
    };
  }

  const runner = path.join(extensionPath, "scripts", "run-init.mjs");
  const payload = {
    projectRoot: workspaceFolder,
    bundleRoot: vendor,
    hosts: hosts && hosts.length ? hosts : ["cursor"],
  };
  const { stdout } = await runNode([runner, JSON.stringify(payload)]);
  let result;
  try {
    result = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop());
  } catch (e) {
    return { ok: false, error: "init_parse_failed", stdout, detail: String(e) };
  }
  return result;
}

/** @deprecated Prefer initAgentKitToWorkspace — kept for Pro portal apply later */
async function applyCoreToWorkspace(opts) {
  return initAgentKitToWorkspace({
    extensionPath: opts.extensionPath,
    workspaceFolder: opts.workspaceFolder,
    hosts: ["cursor"],
  });
}

function readLocalStatus(workspaceFolder) {
  const licensePath = path.join(workspaceFolder, ".cursor", "agent-kit-license.json");
  const installedDir = path.join(workspaceFolder, ".cursor", "agent-kit", "installed");
  const mcpPath = path.join(workspaceFolder, ".cursor", "mcp.json");
  let license = null;
  let installed = {};
  let hasTipMcp = false;
  let hasUnityMcp = false;
  try {
    if (fs.existsSync(licensePath)) {
      license = JSON.parse(fs.readFileSync(licensePath, "utf8"));
    }
  } catch (_) {}
  try {
    if (fs.existsSync(installedDir)) {
      for (const f of fs.readdirSync(installedDir)) {
        if (!f.endsWith(".json") || f.includes(".bridge.")) continue;
        const meta = JSON.parse(fs.readFileSync(path.join(installedDir, f), "utf8"));
        const id = meta.packId || f.replace(/\.json$/, "");
        installed[id] = { version: meta.version || null, installedAt: meta.installedAt || null };
      }
    }
  } catch (_) {}
  try {
    if (fs.existsSync(mcpPath)) {
      const m = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
      hasTipMcp = Boolean(m?.mcpServers?.["agent-kit-client"]);
      hasUnityMcp = Boolean(m?.mcpServers?.["unity-agent"]);
    }
  } catch (_) {}
  return {
    licenseKey: license?.key ? `${String(license.key).slice(0, 8)}…` : null,
    licenseApi: license?.licenseApi || null,
    initSource: license?.initSource || null,
    coreVersion: installed.core?.version || null,
    pkeVersion: installed.pke?.version || null,
    unityRuntimeVersion: installed["unity-runtime"]?.version || null,
    installedPacks: Object.keys(installed),
    hasTipMcp,
    hasUnityMcp,
  };
}

module.exports = {
  initAgentKitToWorkspace,
  applyCoreToWorkspace,
  readLocalStatus,
  resolvePaths,
};
