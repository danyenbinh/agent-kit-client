# agent-kit-client

**Agent Kit tip** — skills + MCP for Cursor & Claude Code (not a new IDE).  
https://github.com/danyenbinh/agent-kit-client

## Free: one Init (no portal)

Bundled offline: **core** + **unity-agent MCP** + **PKE** + **ISR** meta tools.

### Extension (Cursor)

1. Install **Agent Kit for Unity** (`ZezoCode.agent-kit-for-unity`) or local `.vsix`
2. Open your Unity project folder
3. Command Palette → **Agent Kit for Unity: Init into project** (or side panel → **Init Agent Kit**)
4. Reload MCP → try `agent_kit_client_status` / `unity_ping` / `agent_get_index_health` / `agent_record_turn`

### Git / Claude Code

```powershell
powershell -File agent-kit-client/scripts/init-agent-kit.ps1 -HostName both
```

Or MCP tool **`agent_kit_init`** once tip MCP is available.

Rebuild free bundle (maintainers with cloud dist):

```powershell
node agent-kit-client/scripts/sync-free-bundle.mjs
```

## Pro / Studio

VFX · Builder · Shader · Figma HUD · Review still use license portal **Apply** (`agent_kit_save_license` + `agent_kit_apply_packs`).

## Docs

- [Quickstart](docs/QUICKSTART.md) · [Cursor](docs/QUICKSTART-CURSOR.md) · [Claude](docs/QUICKSTART-CLAUDE-CODE.md)
- [Pricing](docs/PRICING.md)
- Marketplace publish (vendor): `agent-kit-cloud/ops/MARKETPLACE.md`

## Package extension

```powershell
cd agent-kit-client
node .\scripts\sync-free-bundle.mjs
cd extension
npm run package   # Node 20+ → agent-kit-for-unity-0.1.4.vsix
```

Factory / portal: private `agent-kit-cloud`.
