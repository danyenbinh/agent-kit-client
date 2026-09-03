# Quickstart — Cursor

## Free (recommended): offline Init

1. Install **Agent Kit for Unity** extension (Marketplace or `.vsix`)
2. Open your Unity project folder in Cursor
3. Command Palette → **Agent Kit for Unity: Init into project**
4. Reload MCP
5. Try: `agent_kit_client_status` · `unity_ping` · `agent_get_index_health` · `agent_record_turn`

Or from a clone of this repo:

```powershell
powershell -File agent-kit-client/scripts/init-agent-kit.ps1 -HostName cursor
```

**Bundled free:** core tip MCP + `unity-agent` MCP + PKE skills + ISR tools. No license web.

---

## Pro / Studio (portal)

### 1. License file

Edit `.cursor/agent-kit-license.json` (created by Init):

```json
{
  "key": "YOUR_ORG_KEY",
  "licenseApi": "https://license.example.com"
}
```

Dev keys (local API): `dev-core` | `dev-unity-pro` | `dev-studio`.

### 2. Apply paid packs

Extension → **Open account page**, or MCP `agent_kit_save_license` + `agent_kit_apply_packs`, or:

```powershell
powershell -File agent-kit-client/scripts/sync-entitled.ps1 -HostName cursor
```

### Tips

| Symptom | Fix |
|---------|-----|
| MCP missing after Init | Reload window / MCP servers |
| `free_bundle_missing` | Reinstall extension or run `node scripts/sync-free-bundle.mjs` |
| invalid_key | Check portal key / API URL |

Claude path: [QUICKSTART-CLAUDE-CODE.md](QUICKSTART-CLAUDE-CODE.md)
