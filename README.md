# agent-kit-client

**Ngọn runtime** cho khách / project Unity. Không chứa hệ thống phát triển kit.

| Có | Không có |
|----|----------|
| Skill stub MD, bootstrap, license client | `agent-kit-promotion`, governance, north-star nội bộ |
| MCP mỏng + sync theo entitlement | Full PKE/VFX/Figma source |
| Pack đã mua (sau `sync-entitled`) | TemplatePro, ISR factory, pack publisher |

SSOT pack & factory: repo/folder [`../agent-kit-cloud`](../agent-kit-cloud).

ADHD nội bộ vẫn dùng `cursor-agent-kit/` cho đến khi cutover xong.

## Quick start (khách)

```powershell
# 1. Copy hoặc submodule agent-kit-client vào root repo game
# 2. Điền license
copy agent-kit-client\license\license.example.json .cursor\agent-kit-license.json
# sửa key / org

# 3. Bootstrap ngọn
powershell -ExecutionPolicy Bypass -File agent-kit-client\scripts\bootstrap-client.ps1

# 4. Kéo pack đã mua
powershell -ExecutionPolicy Bypass -File agent-kit-client\scripts\sync-entitled.ps1
```

## Pack ids

Xem `registry/commercial-packs.json`. Mua gói nào → sync chỉ init gói đó.
