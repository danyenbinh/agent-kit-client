---
name: agent-kit-runtime
description: >-
  Agent Kit client tip — bootstrap, license, sync entitled packs, dual-host
  Cursor/Claude Code. Use when agent-kit-client, license, sync-entitled, host adapter.
disable-model-invocation: false
---

# Agent Kit Runtime (client tip)

**Pack:** `core` (universal). **Free Unity tier also applies:** `unity-runtime` + `pke`.

**Hosts:** Cursor, Claude Code. Extension: **Agent Kit for Unity**.

## Commands

```powershell
powershell -File agent-kit-client/scripts/bootstrap-client.ps1 -HostName both
# Preferred: MCP agent_kit_save_license + agent_kit_apply_packs
# Or extension panel: Apply free packs
powershell -File agent-kit-client/scripts/sync-entitled.ps1
```

## Free tier (Core)

| Pack | What |
|------|------|
| `core` | Tip MCP, license, host adapters |
| `unity-runtime` | Basic Unity MCP — bridge ping / compile / verify + meta tools |
| `pke` | Project Knowledge Engine (index before Grep) |

**ISR (every agent reply):** after tasks, call `agent_record_turn` when Unity MCP is wired; end user-facing replies with a short `### ISR` block (commit review / issue verify / MCP / skill learnings). Do not invent token estimates for the user.

## Tip MCP

- `agent_kit_client_status`
- `agent_kit_entitlements`
- `agent_kit_allowed_tools`
- `agent_kit_save_license`
- `agent_kit_apply_packs` — optional `packIds`
- `agent_kit_pack_status`

## Pro / Studio (portal)

| SKU | Extra packs |
|-----|-------------|
| Unity Pro | `vfx` |
| Unity Studio | `vfx` + `shadergraph` + `figma-hud` + `builder` + `review` |

## Not included in free

VFX / Builder / Shader Graph catalogs. kit-dev, governance, promotion.
