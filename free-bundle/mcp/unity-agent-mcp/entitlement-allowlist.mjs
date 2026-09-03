/**
 * Phase 3 — hard entitlement allowlist for commercial Unity Pro/Studio.
 * File: .cursor/agent-kit/mcp-allowlist.json
 * When enforcement === "strict", only listed tools (+ tip/meta) may run.
 */
import fs from "node:fs";
import path from "node:path";

export const TIP_AND_META = new Set([
  "agent_kit_client_status",
  "agent_kit_entitlements",
  "agent_kit_allowed_tools",
  "agent_kit_apply_packs",
  "agent_kit_save_license",
  "agent_get_usage",
  "agent_record_turn",
  "agent_validate_registry",
  "agent_get_capabilities",
  "agent_set_tool_profile",
  "agent_get_tool_profile",
  "agent_read_task_handoff",
  "agent_update_task_handoff",
]);

export function entitlementAllowlistPath(projectRoot) {
  if (process.env.AGENT_KIT_ALLOWLIST) {
    return path.isAbsolute(process.env.AGENT_KIT_ALLOWLIST)
      ? process.env.AGENT_KIT_ALLOWLIST
      : path.join(projectRoot, process.env.AGENT_KIT_ALLOWLIST);
  }
  return path.join(projectRoot, ".cursor", "agent-kit", "mcp-allowlist.json");
}

export function readEntitlementAllowlist(projectRoot) {
  const p = entitlementAllowlistPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** @returns {{ allowed: boolean, skipped?: boolean, message?: string, tools?: string[] }} */
export function checkEntitlementAllowlist(projectRoot, toolName) {
  const data = readEntitlementAllowlist(projectRoot);
  if (!data) return { allowed: true, skipped: true };
  if (data.enforcement !== "strict") return { allowed: true, advisory: true, tools: data.tools };

  if (TIP_AND_META.has(toolName)) return { allowed: true, tools: data.tools };
  const tools = new Set(data.tools || []);
  if (tools.has(toolName)) return { allowed: true, tools: data.tools };

  return {
    allowed: false,
    message:
      `Tool "${toolName}" blocked by agent-kit entitlement allowlist (strict). ` +
      `Packs=[${(data.packs || []).join(",")}]. Run sync-entitled or buy pack that includes this tool.`,
    tools: data.tools,
  };
}

/** Filter MCP tool defs for tools/list when strict. */
export function filterToolsByEntitlement(projectRoot, toolDefs) {
  const data = readEntitlementAllowlist(projectRoot);
  if (!data || data.enforcement !== "strict") return toolDefs;
  const allowed = new Set([...(data.tools || []), ...TIP_AND_META]);
  return toolDefs.filter((t) => allowed.has(t.name));
}
