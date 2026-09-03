# agent-kit-client

**Agent Kit** — skills + MCP packs for your AI coding agent (**Cursor** & **Claude Code**).  
Not a new IDE. https://github.com/danyenbinh/agent-kit-client

---

## Free: one Init (no portal)

Offline bundle ships **only** free packs. No license web, no Apply for Core.

| Pack / piece | What you get |
|--------------|--------------|
| **core** | Tip MCP (`agent_kit_*`), license stub, host adapters |
| **unity-runtime** | Unity MCP **host** — bridge ping / compile / verify + ISR meta |
| **pke** | PKE **MCP modules** + index skills (less blind Grep) |
| **ISR** | `agent_record_turn` / `agent_get_usage` (via unity-runtime meta) |

**Not in free** (separate pack MCP modules, Pro/Studio only):

| Pack | MCP modules (examples) |
|------|-------------------------|
| `vfx` | `vfx-catalog.mjs`, `vfx-storage.mjs` |
| `builder` | `builder-catalog.mjs` |
| `shadergraph` | `shadergraph-catalog.mjs` |
| `figma-hud` | `figma-ui.mjs` |

MCP is **per pack**: free merges `unity-runtime` host + `pke` addons only. Pro catalogs are never bundled in the extension / `free-bundle/`. Applying a paid pack overlays that pack’s modules into `.cursor/agent-kit/mcp/unity-agent-mcp`.

---

### Cursor (extension)

1. Install **Agent Kit for Unity** (`ZezoCode.agent-kit-for-unity`) or a local `.vsix`
2. Open your Unity project folder
3. Command Palette → **Agent Kit for Unity: Init into project**  
   (or side panel → **Init Agent Kit**)
4. Reload MCP → try:
   - `agent_kit_client_status`
   - `unity_ping`
   - `agent_get_index_health`
   - `agent_record_turn`

### Claude Code / git clone

```powershell
powershell -File agent-kit-client/scripts/init-agent-kit.ps1 -HostName both
# optional: -ProjectRoot "D:\path\to\UnityProject"
```

Or MCP **`agent_kit_init`** once tip MCP is available (`hosts: ["cursor","claude-code"]`).

---

## Pro / Studio

| SKU | Extra packs |
|-----|-------------|
| **Unity Pro** | `vfx` |
| **Unity Studio** | `vfx` + `shadergraph` + `figma-hud` + `builder` + `review` |

1. Set license in `.cursor/agent-kit-license.json` (or extension **Open account page** / `agent_kit_save_license`)
2. Apply: portal **Apply**, or MCP `agent_kit_apply_packs`, or `scripts/sync-entitled.ps1`

Paid pack zips include that pack’s MCP modules; apply **merges** them onto the host MCP folder (does not replace free PKE/runtime unless you re-apply host).

---

## Repo layout

```
agent-kit-client/
  free-bundle/          # offline Core (synced from cloud dist; no Pro MCP)
  mcp/agent-kit-client/ # tip MCP (init, license, apply)
  scripts/
    init-agent-kit.ps1
    sync-free-bundle.mjs
    sync-entitled.ps1
  skills/agent-kit-runtime/
  extension/            # VS Code / Cursor VSIX — Agent Kit for Unity
  docs/                 # quickstarts + pricing
```

---

## Docs

- [Quickstart](docs/QUICKSTART.md) · [Cursor](docs/QUICKSTART-CURSOR.md) · [Claude Code](docs/QUICKSTART-CLAUDE-CODE.md)
- [Pricing](docs/PRICING.md) · [Extension](docs/EXTENSION-CORE.md)
- Marketplace publish (vendor-only): private `agent-kit-cloud/ops/MARKETPLACE.md`

---

## Maintainers

Needs sibling `agent-kit-cloud` with built `dist/` packs:

```powershell
# cloud
powershell -File agent-kit-cloud/factory/build-all-packs.ps1

# client free-bundle + extension vendor
cd agent-kit-client
node .\scripts\sync-free-bundle.mjs
cd extension
npm run package   # Node 20+ → agent-kit-for-unity-*.vsix
```

Per-pack MCP map (vendor SSOT): `agent-kit-cloud/registry/mcp-modules.json`.

Factory / license portal: private **agent-kit-cloud**.
