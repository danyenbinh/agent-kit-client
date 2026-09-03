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

async function ensureTipNpm(tipMcp) {
  const marker = path.join(tipMcp, "node_modules", "adm-zip");
  if (fs.existsSync(marker)) return { ok: true, skipped: true };
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  await runCmd(npmCmd, ["install", "--omit=dev"], { cwd: tipMcp });
  return { ok: true, skipped: false };
}

/**
 * Apply free Unity Core tier — core + basic MCP (unity-runtime) + PKE.
 * Never applies VFX / Builder / Shader Graph (Pro / Studio).
 */
const FREE_PACK_IDS = ["core", "unity-runtime", "pke"];

async function applyCoreToWorkspace({
  extensionPath,
  workspaceFolder,
  key,
  licenseApi,
  org,
}) {
  const paths = resolvePaths(extensionPath, workspaceFolder);
  if (!paths.applyModule || !paths.tipIndex) {
    return {
      ok: false,
      error: "tip_mcp_missing",
      hint: "Run npm run sync-vendor in agent-kit-client/extension, or keep agent-kit-client next to the project.",
      tried: {
        vendor: paths.vendorMcp,
        sibling: paths.siblingMcp,
      },
    };
  }

  await ensureTipNpm(paths.tipMcp);

  const skill = installCoreSkill(workspaceFolder, paths.skillSrc);
  const mcp = wireCursorTipMcp(workspaceFolder, paths.tipIndex);

  const runner = path.join(extensionPath, "scripts", "run-apply-core.mjs");
  const payload = {
    projectRoot: workspaceFolder,
    applyModule: paths.applyModule,
    key,
    licenseApi,
    org: org || null,
    packIds: FREE_PACK_IDS,
  };
  const { stdout } = await runNode([runner, JSON.stringify(payload)]);
  let result;
  try {
    result = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop());
  } catch (e) {
    return { ok: false, error: "apply_parse_failed", stdout, detail: String(e) };
  }

  return {
    ...result,
    skill,
    mcp,
    tipMcp: paths.tipMcp,
    packsApplied: FREE_PACK_IDS,
    note: "Free tier applies core + unity-runtime + pke. VFX/Builder/Shader require Pro/Studio portal upgrade.",
  };
}

function readLocalStatus(workspaceFolder) {
  const licensePath = path.join(workspaceFolder, ".cursor", "agent-kit-license.json");
  const installedDir = path.join(workspaceFolder, ".cursor", "agent-kit", "installed");
  const mcpPath = path.join(workspaceFolder, ".cursor", "mcp.json");
  let license = null;
  let installed = {};
  let hasTipMcp = false;
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
    }
  } catch (_) {}
  return {
    licenseKey: license?.key ? `${String(license.key).slice(0, 8)}…` : null,
    licenseApi: license?.licenseApi || null,
    coreVersion: installed.core?.version || null,
    coreInstalledAt: installed.core?.installedAt || null,
    pkeVersion: installed.pke?.version || null,
    unityRuntimeVersion: installed["unity-runtime"]?.version || null,
    installedPacks: Object.keys(installed),
    hasTipMcp,
  };
}

module.exports = {
  applyCoreToWorkspace,
  readLocalStatus,
  resolvePaths,
  FREE_PACK_IDS,
};
