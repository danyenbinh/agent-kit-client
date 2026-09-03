import fs from "fs";
import path from "path";

const DIGEST_ROWS = [
  { id: "editor-bridge", skills: ["unity-mcp-workflow", "unity-testing"], bridge: "unity_ping, unity_bridge_batch", depth: "standard" },
  { id: "scene-layout", skills: ["unity-scene-map", "unity-scene-build-index"], bridge: "list_build_scenes, save_scene", depth: "standard" },
  { id: "code-navigation", skills: ["unity-code-map"], bridge: "read_code_layers, find_in_module", depth: "standard" },
  { id: "ui-ux", skills: ["unity-hud-system", "unity-ui-from-image", "unity-figma-hud-authoring"], bridge: "agent_figma_inspect, ui_panel_from_brief, capture_game_view", depth: "standard" },
  { id: "rendering", skills: ["unity-rendering-urp", "unity-shadergraph-authoring"], bridge: "shader_scan, agent_sg_search, asset_read", depth: "deep" },
  { id: "assets-build", skills: ["unity-assets-addressables"], bridge: "workbench build_size", depth: "deep" },
  { id: "animation-vfx", skills: ["unity-animation-spine", "unity-vfx-authoring"], bridge: "agent_vfx_search, vfx_scan, prefab_open", depth: "deep" },
  { id: "audio", skills: ["unity-audio-build"], bridge: "asset_patch", depth: "deep" },
  { id: "platform-mobile", skills: ["unity-platform-mobile"], bridge: "report_project", depth: "deep" },
  { id: "quality-editor", skills: ["unity-agent-console"], bridge: "agent_workbench_*", depth: "standard" },
];

function readJson(projectRoot, rel) {
  const p = path.join(projectRoot, rel);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function scoreMatch(haystack, query) {
  const h = haystack.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (h.includes(q)) return 10 + q.length;
  const tokens = q.split(/\s+/).filter(Boolean);
  let s = 0;
  for (const t of tokens) {
    if (h.includes(t)) s += 3;
  }
  return s;
}

/**
 * @param {string} projectRoot
 * @param {string} query
 */
export function getUnitySubdomain(projectRoot, query) {
  const q = (query || "").trim();
  const caps = readJson(projectRoot, ".cursor/agent-capabilities.json");
  const features = readJson(projectRoot, ".cursor/feature-skills-index.json");

  const skillHits = [];
  if (caps?.skills) {
    for (const s of caps.skills) {
      const when = s.when || "";
      const id = s.id || "";
      const sc = scoreMatch(`${id} ${when}`, q);
      if (sc > 0) skillHits.push({ id, domain: s.domain, subdomain: s.subdomain, score: sc, source: "capabilities" });
    }
  }
  if (features?.features) {
    for (const f of features.features) {
      const triggers = (f.triggers || []).join(" ");
      const sc = scoreMatch(`${f.id} ${triggers}`, q);
      if (sc > 0) skillHits.push({ id: f.id, domain: f.domain, subdomain: f.subdomain, score: sc + 1, source: "feature-index" });
    }
  }
  skillHits.sort((a, b) => b.score - a.score);

  const digestHits = [];
  for (const row of DIGEST_ROWS) {
    const blob = `${row.id} ${row.skills.join(" ")} ${row.bridge}`;
    const sc = scoreMatch(blob, q);
    if (sc > 0) digestHits.push({ ...row, score: sc });
  }
  digestHits.sort((a, b) => b.score - a.score);

  const routingHits = [];
  if (caps?.routing) {
    for (const r of caps.routing) {
      const blob = `${r.task || ""} ${(r.skills || []).join(" ")}`;
      const sc = scoreMatch(blob, q);
      if (sc > 0) routingHits.push({ task: r.task, skills: r.skills, domain: r.domain, score: sc });
    }
  }
  routingHits.sort((a, b) => b.score - a.score);

  const topSkill = skillHits[0];
  const topDigest = digestHits[0];
  const topRoute = routingHits[0];

  const subdomain =
    (topRoute?.domain === "gameplay" && topSkill?.subdomain) ||
    (topSkill?.domain === "gameplay" && topSkill?.subdomain) ||
    topDigest?.id ||
    (topRoute?.domain === "gameplay" ? "combat" : "editor-bridge");

  const skillIds = [
    ...new Set([
      ...(topRoute?.skills || []),
      ...(topDigest?.skills || []),
      ...skillHits.slice(0, 3).map((h) => h.id),
    ]),
  ].slice(0, 6);

  const out = {
    query: q,
    subdomain,
    skillIds,
    bridgeGroup: topDigest?.bridge || null,
    depth: topDigest?.depth || "standard",
    matches: {
      skills: skillHits.slice(0, 5).map(({ id, score }) => ({ id, score })),
      digest: digestHits.slice(0, 3).map(({ id, score }) => ({ id, score })),
      routing: routingHits.slice(0, 2).map(({ task, score }) => ({ task, score })),
    },
  };

  const lines = [
    `subdomain=${out.subdomain} depth=${out.depth}`,
    `skillIds=${out.skillIds.join(", ") || "(none)"}`,
    out.bridgeGroup ? `bridge=${out.bridgeGroup}` : "",
    "",
    JSON.stringify(out, null, 2),
  ].filter(Boolean);

  return { text: lines.join("\n"), isError: !q };
}
