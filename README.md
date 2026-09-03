# agent-kit-client

**Ngọn runtime** cho khách / project Unity. Repo: https://github.com/danyenbinh/agent-kit-client

| Có | Không có |
|----|----------|
| Skill stub MD, bootstrap, license client | Hệ thống phát triển kit (`kit-dev`) |
| MCP tip + sync theo entitlement | Full PKE/VFX source (nằm ở cloud dist) |
| Pack đã mua (sau `sync-entitled`) | TemplatePro, promotion, governance |

Factory / private: repo [`agent-kit-cloud`](https://github.com/danyenbinh/agent-kit-cloud).

## Cutover (2026-09)

`cursor-agent-kit` đã gỡ. ADHD dùng:

- Factory MCP/skills SSOT: `agent-kit-cloud/kit-dev`
- Client tip (commercial path): folder này

## Quick start

```powershell
powershell -ExecutionPolicy Bypass -File agent-kit-client\scripts\bootstrap-client.ps1
# điền .cursor\agent-kit-license.json
powershell -ExecutionPolicy Bypass -File agent-kit-client\scripts\sync-entitled.ps1
```

Pack ids: `registry/commercial-packs.json`.
