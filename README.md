# agent-kit-client

**Ngọn runtime** đa host / đa domain — https://github.com/danyenbinh/agent-kit-client

| Có | Không có |
|----|----------|
| Skill stub, bootstrap, license sync | `kit-dev`, governance, promotion |
| Pack sau `sync-entitled` theo entitlement | Full Unity/PKE source (nằm cloud dist) |

Factory: https://github.com/danyenbinh/agent-kit-cloud — xem [TAXONOMY](https://github.com/danyenbinh/agent-kit-cloud/blob/main/TAXONOMY.md) (local: `../agent-kit-cloud/TAXONOMY.md`).

## Hai trục (tóm tắt)

- **Platform:** `universal` (Core) → `unity` (Pro/Studio) → `web` sau  
- **Host:** `cursor` first → `claude-code` Phase 1 → `vscode` sau  

## Phase 0

Registry v2: [registry/commercial-packs.json](registry/commercial-packs.json) có `axes` + `skus`.  
Tag đề xuất: `v0.1.0-dev`.

## Quick start (Cursor — host hiện tại)

```powershell
powershell -ExecutionPolicy Bypass -File agent-kit-client\scripts\bootstrap-client.ps1
# điền .cursor\agent-kit-license.json
powershell -ExecutionPolicy Bypass -File agent-kit-client\scripts\sync-entitled.ps1
```

Claude Code bootstrap: Phase 1 (`-Host claude-code`).
