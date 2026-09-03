#!/usr/bin/env node
/**
 * Unity Agent MCP (cursor-agent-kit) — zero-build, Node 18+ ESM.
 * Env: AGENT_PROJECT_ROOT (preferred) or STRATEGY_PATHS_PROJECT_ROOT (legacy).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createUsageTracker, estimateTokens } from "./usage-tracker.mjs";
import { aggregateWeeklyUsage, formatWeeklyDashboard } from "./usage-aggregate.mjs";
import { appendEpisode, formatEpisodesText, readRecentEpisodes } from "./episode-log.mjs";
import {
  applyIndexDelta,
  buildCodebaseIndex,
  buildProjectIndex,
  discoverProject,
  readIndexStatusText,
  readModuleIndex,
  readProjectProfileText,
  readProjectSummary,
  readTypeOutline,
  findInModule,
} from "./codebase-index.mjs";
import { invokeBridgeBatch } from "./invoke-bridge-batch.mjs";
import {
  bridgeWaitMsForCommand,
  effectiveBatchTimeoutMs,
  summarizeIndexHealth,
} from "./bridge-slow-commands.mjs";
import {
  readToolProfileFile,
  writeToolProfileFile,
  getSuggestedTools,
  scaffoldToolProfile,
  checkToolAllowed,
} from "./tool-profile.mjs";
import {
  checkEntitlementAllowlist,
  filterToolsByEntitlement,
} from "./entitlement-allowlist.mjs";
import { readTaskHandoff, updateTaskHandoff } from "./task-handoff.mjs";
import {
  exportSkillBundle,
  importSkillBundle,
  listSkillBundles,
} from "./skill-exchange.mjs";
import {
  buildPackDigest,
  writeActivePacks,
  readActivePacks,
  scaffoldActivePacks,
} from "./domain-packs.mjs";
import { getUnitySubdomain } from "./unity-subdomain-lookup.mjs";
import { readManifestHealth, readPrefabFingerprint, auditPrefabFolder, readCanonicalSceneDigest, sceneSnapshotFromDigest, findReferences, getChangedSince, queryScriptable } from "./project-knowledge.mjs";
import { getModuleFlowEdges } from "./reference-flow-export.mjs";
import { runProjectScan } from "./project-scan.mjs";
import { validatePkeFreshness, formatFreshnessText } from "./pke-freshness.mjs";
import { syncMetricsStore, exportMetricsPath } from "./pke-metrics-store.mjs";
import { readPlaymodeErrors } from "./playmode-runtime.mjs";
import {
  verifyCompile,
  verifyPlaymode,
  runVerifyLoop,
  formatVerdictText,
} from "./verify-playmode.mjs";
import {
  listBuildScenesText,
  readBuildSceneIndex,
  querySceneIndex,
  readSceneAnchors,
  rebuildAnchorsFromIndexCache,
} from "./scene-build-index.mjs";
import {
  readCodeLayers,
  readModuleAnchors,
  buildModuleAnchors,
  readTypeDigest,
} from "./codebase-layers.mjs";
import { pathToFileURL } from "node:url";

/** Pro/Studio catalogs — present only when that pack’s MCP modules were installed. */
async function importCatalogIfPresent(relPath) {
  const full = path.join(path.dirname(fileURLToPath(import.meta.url)), relPath);
  if (!fs.existsSync(full)) return null;
  try {
    return await import(pathToFileURL(full).href);
  } catch (e) {
    console.error(`[unity-agent-mcp] optional catalog failed ${relPath}:`, e?.message || e);
    return null;
  }
}

const _catVfx = await importCatalogIfPresent("./vfx-catalog.mjs");
const _catVfxStorage = await importCatalogIfPresent("./vfx-storage.mjs");
const _catBuilder = await importCatalogIfPresent("./builder-catalog.mjs");
const _catSg = await importCatalogIfPresent("./shadergraph-catalog.mjs");
const _catFigma = await importCatalogIfPresent("./figma-ui.mjs");
const _catUiImage = await importCatalogIfPresent("./ui-image.mjs");
const _catBundleLeak = await importCatalogIfPresent("./bundleleak-catalog.mjs");

const VFX_TOOL_DEFS = _catVfx?.VFX_TOOL_DEFS || [];
const handleVfxTool = _catVfx?.handleVfxTool || (async () => null);
const storageToolDefinitions = _catVfxStorage?.storageToolDefinitions || [];
const handleVfxStorageTool = _catVfxStorage?.handleVfxStorageTool || (async () => null);
const BUILDER_TOOL_DEFS = _catBuilder?.BUILDER_TOOL_DEFS || [];
const handleBuilderTool = _catBuilder?.handleBuilderTool || (async () => null);
const SG_TOOL_DEFS = _catSg?.SG_TOOL_DEFS || [];
const handleSgTool = _catSg?.handleSgTool || (async () => null);
const FIGMA_TOOL_DEFS = _catFigma?.FIGMA_TOOL_DEFS || [];
const handleFigmaTool = _catFigma?.handleFigmaTool || (async () => null);
const UI_IMAGE_TOOL_DEFS = _catUiImage?.UI_IMAGE_TOOL_DEFS || [];
const handleUiImageTool = _catUiImage?.handleUiImageTool || (async () => null);
const BUNDLELEAK_TOOL_DEFS = _catBundleLeak?.BUNDLELEAK_TOOL_DEFS || [];
const handleBundleLeakTool = _catBundleLeak?.handleBundleLeakTool || (async () => null);

// Keep literal name: "..." here so registry validate (regex scan of index.mjs) sees VFX tools.
const _vfxValidateNameScan = [
  { name: "agent_vfx_index_status" },
  { name: "agent_vfx_search" },
  { name: "agent_vfx_get" },
  { name: "agent_vfx_usage" },
  { name: "agent_vfx_find_similar" },
  { name: "agent_vfx_audit" },
  { name: "agent_vfx_performance_audit" },
  { name: "agent_vfx_preview" },
  { name: "agent_vfx_select" },
  { name: "agent_vfx_patch" },
];
void _vfxValidateNameScan;

const _vfxStorageValidateNameScan = [
  { name: "agent_vfx_storage_status" },
  { name: "agent_vfx_storage_search" },
  { name: "agent_vfx_storage_get" },
  { name: "agent_vfx_storage_import" },
  { name: "agent_vfx_storage_remaster_status" },
];
void _vfxStorageValidateNameScan;

const _builderValidateNameScan = [
  { name: "agent_builder_status" },
  { name: "agent_builder_list" },
  { name: "agent_builder_get" },
  { name: "agent_builder_plan" },
  { name: "agent_builder_run" },
  { name: "agent_builder_validate" },
  { name: "agent_builder_history" },
  { name: "agent_builder_action_list" },
  { name: "agent_builder_action_run" },
];
void _builderValidateNameScan;

const _sgValidateNameScan = [
  { name: "agent_sg_index_status" },
  { name: "agent_sg_search" },
  { name: "agent_sg_get" },
  { name: "agent_sg_usage" },
  { name: "agent_sg_find_similar" },
  { name: "agent_sg_audit" },
  { name: "agent_sg_list_templates" },
  { name: "agent_sg_select" },
];
void _sgValidateNameScan;

const _figmaValidateNameScan = [
  { name: "agent_figma_status" },
  { name: "agent_figma_inspect" },
  { name: "agent_figma_export" },
];
void _figmaValidateNameScan;

const _uiImageValidateNameScan = [
  { name: "agent_ui_image_status" },
  { name: "agent_ui_image_analyze" },
  { name: "agent_ui_image_diff" },
];
void _uiImageValidateNameScan;

function resolveProjectRoot() {
  if (process.env.AGENT_PROJECT_ROOT) return path.resolve(process.env.AGENT_PROJECT_ROOT);
  if (process.env.STRATEGY_PATHS_PROJECT_ROOT) return path.resolve(process.env.STRATEGY_PATHS_PROJECT_ROOT);
  return process.cwd();
}

const projectRoot = resolveProjectRoot();

const bridgeRoot = path.join(projectRoot, ".cursor", "unity-bridge");
const requestsDir = path.join(bridgeRoot, "requests");
const responsesDir = path.join(bridgeRoot, "responses");
const usage = createUsageTracker(bridgeRoot);

const capabilitiesPath = path.join(projectRoot, ".cursor", "agent-capabilities.json");

const TOOLS = [
  {
    name: "agent_get_usage",
    description:
      "Token usage: MCP session + agent turn estimates. period=week → dashboard 2 tuần (grep/read/pke baseline).",
    inputSchema: {
      type: "object",
      properties: {
        lastN: { type: "number", description: "Số log gần nhất session (default 8)" },
        period: {
          type: "string",
          enum: ["session", "week"],
          description: "session=default; week=aggregate weekly dashboard",
        },
        weeks: { type: "number", description: "Số tuần gần nhất khi period=week (default 2)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_record_turn",
    description:
      "Ghi ước lượng token + discipline metrics 1 lượt agent. Gọi cuối task: taskType, pkeQueries, grepCount, readCount; episodeInsight → agent-episodes.jsonl.",
    inputSchema: {
      type: "object",
      properties: {
        userTextChars: { type: "number", description: "Độ dài tin user (chars)" },
        agentTextChars: { type: "number", description: "Độ dài reply agent (chars)" },
        mcpToolsUsed: { type: "number", description: "Số MCP tool đã gọi lượt này" },
        label: { type: "string", description: "Nhãn task ngắn" },
        taskType: {
          type: "string",
          enum: ["code", "scene", "ui", "meta", "debug", "other"],
          description: "Loại task — baseline dashboard",
        },
        pkeQueries: { type: "number", description: "Số PKE/MCP index query lượt này" },
        grepCount: { type: "number", description: "Số lần Grep tool lượt này" },
        readCount: { type: "number", description: "Số lần Read file lượt này" },
        episodeInsight: { type: "string", description: "ISR insight 1 dòng → agent-episodes.jsonl" },
        skillId: { type: "string", description: "Skill liên quan episode" },
      },
      required: ["agentTextChars"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_validate_registry",
    description:
      "Kiểm tra sync skill registry: json ↔ mdc ↔ skill files ↔ MCP tools ↔ bridge commands. Sau patch/register skill.",
    inputSchema: {
      type: "object",
      properties: {
        checkUnityBridge: {
          type: "boolean",
          description: "So khớp bridge commands với Unity (default false)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_set_tool_profile",
    description:
      "Đặt tool profile (scene|code|full). enforcement=strict chặn MCP ngoài profile (Phase 9.4).",
    inputSchema: {
      type: "object",
      properties: {
        profile: { type: "string", enum: ["scene", "code", "full"] },
        enforcement: { type: "string", enum: ["advisory", "strict"] },
        strict: { type: "boolean", description: "true → enforcement strict" },
      },
      required: ["profile"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_get_tool_profile",
    description: "Đọc tool profile + suggested tools; enforcement advisory|strict.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_validate_pke_freshness",
    description: "CI gate: manifest age < 24h + fresh flags (Phase 9.3).",
    inputSchema: {
      type: "object",
      properties: {
        maxAgeHours: { type: "number", description: "Default 24" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_export_pke_metrics",
    description: "Sync metrics store (SQLite optional) + JSON export (Phase 9.1).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_read_playmode_errors",
    description: "Đọc playmode Error/Exception index — runtime/playmode-errors.jsonl (Phase 9.5).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max entries (default 30)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_verify_compile",
    description:
      "Compile gate — assets_refresh + editor_state + console_errors (compileSession). Pillar 1 verify loop.",
    inputSchema: {
      type: "object",
      properties: {
        pathFilter: { type: "string", description: "Filter CS errors to path prefix" },
        maxPolls: { type: "number", description: "Max compile poll rounds (default 3)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_verify_playmode",
    description:
      "Play Mode smoke verify — playmode_session + optional capture. Uses .cursor/verify-config.json defaults.",
    inputSchema: {
      type: "object",
      properties: {
        scenePath: { type: "string", description: "Smoke scene (overrides verify-config)" },
        waitSec: { type: "number", description: "Seconds in Play Mode (default from config)" },
        capture: { type: "boolean", description: "Save Game View capture to .cursor/unity-bridge/captures/" },
        pathFilter: { type: "string", description: "Unused for playmode; compile-only if combined later" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_verify_feature",
    description:
      "Full verify loop: compile gate then playmode smoke (if smokeScene configured). Returns verdict JSON.",
    inputSchema: {
      type: "object",
      properties: {
        scenePath: { type: "string" },
        waitSec: { type: "number" },
        capture: { type: "boolean" },
        pathFilter: { type: "string" },
        maxPolls: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_read_task_handoff",
    description:
      "Đọc .cursor/task-handoff.json — resume task đa thiết bị/session. Universal, không cần Unity.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_export_skill_bundle",
    description:
      "Export portable skill bundle cho agent/repo khác. Universal — không export registry/core.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        artifactType: {
          type: "string",
          enum: ["pitfall", "pattern", "workflow", "mcp-tool", "governance"],
        },
        domainPack: { type: "string" },
        scopeRecommendation: { type: "string", enum: ["project", "universal"] },
        targetSkillHint: { type: "string" },
        skillSnippet: { type: "string" },
        pitfalls: { type: "array", items: { type: "string" } },
        workflowSteps: { type: "array", items: { type: "string" } },
        mcpHints: { type: "array", items: { type: "string" } },
        testChecklist: { type: "array", items: { type: "string" } },
        trustLevel: { type: "string", enum: ["internal", "external"] },
        sourceAgent: { type: "string" },
      },
      required: ["title", "artifactType"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_import_skill_bundle",
    description:
      "Preview import bundle — classify patch-project vs proposal-universal. action=queue để xếp hàng.",
    inputSchema: {
      type: "object",
      properties: {
        bundleId: { type: "string", description: "slug or id" },
        path: { type: "string", description: "Relative path to bundle json" },
        action: { type: "string", enum: ["preview", "queue"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_list_skill_bundles",
    description: "Liệt kê skill bundles trong .cursor/skill-exchange/bundles/",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_get_domain_pack",
    description:
      "Digest skill + MCP groups + rules theo domain pack (unity/web/general). Token-efficient — thay đọc full registry.",
    inputSchema: {
      type: "object",
      properties: {
        packId: { type: "string", description: "Optional — một pack; default merge active" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_get_unity_subdomain",
    description:
      "Match query → Unity subdomain, skillIds, bridge hint, depth — từ routing + unity-subdomains digest. Trước đọc full registry.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Task keywords e.g. SpawnRoom, URP texture, Addressables" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_set_active_domain_packs",
    description: "Ghi .cursor/active-domain-packs.json — pack bật cho repo (general luôn implicit).",
    inputSchema: {
      type: "object",
      properties: {
        packs: {
          type: "array",
          items: { type: "string" },
          description: "e.g. [\"unity\"] or [\"web\"]",
        },
      },
      required: ["packs"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_update_task_handoff",
    description:
      "Cập nhật task handoff cuối session. Universal — set domainPack unity|web|general.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        phase: { type: "string", enum: ["implement", "test", "blocked", "done"] },
        domainPack: { type: "string", description: "general | unity | web | …" },
        nextActions: { type: "array", items: { type: "string" } },
        touchedSkills: { type: "array", items: { type: "string" } },
        touchedFiles: { type: "array", items: { type: "string" } },
        blockers: { type: "array", items: { type: "string" } },
        machineHint: { type: "string" },
        appendNextAction: { type: "string" },
        appendTouchedFile: { type: "string" },
        appendBlocker: { type: "string" },
        clearTask: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_get_capabilities",
    description:
      "Registry tổng hợp skill + MCP + routing. Gọi đầu session Unity — KHÔNG list_dir .cursor. Trả digest JSON ngắn.",
    inputSchema: {
      type: "object",
      properties: {
        includeUnityBridge: {
          type: "boolean",
          description: "Merge bridge commands từ Unity (default true)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_list_build_scenes",
    description:
      "L0: scene trong Build Settings (offline, không Unity). Ghi build-scenes.json. Gọi đầu task scene multi-scene.",
    inputSchema: {
      type: "object",
      properties: {
        writeDisk: { type: "boolean", description: "Ghi manifest (default true)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_read_build_scene_index",
    description:
      "L1: đọc cache scene-index (local, 0 Unity). mode=manifest|digest|roots|full. Auto cập nhật khi Save scene.",
    inputSchema: {
      type: "object",
      properties: {
        sceneName: { type: "string", description: "Tên scene hoặc bỏ trống = manifest tất cả" },
        mode: {
          type: "string",
          enum: ["manifest", "digest", "roots", "full"],
          description: "manifest=overview, digest=stats+roles (default), roots, full",
        },
        maxNodes: { type: "number", description: "mode=full (default 60)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_read_scene_anchors",
    description:
      "L1.5: GO neo gameplay (Manager/Controller/…) — ~50–150 tok/scene. Ưu tiên TRƯỚC digest/full. Kèm purpose từ build-scene-registry.",
    inputSchema: {
      type: "object",
      properties: {
        sceneName: { type: "string", description: "Tên scene; bỏ trống = overview counts" },
        all: { type: "boolean", description: "Overview tất cả scene" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_rebuild_scene_anchors",
    description:
      "Offline: tạo scene-anchors từ cache scene-index (fallback). Unity refresh vẫn chính xác hơn (full scene scan).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_query_scene_index",
    description:
      "L2: tìm GO/component/role trong build scenes — PKE-first đọc .cursor/project-knowledge/scenes/ nếu có. Regex path hoặc filter component/role; anchorsOnly chỉ GO neo.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex (path mặc định)" },
        sceneName: { type: "string", description: "Giới hạn 1 scene" },
        searchIn: { type: "string", enum: ["path", "role", "component"] },
        component: { type: "string", description: "Substring component type" },
        role: { type: "string", description: "Substring role" },
        maxResults: { type: "number" },
        anchorsOnly: {
          type: "boolean",
          description: "Chỉ search digest.anchors (GO neo) — token thấp hơn",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_read_scene_snapshot",
    description:
      "Đọc scene-snapshot.json canonical (local). Multi-scene → agent_read_build_scene_index.",
    inputSchema: {
      type: "object",
      properties: {
        maxAgeMinutes: {
          type: "number",
          description: "Cảnh báo stale nếu snapshot cũ hơn N phút (default 120)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_scene_gap_report",
    description:
      "So snapshot vs scene-contract + visual target (mockup). Trả gap ngắn — dùng khi user gửi ảnh demo / check tiến độ UI.",
    inputSchema: {
      type: "object",
      properties: {
        visualTargetId: {
          type: "string",
          description: "ID trong scene-visual-targets/ (default portrait-wave-demo)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_project_scan",
    description:
      "Bundled scan: profile + index + layers + modules (+ top anchors if deep). Dùng đầu session hoặc onboard — thay nhiều MCP riêng lẻ.",
    inputSchema: {
      type: "object",
      properties: {
        depth: {
          type: "string",
          enum: ["shallow", "standard", "deep"],
          description: "shallow=profile; standard=+modules; deep=+top module anchors",
        },
        moduleLimit: { type: "number", description: "deep only — max modules (default 6)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_discover_project",
    description:
      "L0 quét nhanh Unity project: tự tìm Scripts roots, URP/packages, scenes — KHÔNG parse types. Rẻ, gọi đầu session code.",
    inputSchema: {
      type: "object",
      properties: {
        scriptsRoots: {
          type: "array",
          items: { type: "string" },
          description: "Override roots e.g. [\"Assets/MyGame/Scripts\"]",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_build_project_index",
    description:
      "Full scan: discover project + parse C# types → .cursor/codebase-index/. Dùng lần đầu hoặc refactor lớn.",
    inputSchema: {
      type: "object",
      properties: {
        scriptsRoots: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_build_codebase_index",
    description: "Alias agent_build_project_index (backward compat).",
    inputSchema: {
      type: "object",
      properties: {
        scriptsRoot: { type: "string" },
        scriptsRoots: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_read_project_profile",
    description: "L0 profile: tech stack, code roots, scenes, stale warning — trước L1 index.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_index_status",
    description: "Index stale? file diff since last build — sau Unity compile.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_get_index_health",
    description:
      "PKE health — status fresh/stale + manifest compact. Gọi đầu session code; stale → rebuild_code_index.",
    inputSchema: {
      type: "object",
      properties: {
        verbose: { type: "boolean", description: "Include prefab/scene counts (default false)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_find_references",
    description:
      "PKE reference index — type usage edges từ references.jsonl. direction=callers|callees|related (default related). Thay Grep caller/callee lookup.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "TypeName (vd SpawnOnDeadState, BattleManager)" },
        direction: {
          type: "string",
          enum: ["callers", "callees", "related"],
          description: "callers=toType→symbol; callees=symbol→toType; related=both (default)",
        },
        fromType: { type: "string", description: "Lọc theo enclosing type (optional)" },
        fromFile: { type: "string", description: "Lọc theo path substring (optional)" },
        method: { type: "string", description: "Legacy method filter — shard cache only (optional)" },
        limit: { type: "number", description: "Max results (default 24, max 48)" },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_get_module_flow_edges",
    description:
      "PKE flow-by-module — top outbound type edges per moduleId từ flow-by-module.json (Phase 4.5).",
    inputSchema: {
      type: "object",
      properties: {
        moduleId: { type: "string", description: "Module id từ codebase-index (vd GameMechanic.Battle)" },
        limit: { type: "number", description: "Max edges (default 16, max 32)" },
      },
      required: ["moduleId"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_get_changed_since",
    description:
      "PKE changelog — paths changed since timestamp (git-import batches). Gọi đầu session sau git pull.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "ISO timestamp (default 24h ago)" },
        reason: { type: "string", description: "Filter reason e.g. git-import" },
        limit: { type: "number", description: "Max entries (default 20, max 100)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_get_prefab_fingerprint",
    description:
      "PKE prefab digest — query by path OR guid (32 hex). Path falls back to prefabs index if .meta missing. Không Read YAML.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative prefab path, e.g. Assets/.../Boss.prefab" },
        guid: { type: "string", description: "32-hex Unity GUID (optional if path given)" },
        verbose: { type: "boolean", description: "Include childrenSummary, updatedAt, all missingRefs" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_query_scriptable",
    description:
      "PKE ScriptableObject digest — query by path, guid, or type (shortType). Không Read .asset YAML. SO tracking must be ON in Unity.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative .asset path" },
        guid: { type: "string", description: "32-hex Unity GUID (optional if path given)" },
        type: { type: "string", description: "shortType or full typeName match (max 24 hits)" },
        verbose: { type: "boolean", description: "Include full fields, projectFields paths, updatedAt" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_prefab_audit",
    description:
      "Scan PKE prefab fingerprints in folder — list prefabs with missing refs (offline, no Unity).",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Assets/... folder prefix to audit",
        },
        includeAll: {
          type: "boolean",
          description: "Include prefabs without missing refs (default false)",
        },
      },
      required: ["folder"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_apply_index_delta",
    description: "Incremental index: chỉ file mới/đổi (nhanh). Gọi khi status stale.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_read_project_index",
    description:
      "L1 tổng quan project: modules + type counts + project-map hints. Gọi TRƯỚC khi đọc .cs — rẻ.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_read_module_index",
    description: "L2 tổng quan 1 module: types, file, public API outline.",
    inputSchema: {
      type: "object",
      properties: {
        moduleId: { type: "string", description: "e.g. Grid, Path, GameFlow" },
        typeLimit: { type: "number", description: "Max types listed (default 40)" },
      },
      required: ["moduleId"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_read_type_outline",
    description: "L3 outline 1 class/interface — trước khi Read file .cs.",
    inputSchema: {
      type: "object",
      properties: {
        typeName: { type: "string" },
        moduleId: { type: "string", description: "Optional narrow search" },
      },
      required: ["typeName"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_read_code_layers",
    description: "L0 code tiers (game/framework/plugins) — ~150 tok. Đọc trước module index.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_read_module_anchors",
    description:
      "L1.5 types neo (Manager/Controller/…) + public API tóm tắt — không mở .cs.",
    inputSchema: {
      type: "object",
      properties: {
        moduleId: { type: "string", description: "e.g. GameMechanic or _DangerDungeon.GameMechanic" },
        layer: { type: "string", description: "game | framework — list modules in layer" },
        maxResults: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "agent_rebuild_module_anchors",
    description: "Offline: build module-anchors từ index hiện có. Sau apply_index_delta.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agent_read_type_digest",
    description: "L3 public methods của 1 class từ index — thay Read file khi chỉ cần API.",
    inputSchema: {
      type: "object",
      properties: {
        typeName: { type: "string" },
        moduleId: { type: "string" },
      },
      required: ["typeName"],
      additionalProperties: false,
    },
  },
  {
    name: "agent_find_in_module",
    description:
      "Tìm symbol/file trong phạm vi 1 module index — thay một phần Read full file.",
    inputSchema: {
      type: "object",
      properties: {
        moduleId: { type: "string" },
        pattern: { type: "string", description: "Regex" },
        searchIn: {
          type: "string",
          enum: ["members", "files", "content"],
          description: "members=index only (default), content=scoped file grep",
        },
        maxResults: { type: "number" },
      },
      required: ["moduleId", "pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "unity_ping",
    description: "Kiểm tra Unity bridge + scene đang mở. Gọi trước mọi task scene.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "unity_report_scene",
    description: "Báo cáo scene Strategy Paths (components, UI, contract).",
    inputSchema: {
      type: "object",
      properties: {
        scenePath: { type: "string", description: "Optional scene path" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "unity_inventory_scene",
    description:
      "Inventory scene: mọi GameObject + path + role + components. Dùng khi user hỏi scene có gì / chức năng từng object. Cần Unity Editor.",
    inputSchema: {
      type: "object",
      properties: {
        scenePath: { type: "string", description: "Optional scene path" },
        maxDepth: { type: "number", description: "Max hierarchy depth (default 32)" },
        includeInactive: { type: "boolean", description: "Include inactive GO (default true)" },
        summaryLimit: { type: "number", description: "Max entries in summary text (default 120)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "unity_report_project",
    description: "Báo cáo project: canonical scene, catalogs, bridge commands.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "unity_validate_scene",
    description: "Validate scene theo scene-contract.json.",
    inputSchema: {
      type: "object",
      properties: { scenePath: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "unity_write_snapshot",
    description: "Ghi scene-snapshot.json từ Unity Editor (sau sửa scene, trước khi agent đọc snapshot).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "unity_list_build_scenes",
    description: "Build Settings scenes từ Unity Editor. Ưu tiên agent_list_build_scenes (offline) khi không cần Editor.",
    inputSchema: {
      type: "object",
      properties: {
        writeDisk: { type: "boolean", description: "Ghi build-scenes.json (default true)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "unity_index_scene_hierarchy",
    description: "Index 1 scene → scene-index/{name}.json. Chỉ khi cache thiếu/stale.",
    inputSchema: {
      type: "object",
      properties: {
        scenePath: { type: "string" },
        maxDepth: { type: "number" },
        maxNodes: { type: "number" },
        includeInactive: { type: "boolean" },
        writeDisk: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "unity_refresh_build_scene_index",
    description:
      "Index tất cả enabled build scenes (mở lần lượt). Chạy 1 lần sau onboard — sau đó rely auto-save.",
    inputSchema: {
      type: "object",
      properties: {
        maxDepth: { type: "number" },
        maxNodes: { type: "number" },
        includeInactive: { type: "boolean" },
        restoreScene: { type: "boolean", description: "Restore scene sau batch (default true)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "unity_list_scenes",
    description: "Liệt kê scene assets trong project (Unity Editor). Dùng trước report_scene khi chưa biết path.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Folder prefix, default Assets/" },
        limit: { type: "number", description: "Max scenes returned (default 50)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "unity_bridge_batch",
    description:
      "Gọi nhiều bridge commands trong 1 round-trip (≤16). Dùng khi ≥2 lệnh bridge cùng turn. PKE stale: [{command:'rebuild_code_index'}] với timeoutMs:120000; chuỗi ping→rebuild_code_index→…",
    inputSchema: {
      type: "object",
      properties: {
        commands: {
          type: "array",
          items: {
            type: "object",
            properties: {
              command: { type: "string" },
              args: { type: "object" },
            },
            required: ["command"],
          },
        },
        timeoutMs: { type: "number", description: "Default 60000" },
        maxCommands: { type: "number", description: "Default 16" },
      },
      required: ["commands"],
      additionalProperties: false,
    },
  },
  {
    name: "unity_bridge_invoke",
    description:
      "Gọi lệnh bridge tùy chỉnh (command + args). PKE stale → rebuild_code_index (sau agent_get_index_health).",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  ...VFX_TOOL_DEFS,
  ...storageToolDefinitions,
  ...BUILDER_TOOL_DEFS,
  ...SG_TOOL_DEFS,
  ...FIGMA_TOOL_DEFS,
  ...UI_IMAGE_TOOL_DEFS,
  ...BUNDLELEAK_TOOL_DEFS,
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function ensureDirs() {
  fs.mkdirSync(requestsDir, { recursive: true });
  fs.mkdirSync(responsesDir, { recursive: true });
}

function findUnity() {
  if (process.env.UNITY_EDITOR_PATH && fs.existsSync(process.env.UNITY_EDITOR_PATH))
    return process.env.UNITY_EDITOR_PATH;
  for (const c of [
    "D:\\setupUnity\\6000.3.13f1\\Editor\\Unity.exe",
    "D:\\setupUnity\\6000.3.12f1\\Editor\\Unity.exe",
  ]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function waitForFile(filePath, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (fs.existsSync(filePath)) {
        try {
          resolve(JSON.parse(fs.readFileSync(filePath, "utf8")));
          return;
        } catch {
          resolve(null);
          return;
        }
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(tick, 120);
    };
    tick();
  });
}

function runBatch() {
  const unity = findUnity();
  if (!unity) return false;
  const r = spawnSync(
    unity,
    [
      "-batchmode",
      "-nographics",
      "-quit",
      "-projectPath",
      projectRoot,
      "-executeMethod",
      getBatchExecuteMethod(),
      "-logFile",
      path.join(bridgeRoot, "last-batch.log"),
    ],
    { timeout: 120000, encoding: "utf8" }
  );
  return r.status === 0 || r.status === null;
}

async function invokeBridge(command, args = {}) {
  ensureDirs();
  const id = randomUUID();
  const requestPath = path.join(requestsDir, `${id}.json`);
  const responsePath = path.join(responsesDir, `${id}.json`);
  fs.writeFileSync(
    requestPath,
    JSON.stringify({ id, command, args }, null, 2),
    "utf8"
  );

  let response = await waitForFile(responsePath, bridgeWaitMsForCommand(command));
  if (!response) {
    runBatch();
    response = await waitForFile(responsePath, bridgeWaitMsForCommand(command));
  }
  if (!response) {
    throw new Error(
      `Unity bridge timeout (${command}). Mở Unity Editor hoặc set UNITY_EDITOR_PATH.`
    );
  }
  return response;
}

function summarize(response, options = {}) {
  const lines = [`ok=${response.ok} command=${response.command}`];
  if (response.error) lines.push(`error: ${response.error}`);
  const d = response.data || {};
  if (d.mode) lines.push(`mode=${d.mode} elapsedMs=${d.elapsedMs ?? "?"}`);
  if (d.ping) {
    lines.push(`activeScene=${d.ping.activeScene}`);
    lines.push(`strategyPathsInstalled=${d.ping.strategyPathsInstalled}`);
  }
  if (d.scene) {
    const s = d.scene;
    lines.push(`scene=${s.scenePath} loaded=${s.isLoaded} layout=${s.layoutMode}`);
    lines.push(`roots=${JSON.stringify(s.rootObjects || [])}`);
    const missing = [
      ...(s.missingRequiredComponents || []),
      ...(s.missingRequiredUiPanels || []),
    ];
    if (missing.length) lines.push(`missing=${JSON.stringify(missing)}`);
    if (s.uiPanels) lines.push(`uiPanels=${JSON.stringify(s.uiPanels)}`);
  }
  if (d.project) {
    lines.push(`canonicalScene=${d.project.canonicalScene}`);
    if (d.project.bridgeCommands)
      lines.push(`bridgeCommands=${JSON.stringify(d.project.bridgeCommands)}`);
  }
  if (d.validateScene) {
    lines.push(`validate.passed=${d.validateScene.passed}`);
    if (d.validateScene.issues?.length)
      lines.push(`issues=${JSON.stringify(d.validateScene.issues)}`);
  }
  if (d.sceneInventory) {
    lines.push(summarizeInventory(d.sceneInventory, options.summaryLimit ?? 120));
  }
  if (d.sceneSnapshot) {
    const s = d.sceneSnapshot;
    lines.push(
      `snapshot written scene=${s.scenePath} layout=${s.layoutMode} totalGO=${s.totalGameObjects} savedAt=${s.savedAt}`
    );
  }
  if (d.sceneList) {
    lines.push(`sceneList filter=${d.sceneList.filter} total=${d.sceneList.total}`);
    for (const s of (d.sceneList.scenes || []).slice(0, 30)) {
      lines.push(`  ${s.path}`);
    }
    if ((d.sceneList.scenes || []).length > 30) {
      lines.push(`  ... +${d.sceneList.scenes.length - 30} more`);
    }
  }
  if (d.buildScenes) {
    const b = d.buildScenes;
    lines.push(`buildScenes enabled=${(b.enabled || []).length} disabled=${(b.disabled || []).length}`);
    for (const s of (b.enabled || []).slice(0, 20)) {
      lines.push(`  [${s.index}] ${s.name} → ${s.path}`);
    }
  }
  if (d.sceneHierarchyIndex) {
    const h = d.sceneHierarchyIndex;
    lines.push(
      `hierarchyIndex scene=${h.scenePath} total=${h.stats?.total} indexed=${h.stats?.indexed} truncated=${h.stats?.truncated}`
    );
    lines.push(`roots=${JSON.stringify(h.roots || [])}`);
    for (const n of (h.nodes || []).slice(0, 40)) {
      const comps = n.c?.length ? ` [${n.c.slice(0, 3).join(", ")}]` : "";
      lines.push(`  ${n.p} | ${n.r}${comps}`);
    }
    if ((h.nodes || []).length > 40) lines.push(`  ... +${h.nodes.length - 40} more`);
  }
  if (d.refreshBuildSceneIndex) {
    const r = d.refreshBuildSceneIndex;
    lines.push(`refreshIndex refreshed=${r.refreshed} skipped=${r.skipped} restored=${r.restoredScene}`);
    for (const p of (r.written || []).slice(0, 12)) lines.push(`  wrote ${p}`);
  }
  if (d.agentChat) {
    const c = d.agentChat;
    lines.push(
      `agentChat pending=${c.pendingCount ?? 0} unread=${c.unreadCount ?? 0} consoleOpen=${c.consoleOpen}`
    );
    if (c.ackedCount != null) lines.push(`acked=${c.ackedCount}`);
    if (c.messagesPath) lines.push(`messagesPath=${c.messagesPath}`);
    for (const m of (c.messages || []).slice(0, 20)) {
      lines.push(`  [${m.role}] ${m.text}`);
    }
  }
  if (d.indexHealth) {
    const ih = summarizeIndexHealth(d.indexHealth);
    if (ih) lines.push(ih);
  }
  return lines.join("\n");
}

function summarizeInventory(inv, limit = 120) {
  const lines = [
    `inventory scene=${inv.scenePath ?? inv.sceneName} loaded=${inv.isLoaded}`,
    `counts total=${inv.totalGameObjects ?? 0} active=${inv.activeGameObjects ?? 0} inactive=${inv.inactiveGameObjects ?? 0}`,
    `roots=${JSON.stringify(inv.rootObjects || [])}`,
    "--- gameObjects (path | active | role) ---",
  ];
  const entries = inv.entries || [];
  const show = entries.slice(0, limit);
  for (const e of show) {
    const act = e.active ? "on" : "off";
    const comps =
      e.keyComponents?.length ? ` [${e.keyComponents.slice(0, 4).join(", ")}]` : "";
    lines.push(`${e.path} | ${act} | ${e.role}${comps}`);
  }
  if (entries.length > limit) {
    lines.push(`... +${entries.length - limit} more in raw JSON`);
  }
  return lines.join("\n");
}

const sceneSnapshotPath = () => path.join(bridgeRoot, "scene-snapshot.json");

function readSceneSnapshot(maxAgeMinutes = 120) {
  const pkeDigest = readCanonicalSceneDigest(projectRoot);
  const pkeSnap = pkeDigest ? sceneSnapshotFromDigest(pkeDigest) : null;

  let snap = pkeSnap;
  let source = "pke";

  if (!snap) {
    const p = sceneSnapshotPath();
    if (!fs.existsSync(p)) {
      return {
        content: [
          {
            type: "text",
            text:
              "snapshot missing\n" +
              "→ Save canonical scene in Unity, or unity_bridge_invoke write_snapshot",
          },
        ],
        isError: true,
      };
    }
    snap = JSON.parse(fs.readFileSync(p, "utf8"));
    source = "legacy";
  }

  const savedMs = snap.savedAt ? Date.parse(snap.savedAt) : 0;
  const stale = savedMs > 0 && Date.now() - savedMs > maxAgeMinutes * 60 * 1000;
  const lines = [
    `snapshot source=${source} savedAt=${snap.savedAt ?? "?"} stale=${stale}`,
    `scene=${snap.scenePath} layout=${snap.layoutMode} totalGO=${snap.totalGameObjects ?? "?"}`,
    `roots=${JSON.stringify(snap.roots || [])}`,
    `uiPanels=${JSON.stringify(snap.uiPanels || [])}`,
    `components=${(snap.components || []).map((c) => c.type).join(", ") || "(none)"}`,
  ];
  if (snap.missingRequiredComponents?.length)
    lines.push(`missingComponents=${JSON.stringify(snap.missingRequiredComponents)}`);
  if (snap.missingRequiredUiPanels?.length)
    lines.push(`missingUi=${JSON.stringify(snap.missingRequiredUiPanels)}`);
  lines.push("--- hierarchy (depth≤2, compact) ---");
  for (const n of (snap.hierarchySummary || []).slice(0, 40)) {
    lines.push(`${n.path} | ${n.role}`);
  }
  if (stale) lines.push("WARN: snapshot stale — Save scene or write_snapshot before big changes");
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: false,
  };
}

function sceneGapReport(visualTargetId = "portrait-wave-demo") {
  const p = sceneSnapshotPath();
  const snap = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
  const contract = JSON.parse(
    fs.readFileSync(path.join(bridgeRoot, "scene-contract.json"), "utf8")
  );
  const targetPath = path.join(bridgeRoot, "scene-visual-targets", `${visualTargetId}.json`);
  const target = fs.existsSync(targetPath)
    ? JSON.parse(fs.readFileSync(targetPath, "utf8"))
    : null;
  const gaps = [];
  if (!snap) gaps.push("no snapshot — Save Game.unity or write_snapshot");
  else {
    for (const c of contract.requiredComponents || []) {
      const found = (snap.components || []).some((x) => x.type === c);
      if (!found) gaps.push(`contract: missing component ${c}`);
    }
    for (const panel of contract.requiredUiPanels || []) {
      if (!(snap.uiPanels || []).includes(panel))
        gaps.push(`contract: missing ui panel ${panel}`);
    }
    if (contract.layout && snap.layoutMode !== contract.layout)
      gaps.push(`layout now=${snap.layoutMode} want=${contract.layout}`);
  }
  if (target) {
    for (const c of target.requiredComponents || []) {
      if (snap && !(snap.components || []).some((x) => x.type === c))
        gaps.push(`target: missing component ${c}`);
    }
    for (const panel of target.requiredUiPanels || []) {
      if (snap && !(snap.uiPanels || []).includes(panel))
        gaps.push(`target: missing ui panel ${panel}`);
    }
    if (target.layout && snap && snap.layoutMode !== target.layout)
      gaps.push(`target layout: now=${snap.layoutMode} want=${target.layout}`);
  }
  const ok = gaps.length === 0;
  const text =
    `gap_report target=${visualTargetId} ok=${ok} count=${gaps.length}\n` +
    (gaps.length ? gaps.map((g) => `- ${g}`).join("\n") : "scene matches contract + visual target");
  return { content: [{ type: "text", text }], isError: !ok };
}

function loadStaticCapabilities() {
  if (!fs.existsSync(capabilitiesPath)) {
    return { error: "missing .cursor/agent-capabilities.json" };
  }
  return JSON.parse(fs.readFileSync(capabilitiesPath, "utf8"));
}

const DEFAULT_BATCH_EXECUTE_METHOD =
  "CursorAgentKit.Editor.AgentBridge.AgentBridgeBatchEntry.ProcessOnce";

function getBatchExecuteMethod() {
  const cap = loadStaticCapabilities();
  if (cap?.error) return DEFAULT_BATCH_EXECUTE_METHOD;
  return cap.unityBridge?.batchExecuteMethod || DEFAULT_BATCH_EXECUTE_METHOD;
}

function buildCapabilitiesDigest(staticCap, bridgeDynamic) {
  const skillIds = (staticCap.skills || []).map((s) => ({
    id: s.id,
    scope: s.scope,
    domain: s.domain,
    subdomain: s.subdomain,
    when: s.when,
  }));
  const mcpTools = (staticCap.mcp?.tools || []).map((t) => ({
    name: t.name,
    group: t.group,
    domain: t.domain,
    when: t.when,
  }));
  const mcpGroups = (staticCap.mcp?.toolGroups || []).map((g) => ({
    id: g.id,
    domain: g.domain,
    tools: g.tools,
  }));
  const routing = (staticCap.routing || []).map((r) => ({
    task: r.task,
    domain: r.domain,
    skills: r.skills,
    mcpFirst: r.mcpFirst,
  }));
  const digest = {
    version: staticCap.version,
    project: staticCap.project,
    layout: staticCap.layout,
    canonicalScene: staticCap.canonicalScene,
    taxonomy: staticCap.taxonomy
      ? {
          scopes: (staticCap.taxonomy.scopes || []).map((s) => s.id),
          domains: (staticCap.taxonomy.domains || []).map((d) => d.id),
        }
      : null,
    skills: skillIds,
    mcpToolGroups: mcpGroups,
    mcpTools,
    routing,
    workflows: staticCap.workflows,
    bridgeCommands:
      bridgeDynamic?.capabilities?.bridgeCommands ||
      staticCap.unityBridge?.commands ||
      [],
    bridgeVersion:
      bridgeDynamic?.capabilities?.bridgeVersion ??
      staticCap.unityBridge?.bridgeVersion,
    toolProfile: getSuggestedTools(staticCap, readToolProfileFile(projectRoot)),
    domainPacks: (() => {
      try {
        const dp = buildPackDigest(projectRoot);
        if (!dp.ok) return null;
        return {
          active: dp.active,
          skills: dp.skills,
          mcpToolGroups: dp.mcpToolGroups,
          rules: dp.rules,
        };
      } catch {
        return null;
      }
    })(),
  };
  return digest;
}

function subdomainExists(taxonomy, domainId, subdomainId) {
  const domain = (taxonomy?.domains || []).find((d) => d.id === domainId);
  if (!domain) return false;
  return (domain.subdomains || []).some((s) => s.id === subdomainId);
}

function validateTaxonomy(cap, issues) {
  if (!cap.taxonomy?.domains?.length) {
    issues.push("missing taxonomy.domains[]");
    return;
  }

  const scopeIds = new Set((cap.taxonomy.scopes || []).map((s) => s.id));
  if (!scopeIds.has("universal") || !scopeIds.has("project")) {
    issues.push("taxonomy.scopes must include universal and project");
  }

  for (const skill of cap.skills || []) {
    if (!skill.scope) issues.push(`skill missing scope: ${skill.id}`);
    if (!skill.domain) issues.push(`skill missing domain: ${skill.id}`);
    if (!skill.subdomain) issues.push(`skill missing subdomain: ${skill.id}`);
    if (skill.scope && !scopeIds.has(skill.scope)) {
      issues.push(`skill invalid scope: ${skill.id} → ${skill.scope}`);
    }
    if (skill.domain && skill.subdomain && !subdomainExists(cap.taxonomy, skill.domain, skill.subdomain)) {
      issues.push(`skill invalid subdomain: ${skill.id} → ${skill.domain}/${skill.subdomain}`);
    }
  }

  const toolNames = new Set((cap.mcp?.tools || []).map((t) => t.name));
  const grouped = new Set();
  for (const group of cap.mcp?.toolGroups || []) {
    for (const name of group.tools || []) {
      if (!toolNames.has(name)) issues.push(`toolGroups references unknown tool: ${name}`);
      if (grouped.has(name)) issues.push(`tool in multiple groups: ${name}`);
      grouped.add(name);
    }
  }
  for (const tool of cap.mcp?.tools || []) {
    if (!tool.group) issues.push(`mcp tool missing group: ${tool.name}`);
    if (!grouped.has(tool.name)) issues.push(`mcp tool not in any toolGroup: ${tool.name}`);
  }

  if (!cap.skillLifecycle?.registrySkill) {
    issues.push("skillLifecycle missing registrySkill");
  }

  if (!cap.skillClassification?.artifactTypes?.length) {
    issues.push("missing skillClassification.artifactTypes[]");
  }

  if (!cap.skillQuality?.incrementalReview?.logFile) {
    issues.push("missing skillQuality.incrementalReview.logFile");
  } else {
    const logPath = path.join(projectRoot, cap.skillQuality.incrementalReview.logFile.replace(/\//g, path.sep));
    if (!fs.existsSync(logPath)) issues.push(`missing ${cap.skillQuality.incrementalReview.logFile}`);
  }

  const registeredSkillIds = new Set((cap.skills || []).map((s) => s.id));
  const roleIds = new Set((cap.skillQuality?.skillRoles || []).map((r) => r.id));
  for (const role of cap.skillQuality?.skillRoles || []) {
    if (!registeredSkillIds.has(role.id)) {
      issues.push(`skillQuality.skillRoles references unknown skill: ${role.id}`);
    }
  }
  for (const skill of cap.skills || []) {
    if (!roleIds.has(skill.id)) {
      issues.push(`skill missing skillRoles entry: ${skill.id}`);
    }
  }
}

const __mcpDir = path.dirname(fileURLToPath(import.meta.url));

function extractMcpToolNamesFromIndex() {
  const files = [
    "index.mjs",
    "vfx-catalog.mjs",
    "vfx-storage.mjs",
    "builder-catalog.mjs",
    "shadergraph-catalog.mjs",
    "figma-ui.mjs",
    "ui-image.mjs",
    "bundleleak-catalog.mjs",
  ];
  const names = [];
  const re = /name:\s*"([^"]+)"/g;
  for (const file of files) {
    const indexPath = path.join(__mcpDir, file);
    if (!fs.existsSync(indexPath)) continue;
    const src = fs.readFileSync(indexPath, "utf8");
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[1] && !names.includes(m[1])) names.push(m[1]);
    }
  }
  return names.filter((n) => n.startsWith("agent_") || n.startsWith("unity_"));
}

async function validateRegistry(checkUnityBridge = false) {
  const issues = [];
  const cap = loadStaticCapabilities();
  if (cap.error) {
    issues.push(cap.error);
    return formatValidateResult(issues);
  }

  const mdcPath = path.join(projectRoot, ".cursor", "rules", "agent-capabilities.mdc");
  const changelogPath = path.join(projectRoot, ".cursor", "skill-registry-changelog.md");
  const templatePath = path.join(projectRoot, ".cursor", "skills", "_template", "SKILL.md");

  if (!fs.existsSync(changelogPath))
    issues.push("missing .cursor/skill-registry-changelog.md");
  if (!fs.existsSync(templatePath))
    issues.push("missing .cursor/skills/_template/SKILL.md");

  const skillIds = [];
  for (const s of cap.skills || []) {
    skillIds.push(s.id);
    const skillFile = path.join(projectRoot, s.file.replace(/\//g, path.sep));
    if (!fs.existsSync(skillFile)) issues.push(`skill file missing: ${s.file}`);
  }

  if (fs.existsSync(mdcPath)) {
    const mdc = fs.readFileSync(mdcPath, "utf8");
    for (const s of cap.skills || []) {
      if (s.scope === "universal" && !mdc.includes(`\`${s.id}\``)) {
        issues.push(`mdc digest missing universal skill id: ${s.id}`);
      }
    }
  } else {
    issues.push("missing .cursor/rules/agent-capabilities.mdc");
  }

  const jsonToolNames = (cap.mcp?.tools || []).map((t) => t.name).sort();
  const indexToolNames = extractMcpToolNamesFromIndex().sort();
  for (const t of jsonToolNames) {
    if (!indexToolNames.includes(t)) issues.push(`mcp tool in json but not index.mjs: ${t}`);
  }
  for (const t of indexToolNames) {
    if (!jsonToolNames.includes(t)) issues.push(`mcp tool in index.mjs but not json: ${t}`);
  }

  const jsonBridge = [...(cap.unityBridge?.commands || [])].sort();
  if (checkUnityBridge) {
    try {
      const br = await invokeBridge("report_capabilities", {});
      const live = [...(br.data?.capabilities?.bridgeCommands || [])].sort();
      for (const c of jsonBridge) {
        if (!live.includes(c)) issues.push(`bridge command in json but not Unity: ${c}`);
      }
      for (const c of live) {
        if (!jsonBridge.includes(c)) issues.push(`bridge command in Unity but not json: ${c}`);
      }
    } catch (e) {
      issues.push(`unity bridge check skipped: ${e.message}`);
    }
  }

  if (!cap.skillLifecycle?.changelog)
    issues.push("agent-capabilities.json missing skillLifecycle.changelog");

  validateTaxonomy(cap, issues);

  return formatValidateResult(issues);
}

function formatValidateResult(issues) {
  const ok = issues.length === 0;
  const text =
    `validate_registry ok=${ok}\n` +
    (issues.length ? `issues:\n- ${issues.join("\n- ")}` : "all sync checks passed");
  return {
    content: [{ type: "text", text }],
    isError: !ok,
  };
}

async function getCapabilities(includeUnityBridge = true) {
  const staticCap = loadStaticCapabilities();
  let bridgeDynamic = null;
  if (includeUnityBridge) {
    try {
      bridgeDynamic = await invokeBridge("report_capabilities", {});
    } catch {
      bridgeDynamic = null;
    }
  }
  const digest = buildCapabilitiesDigest(staticCap, bridgeDynamic);
  const text =
    `capabilities v${digest.version} | ${digest.project} | ${digest.layout}\n` +
    `domains: ${(digest.taxonomy?.domains || []).join(", ")}\n` +
    `skills: ${digest.skills.map((s) => `${s.id}(${s.domain})`).join(", ")}\n` +
    `mcp groups: ${(digest.mcpToolGroups || []).map((g) => g.id).join(", ")}\n` +
    `bridge: ${(digest.bridgeCommands || []).join(", ")}\n` +
    `routing: ${digest.routing.map((r) => r.task).join(" | ")}\n` +
    `\n--- digest json ---\n${JSON.stringify(digest, null, 2)}`;
  return {
    content: [{ type: "text", text }],
    isError: !!staticCap.error,
  };
}

function recordAgentTurn(args) {
  const agentChars = args?.agentTextChars ?? 0;
  const userChars = args?.userTextChars ?? 0;
  const entry = {
    ts: new Date().toISOString(),
    type: "agent_turn",
    label: args?.label ?? "turn",
    taskType: args?.taskType ?? "other",
    userTokensEst: estimateTokens(" ".repeat(Math.max(0, userChars))),
    agentTokensEst: estimateTokens(" ".repeat(Math.max(0, agentChars))),
    mcpToolsUsed: args?.mcpToolsUsed ?? 0,
    pkeQueries: args?.pkeQueries ?? 0,
    grepCount: args?.grepCount ?? 0,
    readCount: args?.readCount ?? 0,
  };
  entry.totalTokensEst = entry.userTokensEst + entry.agentTokensEst;
  const turnLog = path.join(bridgeRoot, "usage", "agent-turns.jsonl");
  fs.mkdirSync(path.dirname(turnLog), { recursive: true });
  fs.appendFileSync(turnLog, JSON.stringify(entry) + "\n", "utf8");

  let episodeNote = "";
  if (args?.episodeInsight && String(args.episodeInsight).trim()) {
    const ep = appendEpisode(projectRoot, {
      insight: args.episodeInsight,
      skillId: args.skillId,
      taskType: entry.taskType,
      label: entry.label,
      pkeQueries: entry.pkeQueries,
      grepCount: entry.grepCount,
      readCount: entry.readCount,
      source: "isr",
    });
    if (ep.ok) episodeNote = "\nepisode=appended agent-episodes.jsonl";
  }

  const text =
    `turn ~${entry.totalTokensEst} tokens (est.)\n` +
    `  user ~${entry.userTokensEst} | agent ~${entry.agentTokensEst} | mcp ${entry.mcpToolsUsed}\n` +
    `  taskType=${entry.taskType} pke=${entry.pkeQueries} grep=${entry.grepCount} read=${entry.readCount}${episodeNote}\n` +
    usage.formatReport(3);
  return {
    content: [{ type: "text", text }],
    isError: false,
  };
}

function getUsageReport(args = {}) {
  const lastN = args?.lastN ?? 8;
  const period = args?.period ?? "session";

  if (period === "week") {
    const agg = aggregateWeeklyUsage(projectRoot, { weeks: args?.weeks ?? 2 });
    const episodes = readRecentEpisodes(projectRoot, 5);
    const text =
      formatWeeklyDashboard(agg) +
      "\n\n" +
      formatEpisodesText(episodes) +
      "\n\n" +
      usage.formatReport(5);
    return {
      content: [{ type: "text", text }],
      isError: false,
    };
  }

  const turnLog = path.join(bridgeRoot, "usage", "agent-turns.jsonl");
  let turnLines = [];
  if (fs.existsSync(turnLog)) {
    turnLines = fs
      .readFileSync(turnLog, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-lastN)
      .map((l) => JSON.parse(l));
  }
  let turnTotal = 0;
  for (const t of turnLines) turnTotal += t.totalTokensEst ?? 0;

  const text =
    usage.formatReport(lastN) +
    `\n\nAgent turns (est., last ${turnLines.length}): ~${turnTotal} tokens` +
    (turnLines.length
      ? "\n" +
        turnLines
          .map(
            (t) =>
              `  ${t.label}: ~${t.totalTokensEst} [${t.taskType ?? "?"}] pke=${t.pkeQueries ?? 0} grep=${t.grepCount ?? 0} read=${t.readCount ?? 0}`
          )
          .join("\n")
      : "");
  return {
    content: [{ type: "text", text }],
    isError: false,
  };
}

async function handleToolCall(name, args) {
  const t0 = Date.now();
  let result;

  const ent = checkEntitlementAllowlist(projectRoot, name);
  if (!ent.allowed) {
    return {
      content: [
        {
          type: "text",
          text:
            `${ent.message}\n` +
            `allowedToolsSample: ${(ent.tools ?? []).slice(0, 24).join(", ")}${(ent.tools?.length ?? 0) > 24 ? "…" : ""}\n` +
            `→ sync-entitled.ps1 / upgrade pack / set mcp-allowlist enforcement=advisory`,
        },
      ],
      isError: true,
    };
  }

  const cap = loadStaticCapabilities();
  const profileData = readToolProfileFile(projectRoot);
  const allow = checkToolAllowed(name, cap.error ? {} : cap, profileData);
  if (!allow.allowed) {
    return {
      content: [
        {
          type: "text",
          text:
            `${allow.message}\n` +
            `suggestedTools: ${(allow.suggestedTools ?? []).join(", ")}\n` +
            `→ agent_set_tool_profile profile=full hoặc enforcement=advisory`,
        },
      ],
      isError: true,
    };
  }

  if (name === "agent_get_usage") {
    result = getUsageReport(args ?? {});
  } else if (name === "agent_record_turn") {
    result = recordAgentTurn(args);
  } else if (name === "agent_get_capabilities") {
    result = await getCapabilities(args?.includeUnityBridge !== false);
  } else if (name === "agent_list_build_scenes") {
    const r = listBuildScenesText(projectRoot, args?.writeDisk !== false);
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_read_build_scene_index") {
    const r = readBuildSceneIndex(projectRoot, {
      sceneName: args?.sceneName,
      mode: args?.mode ?? (args?.sceneName ? "digest" : "manifest"),
      maxNodes: args?.maxNodes ?? 60,
    });
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_read_scene_anchors") {
    const r = readSceneAnchors(projectRoot, {
      sceneName: args?.sceneName,
      all: args?.all === true,
    });
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_rebuild_scene_anchors") {
    const written = rebuildAnchorsFromIndexCache(projectRoot);
    result = {
      content: [
        {
          type: "text",
          text:
            `rebuild_scene_anchors ok scenes=${written.length}\n` +
            written.map((w) => `  ${w.scene}: ${w.count} anchors`).join("\n") +
            "\n→ agent_read_scene_anchors sceneName=Login",
        },
      ],
      isError: false,
    };
  } else if (name === "agent_query_scene_index") {
    const r = querySceneIndex(projectRoot, args ?? {});
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_read_scene_snapshot") {
    result = readSceneSnapshot(args?.maxAgeMinutes ?? 120);
  } else if (name === "agent_scene_gap_report") {
    result = sceneGapReport(args?.visualTargetId ?? "portrait-wave-demo");
  } else if (name === "agent_project_scan") {
    try {
      const r = runProjectScan(projectRoot, {
        depth: args?.depth ?? "standard",
        moduleLimit: args?.moduleLimit,
      });
      result = {
        content: [{ type: "text", text: r.text }],
        isError: r.isError === true,
      };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_discover_project") {
    const opts = {};
    if (args?.scriptsRoots) opts.scriptsRoots = args.scriptsRoots;
    const profile = discoverProject(projectRoot, opts);
    const r = readProjectProfileText(projectRoot);
    result = {
      content: [
        {
          type: "text",
          text:
            `discover ok roots=${profile.codeRoots.length} unity=${profile.unityVersion}\n` +
            r.text,
        },
      ],
      isError: false,
    };
  } else if (name === "agent_build_project_index" || name === "agent_build_codebase_index") {
    try {
      const opts = {};
      if (args?.scriptsRoot) opts.scriptsRoots = [args.scriptsRoot];
      if (args?.scriptsRoots) opts.scriptsRoots = args.scriptsRoots;
      const out = buildProjectIndex(projectRoot, opts);
      result = {
        content: [
          {
            type: "text",
            text:
              `project index built\nfiles=${out.summary.stats.files} types=${out.summary.stats.types} modules=${out.summary.stats.modules}\nroots=${out.summary.codeRoots.map((r) => r.path).join(", ")}\n→ agent_read_project_profile / agent_read_project_index`,
          },
        ],
        isError: false,
      };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_read_project_profile") {
    const r = readProjectProfileText(projectRoot);
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_index_status") {
    const r = readIndexStatusText(projectRoot);
    result = { content: [{ type: "text", text: r.text }], isError: false };
  } else if (name === "agent_get_index_health") {
    const r = readManifestHealth(projectRoot, { verbose: args?.verbose === true });
    const blocks = [{ type: "text", text: r.text }];
    if (r.compact) {
      blocks.push({ type: "text", text: `--- compact ---\n${JSON.stringify(r.compact)}` });
    }
    result = { content: blocks, isError: r.isError };
  } else if (name === "agent_find_references") {
    if (!args?.symbol) {
      result = {
        content: [{ type: "text", text: "status=error\nsymbol required" }],
        isError: true,
      };
    } else {
      const r = findReferences(projectRoot, {
        symbol: args.symbol,
        direction: args.direction,
        method: args.method,
        fromType: args.fromType,
        fromFile: args.fromFile,
        limit: args.limit,
      });
      const blocks = [{ type: "text", text: r.text }];
      if (r.compact) {
        blocks.push({ type: "text", text: `--- compact ---\n${JSON.stringify(r.compact)}` });
      }
      result = { content: blocks, isError: r.isError };
    }
  } else if (name === "agent_get_module_flow_edges") {
    if (!args?.moduleId) {
      result = {
        content: [{ type: "text", text: "status=error\nmoduleId required" }],
        isError: true,
      };
    } else {
      const r = getModuleFlowEdges(projectRoot, args.moduleId, { limit: args.limit });
      const blocks = [{ type: "text", text: r.text }];
      if (r.compact) {
        blocks.push({ type: "text", text: `--- compact ---\n${JSON.stringify(r.compact)}` });
      }
      result = { content: blocks, isError: r.isError };
    }
  } else if (name === "agent_get_changed_since") {
    const r = getChangedSince(projectRoot, {
      since: args?.since,
      reason: args?.reason,
      limit: args?.limit,
    });
    const blocks = [{ type: "text", text: r.text }];
    if (r.compact) {
      blocks.push({ type: "text", text: `--- compact ---\n${JSON.stringify(r.compact)}` });
    }
    result = { content: blocks, isError: r.isError };
  } else if (name === "agent_get_prefab_fingerprint") {
    if (!args?.path && !args?.guid) {
      result = {
        content: [{ type: "text", text: "status=error\nprovide path or guid" }],
        isError: true,
      };
    } else {
      const r = readPrefabFingerprint(projectRoot, {
        path: args.path,
        guid: args.guid,
        verbose: args.verbose === true,
      });
      const blocks = [{ type: "text", text: r.text }];
      if (r.compact) {
        blocks.push({ type: "text", text: `--- compact ---\n${JSON.stringify(r.compact)}` });
      }
      result = { content: blocks, isError: r.isError };
    }
  } else if (name === "agent_query_scriptable") {
    if (!args?.path && !args?.guid && !args?.type) {
      result = {
        content: [{ type: "text", text: "status=error\nprovide path, guid, or type" }],
        isError: true,
      };
    } else {
      const r = queryScriptable(projectRoot, {
        path: args.path,
        guid: args.guid,
        type: args.type,
        verbose: args.verbose === true,
      });
      const blocks = [{ type: "text", text: r.text }];
      if (r.compact) {
        blocks.push({ type: "text", text: `--- compact ---\n${JSON.stringify(r.compact)}` });
      } else if (r.typeMatches?.length) {
        blocks.push({ type: "text", text: `--- matches ---\n${JSON.stringify(r.typeMatches)}` });
      }
      result = { content: blocks, isError: r.isError };
    }
  } else if (name === "agent_prefab_audit") {
    if (!args?.folder) {
      result = {
        content: [{ type: "text", text: "status=error\nfolder required (Assets/...)" }],
        isError: true,
      };
    } else {
      const r = auditPrefabFolder(projectRoot, args.folder, {
        includeAll: args.includeAll === true,
      });
      const blocks = [{ type: "text", text: r.text }];
      if (r.compact?.length) {
        blocks.push({ type: "text", text: `--- compact ---\n${JSON.stringify(r.compact)}` });
      }
      result = { content: blocks, isError: r.isError };
    }
  } else if (name === "agent_apply_index_delta") {
    try {
      const out = applyIndexDelta(projectRoot, {});
      const d = out.delta || {};
      const anchorCount = buildModuleAnchors(projectRoot).length;
      result = {
        content: [
          {
            type: "text",
            text:
              `index delta applied scanned=${d.scanned ?? "?"} added=${d.added ?? 0} changed=${d.changed ?? 0}\nfiles=${out.summary.stats.files} types=${out.summary.stats.types}\nmodule_anchors rebuilt=${anchorCount}`,
          },
        ],
        isError: false,
      };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_read_project_index") {
    const r = readProjectSummary(projectRoot);
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_read_module_index") {
    const r = readModuleIndex(projectRoot, args?.moduleId, args?.typeLimit ?? 40);
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_read_type_outline") {
    const r = readTypeOutline(projectRoot, args?.typeName, args?.moduleId);
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_read_code_layers") {
    const r = readCodeLayers(projectRoot);
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_read_module_anchors") {
    const r = readModuleAnchors(projectRoot, args ?? {});
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_rebuild_module_anchors") {
    const written = buildModuleAnchors(projectRoot);
    result = {
      content: [
        {
          type: "text",
          text:
            `rebuild_module_anchors ok modules=${written.length}\n` +
            written
              .slice(0, 20)
              .map((w) => `  ${w.moduleId}: ${w.anchors}`)
              .join("\n") +
            "\n→ agent_read_module_anchors moduleId=GameMechanic",
        },
      ],
      isError: false,
    };
  } else if (name === "agent_read_type_digest") {
    const r = readTypeDigest(projectRoot, args?.typeName, args?.moduleId);
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_find_in_module") {
    const r = findInModule(projectRoot, {
      moduleId: args?.moduleId,
      pattern: args?.pattern,
      searchIn: args?.searchIn,
      maxResults: args?.maxResults,
    });
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_set_tool_profile") {
    try {
      const data = writeToolProfileFile(projectRoot, args.profile, {
        enforcement: args.enforcement,
        strict: args.strict,
      });
      const hint = getSuggestedTools(loadStaticCapabilities(), data);
      result = {
        content: [
          {
            type: "text",
            text:
              `tool_profile active=${data.active} enforcement=${data.enforcement ?? "advisory"}\n` +
              `hint: ${hint.hint}\n` +
              `suggestedTools: ${hint.suggestedTools.join(", ")}\n` +
              (hint.advisory ? "(advisory)" : "(strict — out-of-profile MCP blocked)"),
          },
        ],
        isError: false,
      };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_get_tool_profile") {
    const data = readToolProfileFile(projectRoot);
    const cap = loadStaticCapabilities();
    const hint = getSuggestedTools(cap.error ? {} : cap, data);
    result = {
      content: [
        {
          type: "text",
          text:
            `active=${hint.active} enforcement=${hint.enforcement}\n` +
            `hint: ${hint.hint}\n` +
            `preferCursorTools: ${(hint.preferCursorTools || []).join(", ") || "(none)"}\n` +
            `suggestedTools (${hint.suggestedTools.length}): ${hint.suggestedTools.join(", ")}`,
        },
      ],
      isError: false,
    };
  } else if (name === "agent_validate_pke_freshness") {
    const r = validatePkeFreshness(projectRoot, { maxAgeHours: args?.maxAgeHours ?? 24 });
    result = {
      content: [{ type: "text", text: formatFreshnessText(r) }],
      isError: !r.ok,
    };
  } else if (name === "agent_export_pke_metrics") {
    try {
      const out = syncMetricsStore(projectRoot);
      result = {
        content: [
          {
            type: "text",
            text:
              `pke_metrics_export ok backend=${out.backend}\n` +
              `export=${out.exportPath}\n` +
              `turns=${out.counts.turns} episodes=${out.counts.episodes} playmodeErrors=${out.counts.playmodeErrors}`,
          },
        ],
        isError: false,
      };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_read_playmode_errors") {
    const r = readPlaymodeErrors(projectRoot, { limit: args?.limit ?? 30 });
    result = { content: [{ type: "text", text: r.text }], isError: r.isError };
  } else if (name === "agent_verify_compile") {
    try {
      const out = await verifyCompile(projectRoot, {
        pathFilter: args?.pathFilter,
        maxPolls: args?.maxPolls ?? 3,
      });
      const text = `compile.ok=${out.ok}\ncompile.status=${out.compileStatus}\nerrors=${JSON.stringify(out.errors?.slice(0, 10) ?? [])}\nelapsedMs=${out.elapsedMs}`;
      result = { content: [{ type: "text", text }], isError: !out.ok };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_verify_playmode") {
    try {
      const out = await verifyPlaymode(projectRoot, {
        scenePath: args?.scenePath,
        waitSec: args?.waitSec,
        capture: args?.capture,
      });
      const lines = [
        `playmode.ok=${out.ok}`,
        `playmode.skipped=${out.skipped === true}`,
        `playmode.errorCount=${out.errorCount ?? 0}`,
        `playmode.durationSec=${out.durationSec ?? 0}`,
      ];
      if (out.capturePath) lines.push(`capturePath=${out.capturePath}`);
      if (out.errors?.length) {
        for (const e of out.errors.slice(0, 10)) {
          lines.push(`  [${e.type}] ${String(e.message ?? "").slice(0, 200)}`);
        }
      }
      result = {
        content: [{ type: "text", text: lines.join("\n") }],
        isError: !out.ok && !out.skipped,
      };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_verify_feature") {
    try {
      const verdict = await runVerifyLoop(projectRoot, {
        scenePath: args?.scenePath,
        waitSec: args?.waitSec,
        capture: args?.capture,
        pathFilter: args?.pathFilter,
        maxPolls: args?.maxPolls ?? 3,
      });
      result = {
        content: [{ type: "text", text: formatVerdictText(verdict) }],
        isError: verdict.verdict !== "pass",
      };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_read_task_handoff") {
    const r = readTaskHandoff(projectRoot);
    result = {
      content: [{ type: "text", text: r.text }],
      isError: r.isError === true,
    };
  } else if (name === "agent_export_skill_bundle") {
    try {
      const out = exportSkillBundle(projectRoot, args ?? {});
      result = { content: [{ type: "text", text: out.text }], isError: false };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_import_skill_bundle") {
    const r = importSkillBundle(projectRoot, args ?? {});
    result = {
      content: [{ type: "text", text: r.text }],
      isError: r.isError === true,
    };
  } else if (name === "agent_list_skill_bundles") {
    const r = listSkillBundles(projectRoot);
    result = { content: [{ type: "text", text: r.text }], isError: false };
  } else if (name === "agent_get_domain_pack") {
    try {
      const r = buildPackDigest(projectRoot, { packId: args?.packId });
      result = {
        content: [{ type: "text", text: r.text }],
        isError: r.isError === true,
      };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_get_unity_subdomain") {
    try {
      const r = getUnitySubdomain(projectRoot, args?.query ?? "");
      result = {
        content: [{ type: "text", text: r.text }],
        isError: r.isError === true,
      };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_set_active_domain_packs") {
    try {
      writeActivePacks(projectRoot, args?.packs ?? []);
      const r = buildPackDigest(projectRoot);
      result = {
        content: [
          {
            type: "text",
            text: `active packs set: ${(readActivePacks(projectRoot).active || []).join(", ")}\n\n${r.text}`,
          },
        ],
        isError: false,
      };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_update_task_handoff") {
    try {
      const out = updateTaskHandoff(projectRoot, args ?? {});
      result = { content: [{ type: "text", text: out.text }], isError: false };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else if (name === "agent_validate_registry") {
    result = await validateRegistry(args?.checkUnityBridge === true);
  } else if (name.startsWith("agent_vfx_storage_")) {
    if (!_catVfxStorage) {
      result = {
        content: [
          {
            type: "text",
            text: "VFX storage MCP not installed — apply pack `vfx` (Unity Pro/Studio).",
          },
        ],
        isError: true,
      };
    } else {
      const storageResult = await handleVfxStorageTool(name, args ?? {}, {
        projectRoot,
        invokeBridge,
      });
      result =
        storageResult ||
        {
          content: [{ type: "text", text: `Unknown VFX storage tool: ${name}` }],
          isError: true,
        };
    }
  } else if (name.startsWith("agent_vfx_")) {
    if (!_catVfx) {
      result = {
        content: [
          {
            type: "text",
            text: "VFX MCP not installed — apply pack `vfx` (Unity Pro/Studio).",
          },
        ],
        isError: true,
      };
    } else {
      const vfxResult = await handleVfxTool(name, args ?? {}, {
        projectRoot,
        invokeBridge,
      });
      result =
        vfxResult ||
        {
          content: [{ type: "text", text: `Unknown VFX tool: ${name}` }],
          isError: true,
        };
    }
  } else if (name.startsWith("agent_builder_")) {
    if (!_catBuilder) {
      result = {
        content: [
          {
            type: "text",
            text: "Builder MCP not installed — apply pack `builder` (Unity Studio).",
          },
        ],
        isError: true,
      };
    } else {
      const builderResult = await handleBuilderTool(name, args ?? {}, {
        projectRoot,
        invokeBridge,
      });
      result =
        builderResult ||
        {
          content: [{ type: "text", text: `Unknown builder tool: ${name}` }],
          isError: true,
        };
    }
  } else if (name.startsWith("agent_sg_")) {
    if (!_catSg) {
      result = {
        content: [
          {
            type: "text",
            text: "Shader Graph MCP not installed — apply pack `shadergraph` (Unity Studio).",
          },
        ],
        isError: true,
      };
    } else {
      const sgResult = await handleSgTool(name, args ?? {}, {
        projectRoot,
        invokeBridge,
      });
      result =
        sgResult ||
        {
          content: [{ type: "text", text: `Unknown Shader Graph tool: ${name}` }],
          isError: true,
        };
    }
  } else if (name.startsWith("agent_figma_")) {
    if (!_catFigma) {
      result = {
        content: [
          {
            type: "text",
            text: "Figma HUD MCP not installed — apply pack `figma-hud` (Unity Studio).",
          },
        ],
        isError: true,
      };
    } else {
      const figmaResult = await handleFigmaTool(name, args ?? {}, {
        projectRoot,
        invokeBridge,
      });
      result =
        figmaResult ||
        {
          content: [{ type: "text", text: `Unknown Figma tool: ${name}` }],
          isError: true,
        };
    }
  } else if (name.startsWith("agent_ui_image_")) {
    if (!_catUiImage) {
      result = {
        content: [
          {
            type: "text",
            text: "UI-from-image MCP module not installed in this pack set.",
          },
        ],
        isError: true,
      };
    } else {
      const uiImageResult = await handleUiImageTool(name, args ?? {}, {
        projectRoot,
        invokeBridge,
      });
      result =
        uiImageResult ||
        {
          content: [{ type: "text", text: `Unknown UI image tool: ${name}` }],
          isError: true,
        };
    }
  } else if (name.startsWith("agent_bundleleak_")) {
    if (!_catBundleLeak) {
      result = {
        content: [
          {
            type: "text",
            text: "BundleLeak MCP module not installed in this pack set.",
          },
        ],
        isError: true,
      };
    } else {
      const bundleLeakResult = await handleBundleLeakTool(name, args ?? {}, {
        projectRoot,
        invokeBridge,
      });
      result =
        bundleLeakResult ||
        {
          content: [{ type: "text", text: `Unknown BundleLeak tool: ${name}` }],
          isError: true,
        };
    }
  } else if (name === "unity_bridge_batch") {
    try {
      const commands = args.commands ?? [];
      const batch = await invokeBridgeBatch(projectRoot, commands, {
        timeoutMs: effectiveBatchTimeoutMs(commands, args?.timeoutMs ?? 60000),
        maxCommands: args?.maxCommands ?? 16,
      });
      const lines = [
        `bridge_batch ok=${batch.ok} count=${batch.results.length} elapsedMs=${batch.elapsedMs}`,
        batch.timedOut ? `timedOut=${batch.timedOut}` : "",
        "--- results ---",
        ...batch.results.map((r) => {
          const ih = summarizeIndexHealth(r.data?.indexHealth);
          const ihPart = ih ? ` ${ih}` : "";
          return `${r.command}: ok=${r.ok}${r.error ? ` error=${r.error}` : ""} elapsed=${r.data?.elapsedMs ?? "?"}ms${ihPart}`;
        }),
      ].filter(Boolean);
      result = {
        content: [
          { type: "text", text: lines.join("\n") },
          { type: "text", text: `\n--- raw ---\n${JSON.stringify(batch, null, 2)}` },
        ],
        isError: !batch.ok,
      };
    } catch (e) {
      result = { content: [{ type: "text", text: String(e.message) }], isError: true };
    }
  } else {
    let command;
    let bridgeArgs = {};
    let summaryOptions = {};
    switch (name) {
      case "unity_ping":
        command = "ping";
        break;
      case "unity_report_scene":
        command = "report_scene";
        if (args?.scenePath) bridgeArgs.scenePath = args.scenePath;
        break;
      case "unity_inventory_scene":
        command = "inventory_scene";
        if (args?.scenePath) bridgeArgs.scenePath = args.scenePath;
        if (args?.maxDepth != null) bridgeArgs.maxDepth = String(args.maxDepth);
        if (args?.includeInactive != null)
          bridgeArgs.includeInactive = String(args.includeInactive);
        summaryOptions.summaryLimit = args?.summaryLimit ?? 120;
        break;
      case "unity_report_project":
        command = "report_project";
        break;
      case "unity_validate_scene":
        command = "validate_scene";
        if (args?.scenePath) bridgeArgs.scenePath = args.scenePath;
        break;
      case "unity_write_snapshot":
        command = "write_snapshot";
        break;
      case "unity_list_build_scenes":
        command = "list_build_scenes";
        if (args?.writeDisk != null) bridgeArgs.writeDisk = String(args.writeDisk);
        break;
      case "unity_index_scene_hierarchy":
        command = "index_scene_hierarchy";
        if (args?.scenePath) bridgeArgs.scenePath = args.scenePath;
        if (args?.maxDepth != null) bridgeArgs.maxDepth = String(args.maxDepth);
        if (args?.maxNodes != null) bridgeArgs.maxNodes = String(args.maxNodes);
        if (args?.includeInactive != null)
          bridgeArgs.includeInactive = String(args.includeInactive);
        if (args?.writeDisk != null) bridgeArgs.writeDisk = String(args.writeDisk);
        break;
      case "unity_refresh_build_scene_index":
        command = "refresh_build_scene_index";
        if (args?.maxDepth != null) bridgeArgs.maxDepth = String(args.maxDepth);
        if (args?.maxNodes != null) bridgeArgs.maxNodes = String(args.maxNodes);
        if (args?.includeInactive != null)
          bridgeArgs.includeInactive = String(args.includeInactive);
        if (args?.restoreScene != null)
          bridgeArgs.restoreScene = String(args.restoreScene);
        break;
      case "unity_list_scenes":
        command = "list_scenes";
        if (args?.filter) bridgeArgs.filter = args.filter;
        if (args?.limit != null) bridgeArgs.limit = String(args.limit);
        break;
      case "unity_bridge_invoke":
        command = args.command;
        bridgeArgs = args.args || {};
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    const response = await invokeBridge(command, bridgeArgs);
    const summary = summarize(response, summaryOptions);
    result = {
      content: [
        { type: "text", text: summary },
        { type: "text", text: `\n--- raw ---\n${JSON.stringify(response, null, 2)}` },
      ],
      isError: !response.ok,
    };
  }

  const elapsedMs = Date.now() - t0;
  const outText = result.content?.map((c) => c.text).join("\n") ?? "";
  usage.record(name, JSON.stringify(args ?? {}), outText, elapsedMs);
  return result;
}

function handleRequest(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "strategy-paths-unity", version: "0.1.0" },
      },
    });
    return;
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    const filtered = filterToolsByEntitlement(projectRoot, TOOLS);
    send({ jsonrpc: "2.0", id, result: { tools: filtered } });
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    handleToolCall(toolName, toolArgs)
      .then((result) => send({ jsonrpc: "2.0", id, result }))
      .catch((err) =>
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: String(err.message || err) }],
            isError: true,
          },
        })
      );
    return;
  }

  send({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    handleRequest(JSON.parse(line));
  } catch (e) {
    send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  }
});
