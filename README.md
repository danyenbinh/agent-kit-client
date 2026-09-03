# agent-kit-client

**Agent Kit tip** — skills + MCP for your AI coding agent (Cursor & Claude Code).  
https://github.com/danyenbinh/agent-kit-client

**Not an IDE.** Packs unlock by domain SKU (Core → Unity Pro → Unity Studio).

## Docs (GTM + ops)

- [Quickstart index](docs/QUICKSTART.md)
- [Cursor](docs/QUICKSTART-CURSOR.md) · [Claude Code](docs/QUICKSTART-CLAUDE-CODE.md)
- [Pricing summary](docs/PRICING.md)
- Vendor ops (how it works / CRM / invoice): `agent-kit-cloud/ops/HOW-IT-WORKS.md`

## Install

```powershell
powershell -File agent-kit-client/scripts/bootstrap-client.ps1 -HostName both
# set .cursor/agent-kit-license.json → key + licenseApi
cd agent-kit-client/mcp/agent-kit-client
npm install
powershell -File agent-kit-client/scripts/sync-entitled.ps1 -HostName both
```

| Included | Not included |
|----------|----------------|
| `agent-kit-runtime`, stubs, license sync | kit-dev / governance |
| MCP tip (`agent_kit_*`) | Unity Bridge until Unity packs entitled |
| Host adapters Cursor + Claude Code | |

Factory / portal: vendor `agent-kit-cloud` (private). Version: `1.0.0-rc.1` (V1 gate).

V1: Unity MCP installs under `.cursor/agent-kit/mcp/unity-agent-mcp` from pack `unity-runtime` — **not** kit-dev.
