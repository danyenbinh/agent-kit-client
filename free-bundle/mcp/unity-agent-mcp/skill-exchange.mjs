/**
 * Multi-agent skill exchange — portable bundles (universal meta).
 * Export/import manifests; no auto-patch core skills.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const BUNDLE_VERSION = 1;
export const ARTIFACT_TYPES = ["pitfall", "pattern", "workflow", "mcp-tool", "governance"];
export const TRUST_LEVELS = ["internal", "external"];

const PROTECTED_TERMS = [
  "agent-delivery-loop",
  "agent-capabilities.json",
  "core-system-governance",
  "AGENT-NORTH-STAR",
  "index.mjs",
  "ProcessPendingRequests",
];

const GAME_SPECIFIC_RE = /\b(Assets\/|Game\.unity|_DangerDungeon|gameplay-\w+)\b/i;

export function exchangeRoot(projectRoot) {
  return path.join(projectRoot, ".cursor", "skill-exchange");
}

export function bundlesDir(projectRoot) {
  return path.join(exchangeRoot(projectRoot), "bundles");
}

export function importQueuePath(projectRoot) {
  return path.join(exchangeRoot(projectRoot), "import-queue.jsonl");
}

function slugify(title) {
  return (title || "bundle")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function classifyBundle(bundle) {
  const issues = [];
  const text = JSON.stringify(bundle).toLowerCase();

  for (const term of PROTECTED_TERMS) {
    if (text.includes(term.toLowerCase())) {
      issues.push(`mentions protected: ${term}`);
    }
  }

  let scope = bundle.scopeRecommendation || "project";
  if (GAME_SPECIFIC_RE.test(JSON.stringify(bundle))) {
    scope = "project";
    issues.push("game-specific paths detected → force project scope");
  }
  if (bundle.artifactType === "governance") {
    scope = "universal";
  }

  let importAction = "patch-project";
  if (scope === "universal" || bundle.artifactType === "governance") {
    importAction = "proposal-universal";
  }
  if (bundle.trustLevel === "external" && !bundle.reviewedByUser) {
    importAction = "review-required";
  }
  if (issues.some((i) => i.startsWith("mentions protected"))) {
    importAction = "reject";
  }

  return {
    scope,
    importAction,
    issues,
    targetHint: bundle.targetSkillHint || "(classify via agent-skill-registry)",
    proposalPath:
      importAction === "proposal-universal"
        ? ".cursor/core-change-proposals/YYYYMMDD-slug.md"
        : null,
  };
}

export function exportSkillBundle(projectRoot, input = {}) {
  if (!input.title?.trim()) throw new Error("title required");
  if (!input.artifactType || !ARTIFACT_TYPES.includes(input.artifactType)) {
    throw new Error(`artifactType must be one of: ${ARTIFACT_TYPES.join(", ")}`);
  }

  const capPath = path.join(projectRoot, ".cursor", "agent-capabilities.json");
  let projectName = path.basename(projectRoot);
  if (fs.existsSync(capPath)) {
    try {
      projectName = JSON.parse(fs.readFileSync(capPath, "utf8")).project ?? projectName;
    } catch {
      /* ignore */
    }
  }

  const id = input.id || randomUUID();
  const slug = input.slug || `${new Date().toISOString().slice(0, 10)}-${slugify(input.title)}`;
  const bundle = {
    bundleVersion: BUNDLE_VERSION,
    id,
    slug,
    title: input.title.trim(),
    exportedAt: new Date().toISOString(),
    sourceAgent: input.sourceAgent || "cursor-agent",
    sourceProject: input.sourceProject || projectName,
    domainPack: input.domainPack || "general",
    artifactType: input.artifactType,
    scopeRecommendation: input.scopeRecommendation || "project",
    targetSkillHint: input.targetSkillHint || "",
    skillSnippet: input.skillSnippet || "",
    pitfalls: input.pitfalls || [],
    workflowSteps: input.workflowSteps || [],
    mcpHints: input.mcpHints || [],
    testChecklist: input.testChecklist || [],
    trustLevel: input.trustLevel || "internal",
  };

  const classification = classifyBundle(bundle);
  bundle.classification = classification;

  const dir = bundlesDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${slug}.json`);
  fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2) + "\n", "utf8");

  const rel = path.relative(projectRoot, filePath).split(path.sep).join("/");
  return {
    ok: true,
    filePath: rel,
    bundle,
    text:
      `exported bundle slug=${slug}\n` +
      `file=${rel}\n` +
      `artifactType=${bundle.artifactType} domainPack=${bundle.domainPack}\n` +
      `importAction=${classification.importAction}\n` +
      `→ share file; target imports with agent_import_skill_bundle`,
  };
}

export function resolveBundlePath(projectRoot, bundleIdOrSlug) {
  const dir = bundlesDir(projectRoot);
  if (!fs.existsSync(dir)) return null;

  const direct = path.join(dir, bundleIdOrSlug.endsWith(".json") ? bundleIdOrSlug : `${bundleIdOrSlug}.json`);
  if (fs.existsSync(direct)) return direct;

  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const full = path.join(dir, f);
    try {
      const b = JSON.parse(fs.readFileSync(full, "utf8"));
      if (b.id === bundleIdOrSlug || b.slug === bundleIdOrSlug) return full;
    } catch {
      /* skip */
    }
  }
  return null;
}

export function importSkillBundle(projectRoot, opts = {}) {
  const bundleRef = opts.bundleId || opts.slug || opts.path;
  if (!bundleRef) throw new Error("bundleId, slug, or path required");

  let filePath = bundleRef.includes("/") || bundleRef.includes("\\")
    ? path.isAbsolute(bundleRef)
      ? bundleRef
      : path.join(projectRoot, bundleRef)
    : resolveBundlePath(projectRoot, bundleRef);

  if (!filePath || !fs.existsSync(filePath)) {
    return {
      ok: false,
      text: `bundle not found: ${bundleRef}\n→ agent_export_skill_bundle or place file in .cursor/skill-exchange/bundles/`,
      isError: true,
    };
  }

  const bundle = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (bundle.bundleVersion !== BUNDLE_VERSION) {
    return {
      ok: false,
      text: `unsupported bundleVersion=${bundle.bundleVersion}`,
      isError: true,
    };
  }

  const classification = classifyBundle(bundle);
  const action = opts.action || "preview";

  const lines = [
    `import preview slug=${bundle.slug}`,
    `title=${bundle.title}`,
    `from=${bundle.sourceProject} (${bundle.sourceAgent})`,
    `artifactType=${bundle.artifactType} domainPack=${bundle.domainPack}`,
    `scope=${classification.scope} importAction=${classification.importAction}`,
    `target=${classification.targetHint}`,
  ];
  if (classification.issues.length) {
    lines.push(`issues:\n${classification.issues.map((i) => `  - ${i}`).join("\n")}`);
  }
  if (bundle.skillSnippet) {
    lines.push("--- snippet ---", bundle.skillSnippet.slice(0, 800));
  }
  if (classification.importAction === "proposal-universal") {
    lines.push(`→ write ${classification.proposalPath} + user approve before kit patch`);
  } else if (classification.importAction === "patch-project") {
    lines.push("→ ISR patch target skill; do NOT auto-apply without user");
  } else if (classification.importAction === "reject") {
    lines.push("→ REJECT — protected core mentioned");
  } else {
    lines.push("→ user review required (external trust)");
  }

  if (action === "queue" && classification.importAction !== "reject") {
    const queuePath = importQueuePath(projectRoot);
    fs.mkdirSync(path.dirname(queuePath), { recursive: true });
    const entry = {
      queuedAt: new Date().toISOString(),
      bundleSlug: bundle.slug,
      classification,
      bundleFile: path.relative(projectRoot, filePath).split(path.sep).join("/"),
    };
    fs.appendFileSync(queuePath, JSON.stringify(entry) + "\n", "utf8");
    lines.push(`queued → ${path.relative(projectRoot, queuePath).split(path.sep).join("/")}`);
  }

  return {
    ok: classification.importAction !== "reject",
    text: lines.join("\n"),
    bundle,
    classification,
    isError: classification.importAction === "reject",
  };
}

export function listSkillBundles(projectRoot) {
  const dir = bundlesDir(projectRoot);
  if (!fs.existsSync(dir)) {
    return { text: "no bundles\n→ agent_export_skill_bundle", bundles: [] };
  }
  const bundles = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      bundles.push({
        slug: b.slug,
        title: b.title,
        artifactType: b.artifactType,
        domainPack: b.domainPack,
        exportedAt: b.exportedAt,
      });
    } catch {
      /* skip */
    }
  }
  const lines = [
    `bundles count=${bundles.length}`,
    ...bundles.map((b) => `${b.slug} | ${b.artifactType} | ${b.domainPack} | ${b.title}`),
  ];
  return { text: lines.join("\n"), bundles };
}
