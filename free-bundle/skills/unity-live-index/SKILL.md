---
name: unity-live-index
description: >-
  Project Knowledge Engine (PKE) — query manifest health, live C#/prefab index
  trước Grep/Read. Use when index stale, sau compile/merge, prefab audit,
  hoặc cần biết project fresh trước implement.
disable-model-invocation: false
---

# Unity live index (PKE)

**Kit portable.** Contract: [PKE-SCHEMAS.md](../../registry/templates/PKE-SCHEMAS.md) · Gap: [PKE-GAP-AUDIT.md](../../reference/AgentBridge/PKE-GAP-AUDIT.md).

**SSOT runtime:** `.cursor/project-knowledge/manifest.json`

## Bootstrap / onboard (Phase 7)

Repo mới — `setup-new-project.ps1 -Force` (PKE/bridge **mặc định ON**, opt-out `-NoCopyBridge`):

```
copy-bridge-core → Assets/Editor/AgentBridge/Index/
onboard-project.mjs → build_index → live_index
```

| Phase onboard | Kết quả |
|---------------|---------|
| `live_index` (Unity mở) | bridge batch: `rebuild_code_index` + `rebuild_reference_index` + `refresh_build_scene_index` |
| `live_index` (Unity tắt) | offline csharp + references manifest; scenes pending |
| Sau Unity mở | `agent_get_index_health` → `status=fresh` |

Resume:

```powershell
node cursor-agent-kit/scripts/onboard-project.mjs --from-phase live_index
```

## Khi nào dùng

- Đầu session code/scene sau Unity compile hoặc `git pull`
- Trước Grep root `Assets/` — kiểm tra PKE đã fresh chưa
- Task prefab/boss — fingerprint thay Read YAML (Phase 2+)
- User nhắc PKE, live index, index health

## Workflow (token ladder)

```
agent_get_index_health          # status=fresh|stale + --- compact --- JSON
→ (sau git pull) agent_get_changed_since since=<handoff.lastSessionAt>
→ fresh? continue : (Unity mở → đợi compile / bridge rebuild_code_index)
→ manual: unity_bridge_invoke rebuild_code_index | Editor menu Cursor Agent/PKE/Rebuild Code Index
→ batch ≥2 bridge: unity_bridge_batch [{command:ping},{command:rebuild_code_index,args:{skipIfFresh:true}}] timeoutMs:120000
→ auto-delta (compile) cũng rebuild `module-anchors` — parity `agent_apply_index_delta`
→ code task: unity-code-map ladder
→ prefab task: agent_get_prefab_fingerprint path=Assets/.../Boss.prefab  # không Read .prefab YAML
→ save prefab in Unity → fingerprint auto (prefab-save, ~500ms debounce)
→ status=stale|missing → unity_bridge_invoke rebuild_prefab_fingerprint args path=...
→ boss folder audit (Unity tắt): agent_prefab_audit folder=Assets/.../Boss
→ boss folder audit (Unity mở): unity_bridge_invoke prefab_audit folder=... rebuild=true
→ SO task: agent_query_scriptable path=Assets/.../FooDatabase.asset  # không Read .asset YAML
→ SO tracking ON (menu) + reimport → digest auto; stale → unity_bridge_invoke rebuild_scriptable_digest args path=...
→ save scene in Unity → SceneKnowledgeWriter (scene-save) → project-knowledge/scenes/ (anchors + roleHints)
→ onboard lần đầu (Unity mở): phase `live_index` → `agent_get_index_health`
→ scene follow-up: `scan_build_scenes` / `unity_refresh_build_scene_index`
```

| Bước | Tool | Phase |
|------|------|-------|
| Health | `agent_get_index_health` | 1.5 — `status=fresh\|stale`, block `compact` |
| PKE refresh (manual) | `unity_bridge_invoke` command `rebuild_code_index` | 1.4 |
| PKE refresh (batch) | `unity_bridge_batch` — `ping` + `rebuild_code_index` args `skipIfFresh:true` timeoutMs 120000 | 1.4 |
| C# | `agent_find_in_module` → `agent_read_type_digest` | có sẵn |
| Prefab digest | `agent_get_prefab_fingerprint` | 2.5 — query **path** hoặc **guid** (32 hex); path fallback index nếu thiếu `.meta` |
| Prefab audit (offline) | `agent_prefab_audit` | 2.3 — scan JSON index, không cần Unity |
| Prefab audit (live) | `unity_bridge_invoke` `prefab_audit` | 2.6 — AssetDatabase folder scan + missing refs |
| Prefab rebuild | `unity_bridge_invoke` `rebuild_prefab_fingerprint` | 2.3 |
| Path exclusions | chỉ `Assets/` — không Library/Temp/Packages/PackageCache | 2.7 |
| Prefab auto-save | `ProjectKnowledgePrefabSaveTracker` + debounce queue | 2.7 |
| Scene SSOT | `.cursor/project-knowledge/scenes/{name}.json` | 3.1 |
| Scene anchors L1.5 | `agent_read_scene_anchors` — PKE-first, `roleHints` + `role=` per anchor | 3.2 |
| Scene health | `agent_get_index_health` verbose → `scenesFresh` | 3.1 |
| Onboard live PKE | `onboard-project.mjs` phase `live_index` | 7.4 |
| Onboard scan | `onboard-project.mjs` phase `scan_build_scenes` → `unity_refresh_build_scene_index` | 3.4 |
| Reference index | `agent_find_references` symbol=TypeName `direction=related` | 4.3 jsonl compact |
| Module flow deps | `agent_get_module_flow_edges` moduleId=… | 4.5 flow-by-module |
| Reference rebuild | `unity_bridge_invoke rebuild_reference_index` \| menu **Rebuild Reference Index** | 4.1 |
| Onboard references | `onboard-project.mjs` phase `build_references` | 4.2 |
| Changes since pull | `agent_get_changed_since` since=handoff ISO | 5.4 |
| Git hook (optional) | `install-pke-git-hook.ps1` | 5.5 |
| Scriptable digest | `agent_query_scriptable` path\|guid\|type | 6.3 — không Read `.asset` YAML |
| SO tracking toggle | Editor menu **Track ScriptableObject Assets** (default OFF) | 6.1 |
| SO rebuild | `unity_bridge_invoke rebuild_scriptable_digest` \| menu **Rebuild Scriptable Digests** | 6.2 |

### `agent_get_prefab_fingerprint` (2.5)

```json
{ "path": "Assets/_DangerDungeon/AddressableData/Enemies/Boss/Enemy_Devil_None.prefab" }
{ "guid": "bbfcbc397761877488a2c758a3d14a70" }
{ "path": "...", "guid": "...", "verbose": true }
```

- `status=ok` → block `--- compact ---` JSON (không Read YAML prefab)
- `status=stale` → `unity_bridge_invoke rebuild_prefab_fingerprint` với `path`
- `status=error` + `path_guid_mismatch` → path/guid không cùng prefab

**MCP:** Reload MCP server sau `sync-kit.ps1` nếu tool not found.

### `prefab_audit` bridge (2.6)

```json
{ "folder": "Assets/_DangerDungeon/AddressableData/Enemies/Boss" }
{ "folder": "Assets/.../Boss", "rebuild": "true", "includeAll": "false" }
```

- Unity mở — timeout 120s (`bridge-slow-commands`)
- `rebuild=true` → rebuild fingerprint từng prefab trước khi đọc missing refs
- Response `data.prefabAudit`: `{ folder, audited, missingRefs, entries[] }` — mỗi entry có `missingRefs[]` (component, property, gameObjectPath)
- Unity tắt → dùng `agent_prefab_audit` (offline JSON)

| Call site | `agent_find_references` | 4.1 |
| Changes | `agent_get_changed_since` | 5 |

## Đọc manifest thủ công (Unity tắt)

Chỉ khi MCP thiếu: Read `.cursor/project-knowledge/manifest.json` — **không** đọc cả `prefabs/` tree.

## Subsystems (manifest)

| Id | Phase bật | Agent dùng khi |
|----|-----------|----------------|
| `csharp` | 1 | Mọi task code |
| `scenes` | 3.1 | Scene/UI — digest on Save |
| `prefabs` | 2 | Enemy/boss/prefab content |
| `scriptables` | 6 | SO content — tracking ON + import |
| `references` | 4.1 | Tìm caller — `agent_find_references` trước Grep |

`fresh === false` → ưu tiên trigger refresh (compile đã chạy / bridge) trước khi Grep mò.

## Không làm

- Glob `Assets/**/*.cs` khi `agent_get_index_health.fresh` và code ladder đủ
- Read prefab `.prefab` YAML khi fingerprint có (Phase 2+)
- Read SO `.asset` YAML khi `agent_query_scriptable` có digest (Phase 6+)
- Grep call site khi `agent_find_references` fresh (Phase 4.1+)

## Liên kết

- Code map: [unity-code-map](../unity-code-map/SKILL.md)
- Scene map: [unity-scene-map](../unity-scene-map/SKILL.md)
- Navigation: [agent-codebase-navigation](../agent-codebase-navigation/SKILL.md)
