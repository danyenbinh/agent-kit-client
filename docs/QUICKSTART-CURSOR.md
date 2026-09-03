# Quickstart — Cursor

## Prerequisites

- Windows or macOS/Linux with PowerShell 7+ (Windows PowerShell 5.1 OK for scripts)  
- Node 20+ (MCP tip)  
- Cursor with MCP enabled  
- This repo checked out next to your game/app project **or** as a submodule/path you pass to scripts  

## 1. Bootstrap

From your **project root** (parent of `agent-kit-client` if nested):

```powershell
powershell -File agent-kit-client/scripts/bootstrap-client.ps1 -HostName cursor
```

Creates/updates:

- `.cursor/skills/agent-kit-runtime`  
- `.cursor/agent-kit-license.json` (edit `key` + `licenseApi`)  
- Cursor MCP tip entry (see script output)

## 2. License

Edit `.cursor/agent-kit-license.json`:

```json
{
  "key": "YOUR_ORG_KEY",
  "licenseApi": "https://license.example.com"
}
```

Dev keys (local API): `dev-core` | `dev-unity-pro` | `dev-studio`.

## 3. Tip MCP

```powershell
cd agent-kit-client/mcp/agent-kit-client
npm install
```

Reload MCP in Cursor. Call:

- `agent_kit_client_status`  
- `agent_kit_entitlements`

## 4. Sync entitled packs

Vendor must expose pack `dist/` (or signed URLs). Then:

```powershell
powershell -File agent-kit-client/scripts/sync-entitled.ps1 -HostName cursor
```

Unity Pro/Studio writes `.cursor/agent-kit/mcp-allowlist.json` (often **strict**) and installs Unity MCP at:

`.cursor/agent-kit/mcp/unity-agent-mcp`  
→ `npm install` once in that folder; merge server into `.cursor/mcp.json` using `mcp.entitled.hint.json`.

## 5. Unity (Pro+)

1. Open Unity with Bridge from the `unity-runtime` pack.  
2. Confirm `unity_ping`.  
3. Prefer PKE/index tools before wide Grep.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| invalid_key | Check portal key / API URL |
| Tool blocked (strict) | Pack missing that tool — upgrade SKU or sync |
| No Unity tools | Core-only key; need Unity Pro/Studio |

Next: [Claude Code quickstart](QUICKSTART-CLAUDE-CODE.md)
