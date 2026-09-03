---
name: unity-code-map
description: L0 code layers → module anchors → type digest — mọi project Unity. Không mở .cs khi chưa cần. Use when module, class API, tầng code, manager, scan code.
---

# Unity code map (L0)

**Kit portable.** Bắt đầu scan: [unity-project-scan](../unity-project-scan/SKILL.md) · Thang đầy đủ: [agent-codebase-navigation](../agent-codebase-navigation/SKILL.md).

## Session start (code task)

```
agent_get_index_health              # L0P — PKE manifest (ưu tiên nếu tồn tại)
→ (stale?) unity_bridge_invoke rebuild_code_index | agent_apply_index_delta
agent_project_scan depth=standard
→ agent_read_module_anchors moduleId=...
→ agent_read_type_digest typeName=...
→ Read 1 .cs
```

PKE subsystems (prefab/SO/scene): [unity-live-index](../unity-live-index/SKILL.md).

## Token ladder

| Tầng | Tool | ~token |
|------|------|--------|
| L0P | `agent_get_index_health` | ~80 — manifest fresh/stale |
| S0 | `agent_project_scan` | bundled |
| L0 | `agent_read_code_layers` | ~150 |
| L1 | `agent_read_project_index` | ~400 |
| L1.5 | `agent_read_module_anchors` | ~300 |
| L2 | `agent_find_in_module` | ~200 |
| L3 | `agent_read_type_digest` | ~250 |
| L3.5 | `agent_find_references` | ~200 — type edges jsonl; `direction=related` default |
| L3.6 | `agent_get_module_flow_edges` | ~150 — top outbound types per module |
| L4 | Read 1 `.cs` | cao |

## Chọn module (heuristic)

| Keyword task | moduleId gợi ý (tìm trong scan MODULES) |
|--------------|------------------------------------------|
| Manager, Controller, spawn, battle | `*GameMechanic*`, `*Battle*` |
| Panel, UI, HUD | `*GameUI*`, `*UI*` |
| Save, boot, context | `*Context*`, `*Boot*` |
| Ads, IAP, analytics | `*Ads*`, framework root |

`moduleId` đầy đủ thường `_{Folder}.{SubModule}` — dùng partial match qua `agent_find_in_module`.

## Index lifecycle

| Tình huống | Tool |
|------------|------|
| Lần đầu / mất index | `agent_build_project_index` + onboard `live_index` |
| Sau Unity compile | `agent_apply_index_delta` hoặc PKE auto-delta |
| PKE health | `agent_get_index_health` — ưu tiên hơn `stale-marker.json` |
| Anchors thiếu | `agent_rebuild_module_anchors` |
| Tìm caller / usage | `agent_find_references` symbol=TypeName `direction=callers` — inbound edges |
| Tìm dependency / callee | `direction=callees` hoặc `related` (spawn-on-dead: type chỉ gắn prefab → dùng `related`) |
| Module deps top-N | `agent_get_module_flow_edges` moduleId=... |

Stale: `agent_get_index_health` (PKE) hoặc `.cursor/codebase-index/stale-marker.json` (legacy).

## Project data (không hardcode trong skill)

| File | Vai trò |
|------|---------|
| `.cursor/project-map.json` | `scriptsRoots`, module purpose, entry points |
| `.cursor/codebase-index/` | Index, layers, anchors |
| `.cursor/feature-skills-index.json` | Feature skills — **trước** khi đọc sâu code game |

## Không làm

- Glob `Assets/**/*.cs`
- Read file trước `type_digest`
- Full rebuild mỗi session

## Cập nhật (project)

- Thêm code root → `project-map.json` → `agent_discover_project`
- Layer mới → `code-layer-registry.json`
