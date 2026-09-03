/**
 * Tool profiles — advisory (default) or strict enforcement (Phase 9.4).
 */
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_PROFILES = {
  scene: {
    toolGroups: ["meta-capabilities", "scene-snapshot", "scene-validate", "scene-setup", "editor-bridge", "project-knowledge"],
    preferCursorTools: [],
    hint: "Scene/UI — ưu tiên snapshot, validate, bridge batch",
  },
  code: {
    toolGroups: ["meta-capabilities", "codebase-index", "project-knowledge"],
    preferCursorTools: ["Grep", "Read"],
    hint: "Gameplay — index + agent_find_in_module trước Read full file",
  },
  full: {
    toolGroups: ["*"],
    preferCursorTools: [],
    hint: "Debug — full MCP + Cursor tools",
  },
};

/** Always allowed in strict mode (meta + profile control). */
export const META_ALLOWLIST = new Set([
  "agent_get_usage",
  "agent_record_turn",
  "agent_validate_registry",
  "agent_get_capabilities",
  "agent_set_tool_profile",
  "agent_get_tool_profile",
  "agent_read_task_handoff",
  "agent_update_task_handoff",
  "agent_validate_pke_freshness",
  "agent_export_pke_metrics",
]);

export function toolProfilePath(projectRoot) {
  return path.join(projectRoot, ".cursor", "agent-tool-profile.json");
}

export function readToolProfileFile(projectRoot) {
  const p = toolProfilePath(projectRoot);
  if (!fs.existsSync(p)) {
    return { active: "code", enforcement: "advisory", profiles: { ...DEFAULT_PROFILES } };
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    data.profiles = { ...DEFAULT_PROFILES, ...(data.profiles ?? {}) };
    if (!data.active || !data.profiles[data.active]) data.active = "code";
    if (!data.enforcement) data.enforcement = "advisory";
    return data;
  } catch {
    return { active: "code", enforcement: "advisory", profiles: { ...DEFAULT_PROFILES } };
  }
}

export function writeToolProfileFile(projectRoot, profileName, options = {}) {
  const data = readToolProfileFile(projectRoot);
  if (!data.profiles[profileName]) {
    throw new Error(`Unknown profile: ${profileName}. Use scene | code | full`);
  }
  data.active = profileName;
  if (options.enforcement === "strict" || options.enforcement === "advisory") {
    data.enforcement = options.enforcement;
  }
  if (options.strict === true) data.enforcement = "strict";
  if (options.strict === false) data.enforcement = "advisory";
  data.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(toolProfilePath(projectRoot)), { recursive: true });
  fs.writeFileSync(toolProfilePath(projectRoot), JSON.stringify(data, null, 2) + "\n", "utf8");
  return data;
}

export function scaffoldToolProfile(projectRoot) {
  const p = toolProfilePath(projectRoot);
  if (fs.existsSync(p)) return readToolProfileFile(projectRoot);
  const data = {
    active: "code",
    enforcement: "advisory",
    profiles: { ...DEFAULT_PROFILES },
    scaffoldedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
  return data;
}

export function isEnforcementStrict(profileData) {
  return profileData?.enforcement === "strict";
}

/** @param {object} staticCap agent-capabilities.json */
export function getSuggestedTools(staticCap, profileData) {
  const active = profileData?.active ?? "code";
  const prof = profileData?.profiles?.[active] ?? DEFAULT_PROFILES[active];
  const groups = staticCap?.mcp?.toolGroups ?? [];
  const allTools = new Set((staticCap?.mcp?.tools ?? []).map((t) => t.name));

  let toolNames = [];
  if (prof.toolGroups.includes("*")) {
    toolNames = [...allTools];
  } else {
    for (const g of groups) {
      if (prof.toolGroups.includes(g.id)) {
        for (const t of g.tools ?? []) {
          if (allTools.has(t)) toolNames.push(t);
        }
      }
    }
  }
  toolNames = [...new Set(toolNames)];

  const strict = isEnforcementStrict(profileData);
  return {
    active,
    enforcement: profileData?.enforcement ?? "advisory",
    hint: prof.hint,
    preferCursorTools: prof.preferCursorTools ?? [],
    suggestedTools: toolNames,
    advisory: !strict,
  };
}

/** @returns {{ allowed: boolean, message?: string, suggestedTools?: string[] }} */
export function checkToolAllowed(toolName, staticCap, profileData) {
  if (!isEnforcementStrict(profileData)) return { allowed: true };
  if (META_ALLOWLIST.has(toolName)) return { allowed: true };

  const hint = getSuggestedTools(staticCap, profileData);
  if (hint.suggestedTools.includes(toolName)) return { allowed: true };

  return {
    allowed: false,
    message: `Tool "${toolName}" blocked — strict profile active=${hint.active}. Use suggested MCP tools or agent_set_tool_profile profile=full.`,
    suggestedTools: hint.suggestedTools,
  };
}
