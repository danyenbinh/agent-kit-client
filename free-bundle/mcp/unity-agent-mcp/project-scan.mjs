/**
 * Bundled project scan — profile + index + layers + modules (+ optional anchors).
 * Token-efficient alternative to many separate MCP calls at session start.
 */
import fs from "node:fs";
import path from "node:path";
import {
  readProjectProfileText,
  readIndexStatusText,
  readProjectSummary,
} from "./codebase-index.mjs";
import { readCodeLayers, readModuleAnchors } from "./codebase-layers.mjs";

function readFeatureSkillsDigest(projectRoot) {
  const p = path.join(projectRoot, ".cursor", "feature-skills-index.json");
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const lines = [`overview=${j.overviewSkill ?? "?"} refreshed=${j.lastOverviewRefresh ?? "?"}`];
    for (const f of j.features ?? []) {
      const trig = (f.triggers ?? []).slice(0, 4).join(", ");
      lines.push(`  ${f.id} | ${trig}`);
    }
    if ((j.planned ?? []).length) {
      lines.push(`planned: ${j.planned.map((x) => x.id).join(", ")}`);
    }
    return lines.join("\n");
  } catch {
    return null;
  }
}

function readSceneAnchorsDigest(projectRoot) {
  const regPath = path.join(projectRoot, ".cursor", "unity-bridge", "build-scene-registry.json");
  if (!fs.existsSync(regPath)) return null;
  try {
    const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
    const scenes = reg.scenes ?? reg.entries ?? [];
    if (!Array.isArray(scenes) || !scenes.length) return null;
    const lines = ["build-scene-registry:"];
    for (const s of scenes.slice(0, 12)) {
      const name = s.name ?? s.sceneName ?? s.id ?? "?";
      const purpose = s.purpose ?? s.role ?? "";
      lines.push(`  ${name} | ${purpose}`.trimEnd());
    }
    if (scenes.length > 12) lines.push(`  ... +${scenes.length - 12} scenes`);
    lines.push("→ agent_read_scene_anchors sceneName=...");
    return lines.join("\n");
  } catch {
    return null;
  }
}

function topModulesFromSummary(summary) {
  if (!summary?.modules?.length) return [];
  return [...summary.modules].sort((a, b) => (b.typeCount ?? 0) - (a.typeCount ?? 0));
}

/**
 * @param {string} projectRoot
 * @param {{ depth?: 'shallow'|'standard'|'deep', moduleLimit?: number, applyDeltaIfStale?: boolean }} options
 */
export function runProjectScan(projectRoot, options = {}) {
  const depth = options.depth ?? "standard";
  const moduleLimit = options.moduleLimit ?? (depth === "deep" ? 6 : depth === "standard" ? 0 : 0);
  const lines = [`project_scan depth=${depth}`, ""];

  const prof = readProjectProfileText(projectRoot);
  lines.push("=== PROFILE ===", prof.text, "");

  if (depth === "shallow") {
    lines.push("=== NEXT ===", "standard scan → agent_project_scan depth=standard", "code task → unity-code-map");
    return { text: lines.join("\n"), isError: prof.isError };
  }

  const status = readIndexStatusText(projectRoot);
  lines.push("=== INDEX ===", status.text, "");

  const layers = readCodeLayers(projectRoot);
  lines.push("=== LAYERS ===", layers.text, "");

  const summaryResult = readProjectSummary(projectRoot);
  lines.push("=== MODULES ===", summaryResult.text, "");

  const feat = readFeatureSkillsDigest(projectRoot);
  if (feat) lines.push("=== FEATURE SKILLS (project) ===", feat, "");

  const scenes = readSceneAnchorsDigest(projectRoot);
  if (scenes) lines.push("=== SCENES ===", scenes, "");

  if (depth === "deep" && summaryResult.summary) {
    const top = topModulesFromSummary(summaryResult.summary).slice(0, moduleLimit || 6);
    lines.push(`=== ANCHORS (top ${top.length} modules) ===`);
    for (const m of top) {
      const r = readModuleAnchors(projectRoot, { moduleId: m.id, maxResults: 12 });
      lines.push(`--- ${m.id} (${m.typeCount} types) ---`);
      lines.push(r.text.split("\n").slice(0, 18).join("\n"));
      lines.push("");
    }
  }

  lines.push(
    "=== NEXT (drill-down) ===",
    "1 module → agent_read_module_anchors moduleId=...",
    "1 class → agent_read_type_digest typeName=...",
    "1 scene → agent_read_scene_anchors sceneName=...",
    "stale → agent_apply_index_delta",
    "first time / no index → agent_build_project_index",
    "game feature → feature-skills-index.json → 1 gameplay-* skill"
  );

  return {
    text: lines.join("\n"),
    isError: prof.isError && depth !== "deep",
    depth,
  };
}
