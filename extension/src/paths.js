"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Resolve tip MCP + apply-packs module for Core free extension.
 * Prefer bundled vendor/ (VSIX); fall back to sibling agent-kit-client repo.
 */
function resolvePaths(extensionPath, workspaceFolder) {
  const vendorMcp = path.join(extensionPath, "vendor", "mcp", "agent-kit-client");
  const siblingMcp = path.join(extensionPath, "..", "mcp", "agent-kit-client");
  const workspaceMcp = workspaceFolder
    ? path.join(workspaceFolder, "agent-kit-client", "mcp", "agent-kit-client")
    : null;

  const candidates = [vendorMcp, siblingMcp, workspaceMcp].filter(Boolean);
  let tipMcp = null;
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "apply-packs.mjs"))) {
      tipMcp = c;
      break;
    }
  }

  const vendorSkill = path.join(extensionPath, "vendor", "skills", "agent-kit-runtime");
  const siblingSkill = path.join(extensionPath, "..", "skills", "agent-kit-runtime");
  const skillSrc = fs.existsSync(vendorSkill)
    ? vendorSkill
    : fs.existsSync(siblingSkill)
      ? siblingSkill
      : null;

  return {
    tipMcp,
    applyModule: tipMcp ? path.join(tipMcp, "apply-packs.mjs") : null,
    tipIndex: tipMcp ? path.join(tipMcp, "index.mjs") : null,
    skillSrc,
    vendorMcp,
    siblingMcp,
  };
}

function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

module.exports = {
  resolvePaths,
  readJsonSafe,
  writeJson,
};
