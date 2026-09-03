---
name: agent-kit-runtime
description: >-
  Agent Kit client tip — offline init free packs, license, sync entitled packs,
  dual-host Cursor/Claude Code. Use when agent-kit-client, agent_kit_init, license.
disable-model-invocation: false
---

# Agent Kit Runtime (client tip)

**Pack:** `core` (universal). **Free Unity tier:** `unity-runtime` + `pke` + ISR meta tools.

**Hosts:** Cursor, Claude Code. Extension: **Agent Kit for Unity**.

## Free path (no portal)

```powershell
# Extension: Command Palette → Agent Kit for Unity: Init into project
# Or git / Claude:
powershell -File agent-kit-client/scripts/init-agent-kit.ps1 -HostName both
# Or MCP (after tip is wired once): agent_kit_init
```

Init copies **offline free-bundle**: tip MCP + `unity-agent` host (unity-runtime) + **pke** MCP modules + ISR allowlist. **Not included:** VFX / Builder / Shader / Figma MCP files (those packs ship their own modules). Reload MCP, then `agent_kit_client_status` / `unity_ping` / `agent_get_index_health` / `agent_record_turn`.

## Commands (optional / Pro)

```powershell
powershell -File agent-kit-client/scripts/bootstrap-client.ps1 -HostName both
# Pro packs: portal Apply or MCP agent_kit_save_license + agent_kit_apply_packs
powershell -File agent-kit-client/scripts/sync-entitled.ps1
```

## Free tier contents

| Pack / piece | What |
|--------------|------|
| `core` | Tip MCP, license stub, host adapters |
| `unity-runtime` | `unity-agent` MCP — bridge ping / compile / verify + meta |
| `pke` | Live index skills + project-knowledge / codebase-index tools |
| ISR | `agent_record_turn` / `agent_get_usage` (Unity MCP meta) |

## Tip MCP

- `agent_kit_init` — **preferred** offline free install
- `agent_kit_client_status`
- `agent_kit_entitlements`
- `agent_kit_allowed_tools`
- `agent_kit_save_license`
- `agent_kit_apply_packs` — Pro packs (needs license)
- `agent_kit_pack_status`

## Pro / Studio (portal)

| SKU | Extra packs |
|-----|-------------|
| Unity Pro | `vfx` |
| Unity Studio | `vfx` + `shadergraph` + `figma-hud` + `builder` + `review` |

## Not included in free

VFX / Builder / Shader Graph catalogs. kit-dev, governance, promotion.
