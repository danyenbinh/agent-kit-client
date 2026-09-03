#!/usr/bin/env node
/**
 * Agent Kit client tip MCP — status, entitlements, apply packs into workspace.
 */
import fs from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { applyPacksToProject, saveLicenseFile } from "./apply-packs.mjs";

function projectRoot() {
  return (
    process.env.AGENT_PROJECT_ROOT ||
    process.env.CURSOR_PROJECT_DIR ||
    process.cwd()
  );
}

function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function allowlistPath() {
  const root = projectRoot();
  if (process.env.AGENT_KIT_ALLOWLIST) {
    return path.isAbsolute(process.env.AGENT_KIT_ALLOWLIST)
      ? process.env.AGENT_KIT_ALLOWLIST
      : path.join(root, process.env.AGENT_KIT_ALLOWLIST);
  }
  return path.join(root, ".cursor", "agent-kit", "mcp-allowlist.json");
}

function statusPayload() {
  const root = projectRoot();
  const licensePath = path.join(root, ".cursor", "agent-kit-license.json");
  const bootstrapPath = path.join(root, ".cursor", "agent-kit", "bootstrap-status.json");
  const installedDir = path.join(root, ".cursor", "agent-kit", "installed");
  const license = readJsonSafe(licensePath);
  const bootstrap = readJsonSafe(bootstrapPath);
  const allow = readJsonSafe(allowlistPath());
  let installed = [];
  if (fs.existsSync(installedDir)) {
    installed = fs
      .readdirSync(installedDir)
      .filter((f) => f.endsWith(".json") && !f.includes(".bridge."))
      .map((f) => f.replace(/\.json$/, ""));
  }
  return {
    mode: "client-tip",
    phase: "apply",
    projectRoot: root,
    hosts: bootstrap?.hosts || [],
    licenseKey: license?.key ? `${String(license.key).slice(0, 8)}…` : null,
    licenseApi: license?.licenseApi || null,
    installedPacks: installed.length ? installed : license?.installedPacks || [],
    allowlistTools: allow?.tools?.length || 0,
    skuHint: allow?.skuHint || null,
    hasCursorMcp: fs.existsSync(path.join(root, ".cursor", "mcp.json")),
    hasClaudeMcp: fs.existsSync(path.join(root, ".mcp.json")),
    next: license?.key
      ? "agent_kit_apply_packs to download+init into this project"
      : "Save license from /app then agent_kit_save_license / agent_kit_apply_packs",
    portalHint: "Open Simple Browser to licenseApi /app — Apply uses MCP, not browser disk write",
  };
}

async function entitlementsPayload() {
  const root = projectRoot();
  const licensePath = path.join(root, ".cursor", "agent-kit-license.json");
  const license = readJsonSafe(licensePath);
  if (!license?.key) {
    return { error: "no_license", path: licensePath };
  }
  const api = (license.licenseApi || "http://localhost:8787").replace(/\/$/, "");
  const url = `${api}/v1/entitlements?key=${encodeURIComponent(license.key)}`;
  try {
    const res = await fetch(url);
    const body = await res.json();
    return { ok: res.ok, status: res.status, api, body };
  } catch (e) {
    return {
      ok: false,
      api,
      error: String(e?.message || e),
      fallbackInstalled: license.installedPacks || ["core"],
    };
  }
}

function allowedToolsPayload() {
  const allow = readJsonSafe(allowlistPath());
  if (!allow) {
    return {
      error: "no_allowlist",
      path: allowlistPath(),
      hint: "Run agent_kit_apply_packs after saving license",
    };
  }
  return allow;
}

const TOOLS = [
  {
    name: "agent_kit_client_status",
    description: "Client tip status: hosts, license, installed packs, allowlist size.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_kit_entitlements",
    description: "Fetch entitlements from license API using .cursor/agent-kit-license.json.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_kit_allowed_tools",
    description: "Merged MCP allowlist after apply/sync.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_kit_save_license",
    description:
      "Write .cursor/agent-kit-license.json (key + licenseApi) so Apply can download packs.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
        licenseApi: { type: "string" },
        org: { type: "string" },
      },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_kit_apply_packs",
    description:
      "Download entitled pack zips from license server and install into this workspace (skills, allowlist, Unity MCP). Prefer over manual Download+unzip.",
    inputSchema: {
      type: "object",
      properties: {
        packIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset; default = all entitled packs",
        },
      },
      additionalProperties: false,
    },
  },
];

const server = new Server(
  { name: "agent-kit-client", version: "0.5.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments || {};
  let result;
  if (name === "agent_kit_client_status") result = statusPayload();
  else if (name === "agent_kit_entitlements") result = await entitlementsPayload();
  else if (name === "agent_kit_allowed_tools") result = allowedToolsPayload();
  else if (name === "agent_kit_save_license") {
    result = saveLicenseFile(projectRoot(), {
      key: args.key,
      licenseApi: args.licenseApi,
      org: args.org,
    });
  } else if (name === "agent_kit_apply_packs") {
    result = await applyPacksToProject(projectRoot(), { packIds: args.packIds });
  } else throw new Error(`Unknown tool: ${name}`);
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
