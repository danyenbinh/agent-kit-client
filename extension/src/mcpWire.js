"use strict";

const fs = require("fs");
const path = require("path");
const { readJsonSafe, writeJson } = require("./paths");

/**
 * Merge agent-kit-client tip into workspace .cursor/mcp.json without wiping other servers.
 * Uses absolute path to tip index so it works when agent-kit-client is not in the workspace.
 */
function wireCursorTipMcp(workspaceFolder, tipIndexAbs) {
  const cursorDir = path.join(workspaceFolder, ".cursor");
  const mcpPath = path.join(cursorDir, "mcp.json");
  fs.mkdirSync(cursorDir, { recursive: true });

  const existing = readJsonSafe(mcpPath) || { mcpServers: {} };
  if (!existing.mcpServers || typeof existing.mcpServers !== "object") {
    existing.mcpServers = {};
  }

  // Prefer forward slashes in args for Node on Windows
  const tipArg = tipIndexAbs.replace(/\\/g, "/");

  existing.mcpServers["agent-kit-client"] = {
    command: "node",
    args: [tipArg],
    env: {
      AGENT_PROJECT_ROOT: "${workspaceFolder}",
    },
  };

  writeJson(mcpPath, existing);
  return { path: mcpPath, tipArg };
}

/**
 * Copy free Core skill only (agent-kit-runtime). Never copies Unity skills.
 */
function installCoreSkill(workspaceFolder, skillSrc) {
  if (!skillSrc || !fs.existsSync(skillSrc)) {
    return { ok: false, error: "core_skill_missing", skillSrc };
  }
  const dst = path.join(workspaceFolder, ".cursor", "skills", "agent-kit-runtime");
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.rmSync(dst, { recursive: true, force: true });
  copyDir(skillSrc, dst);
  return { ok: true, path: dst };
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
}

module.exports = {
  wireCursorTipMcp,
  installCoreSkill,
};
