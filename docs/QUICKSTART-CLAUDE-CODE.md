# Quickstart — Claude Code

Same free packs as Cursor. Host adapter uses `.mcp.json`.

## Free: offline Init

```powershell
powershell -File agent-kit-client/scripts/init-agent-kit.ps1 -HostName claude-code
# dual-host:
powershell -File agent-kit-client/scripts/init-agent-kit.ps1 -HostName both
```

Or MCP **`agent_kit_init`** with `hosts: ["claude-code"]` (or both) after tip MCP is available.

Reload / restart Claude Code. Verify: `agent_kit_client_status`, `unity_ping`, `agent_get_index_health`, `agent_record_turn`.

Init writes Unity MCP under `.cursor/agent-kit/mcp/unity-agent-mcp` and merges into `.mcp.json`.

## Pro / Studio

Same `.cursor/agent-kit-license.json` as Cursor:

```powershell
powershell -File agent-kit-client/scripts/sync-entitled.ps1 -HostName claude-code
```

## Notes

- Pricing does **not** change by host.  
- Free Init does not need the portal.  
- Dual-host: `-HostName both`, one project tree.

Cursor path: [QUICKSTART-CURSOR.md](QUICKSTART-CURSOR.md)
