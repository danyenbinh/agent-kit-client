/**
 * MCP mỏng — client tip. Chỉ meta nhẹ; tool pack nặng do merge sau khi sync pack.
 * Full MCP nằm ở agent-kit-cloud/kit-dev/mcp (không ship nguyên cho khách).
 */
import { createServer } from "node:http";

const PORT = Number(process.env.AGENT_KIT_CLIENT_MCP_PORT || 0);

const tools = [
  {
    name: "agent_kit_client_status",
    description: "Trạng thái client tip: license path, installed packs (local).",
  },
];

export function listTools() {
  return tools;
}

export async function handleTool(name, _args = {}) {
  if (name === "agent_kit_client_status") {
    return {
      mode: "client-tip",
      note: "Chạy bootstrap-client.ps1 + sync-entitled.ps1. Pack runtime từ agent-kit-cloud/dist.",
      tools: tools.map((t) => t.name),
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}

// Optional tiny HTTP probe (not full MCP stdio — wire stdio in cutover)
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("index.mjs")) {
  if (PORT > 0) {
    createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(await handleTool("agent_kit_client_status")));
    }).listen(PORT);
  }
}

console.error("[agent-kit-client] tip MCP module loaded — use Cursor mcp.json cutover later");
