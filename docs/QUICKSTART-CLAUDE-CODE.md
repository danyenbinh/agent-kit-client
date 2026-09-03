# Quickstart — Claude Code

Same packs as Cursor. Only the **host adapter** differs (`.mcp.json` + `CLAUDE.md` section).

## 1. Bootstrap

```powershell
powershell -File agent-kit-client/scripts/bootstrap-client.ps1 -HostName claude-code
# or both hosts:
powershell -File agent-kit-client/scripts/bootstrap-client.ps1 -HostName both
```

## 2. License + sync

Use the same `.cursor/agent-kit-license.json` (shared project license file):

```powershell
powershell -File agent-kit-client/scripts/sync-entitled.ps1 -HostName claude-code
```

## 3. MCP tip

Ensure `agent-kit-client/mcp/agent-kit-client` has `npm install`.  
Claude Code reads project `.mcp.json` — reload / restart Claude Code after bootstrap.

Verify with tip tools: `agent_kit_client_status`, `agent_kit_entitlements`.

## 4. Unity tools

Identical MCP tool names as Cursor (`unity_ping`, PKE, …).  
After `sync-entitled`, Unity MCP lives at `.cursor/agent-kit/mcp/unity-agent-mcp` — merge into `.mcp.json` using the hint file.  
Unity Editor + Bridge must be running; the host only speaks MCP stdio.

## Notes

- Pricing does **not** change if you use Claude Code instead of Cursor.  
- Do not expect `kit-dev` or studio governance rules in this client.  
- For dual-host teams: `-HostName both`, one license key.

Cursor path: [QUICKSTART-CURSOR.md](QUICKSTART-CURSOR.md)
