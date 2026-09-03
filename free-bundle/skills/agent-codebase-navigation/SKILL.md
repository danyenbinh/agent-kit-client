---
name: agent-codebase-navigation
description: >-
  Đọc hiểu Unity/codebase tiết kiệm token — L0 discover → L1 index → L2 module → L3 class.
  Auto-stale sau compile Unity. Use when hiểu project/module/class trước code.
disable-model-invocation: false
---

# Agent Codebase Navigation

**Không** hardcode `Assets/_Project/Scripts` — MCP **tự discover** mọi `Assets/**/Scripts`.

## Thang đọc

| Level | MCP | Nội dung |
|-------|-----|----------|
| **S0** | `agent_project_scan` | Bundled profile + layers + modules (+ anchors nếu `depth=deep`) — **đầu session** |
| **L0** | `agent_discover_project` | Roots, Unity version, URP/packages, scenes — **không parse types** |
| **L0P** | `agent_get_index_health` | PKE manifest — `status=fresh\|stale` + compact (ưu tiên khi manifest tồn tại) |
| **L0b** | `agent_read_project_profile` | Profile đã lưu + stale warning |
| **L0c** | `agent_index_status` | Legacy stale-marker — khi manifest missing |
| **L0L** | `agent_read_code_layers` | Tầng game / framework (`code-layer-registry`) |
| **L1** | `agent_read_project_index` | Modules + type counts |
| **L1.5** | `agent_read_module_anchors` | Manager/Controller + public API tóm tắt |
| **L2** | `agent_read_module_index` | Types trong 1 module |
| **L2b** | `agent_find_in_module` | Tìm symbol trong module — trước Read |
| **L3** | `agent_read_type_digest` / `agent_read_type_outline` | Public methods 1 class |
| **L4** | `Read` 1 `.cs` | Chỉ khi L3 thiếu |

## Build / update index

| Tình huống | Tool |
|------------|------|
| Lần đầu / refactor lớn | `agent_build_project_index` |
| Bootstrap project | `onboard-project.mjs` — `build_index` + `live_index` tạo PKE manifest |
| Unity vừa compile (stale) | `agent_apply_index_delta` → auto `rebuild_module_anchors` |
| Sau full build | `agent_rebuild_module_anchors` |

Unity ghi `.cursor/codebase-index/stale-marker.json` sau compile (`CodebaseIndexStaleMarker`); PKE manifest mirror qua `live_index` / auto-delta.

## Workflow task code

```
agent_get_index_health
→ (stale? unity_bridge_invoke rebuild_code_index : continue)
agent_project_scan depth=standard
→ (stale → agent_apply_index_delta)
→ agent_read_module_anchors moduleId=...
→ agent_read_type_digest
→ Read 1 file
```

Skill: [unity-project-scan](../unity-project-scan/SKILL.md) · [unity-code-map](../unity-code-map/SKILL.md)

## Override roots (project tuỳ chọn)

`.cursor/project-map.json`:

```json
"scriptsRoots": ["Assets/MyGame/Scripts", "Assets/Shared/Scripts"]
```

## Không làm

- `list_dir Assets/` / glob `**/*.cs` để khám phá
- Full `agent_build_project_index` mỗi session
- Bỏ qua stale marker sau compile
