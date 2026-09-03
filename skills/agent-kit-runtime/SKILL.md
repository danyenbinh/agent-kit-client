---
name: agent-kit-runtime
description: >-
  Agent Kit client tip — bootstrap, license, sync entitled packs, dual-host
  Cursor/Claude Code. Use when agent-kit-client, license, sync-entitled, host adapter.
disable-model-invocation: false
---

# Agent Kit Runtime (client tip)

**Pack:** `core` (universal). **Hosts:** Cursor, Claude Code.

## Commands

```powershell
powershell -File agent-kit-client/scripts/bootstrap-client.ps1 -HostName both
# Preferred: in Cursor, MCP agent_kit_save_license + agent_kit_apply_packs
powershell -File agent-kit-client/scripts/sync-entitled.ps1
```

## MCP tip

- `agent_kit_client_status`
- `agent_kit_entitlements`
- `agent_kit_allowed_tools`
- `agent_kit_save_license` — write license.json from portal key
- `agent_kit_apply_packs` — download zips from license server + install into workspace (Apply)

Portal `/app` → **Copy Apply prompt** → paste in Cursor chat. Browser cannot write project disk; Apply runs in Cursor via MCP.

## Studio / review / GTM / V1

- SKU `unity-studio` / key `dev-studio` → shadergraph + figma-hud + builder + review
- `scripts/review-submit.ps1` → cloud `POST /v1/reviews`
- Customer docs: `agent-kit-client/docs/` (Cursor + Claude Code quickstarts)
- Unity MCP path after sync: `.cursor/agent-kit/mcp/unity-agent-mcp` (from pack, not kit-dev)
- ADHD factory pilot may still point MCP at `agent-kit-cloud/kit-dev`; set `AGENT_KIT_ALLOWLIST_ADVISORY=1` if Pro allowlist would strip tools

## Not included

kit-dev, governance, promotion. Unity Bridge = pack `unity-runtime`.
