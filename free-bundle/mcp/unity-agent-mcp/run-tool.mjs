#!/usr/bin/env node
/** Run one MCP tool inline — set AGENT_PROJECT_ROOT to game repo root. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUsageTracker } from "./usage-tracker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveProjectRoot() {
  if (process.env.AGENT_PROJECT_ROOT) return path.resolve(process.env.AGENT_PROJECT_ROOT);
  if (process.env.STRATEGY_PATHS_PROJECT_ROOT) return path.resolve(process.env.STRATEGY_PATHS_PROJECT_ROOT);
  return process.cwd();
}

const projectRoot = resolveProjectRoot();
const tool = process.argv[2];
const bridgeRoot = path.join(projectRoot, ".cursor", "unity-bridge");
const capPath = path.join(projectRoot, ".cursor", "agent-capabilities.json");

if (!fs.existsSync(capPath)) {
  console.error("Missing:", capPath);
  process.exit(1);
}

const indexSrc = fs.readFileSync(path.join(__dirname, "index.mjs"), "utf8");
const indexTools = [...indexSrc.matchAll(/name:\s*"(agent_[^"]+|unity_[^"]+)"/g)].map((m) => m[1]);
const cap = JSON.parse(fs.readFileSync(capPath, "utf8"));
const jsonTools = (cap.mcp?.tools ?? []).map((t) => t.name);

function validateRegistryLite() {
  const issues = [];
  const missing = jsonTools.filter((t) => !indexTools.includes(t));
  const extra = indexTools.filter((t) => !jsonTools.includes(t));
  for (const t of missing) issues.push(`mcp tool in json but not index.mjs: ${t}`);
  for (const t of extra) issues.push(`mcp tool in index.mjs but not json: ${t}`);

  for (const s of cap.skills ?? []) {
    const skillFile = path.join(projectRoot, s.file.replace(/\//g, path.sep));
    if (!fs.existsSync(skillFile)) issues.push(`skill file missing: ${s.file}`);
  }

  const mdcPath = path.join(projectRoot, ".cursor", "rules", "agent-capabilities.mdc");
  if (fs.existsSync(mdcPath)) {
    const mdc = fs.readFileSync(mdcPath, "utf8");
    for (const s of cap.skills ?? []) {
      if (s.scope === "universal" && !mdc.includes(`\`${s.id}\``)) {
        issues.push(`mdc digest missing universal skill: ${s.id}`);
      }
    }
  }

  return issues;
}

if (tool === "agent_validate_registry") {
  const issues = validateRegistryLite();
  if (issues.length) {
    console.log(`validate_registry ok=false\nissues:\n- ${issues.join("\n- ")}`);
    process.exit(1);
  }
  console.log("validate_registry ok=true\nall sync checks passed");
} else if (tool === "agent_get_usage") {
  console.log(createUsageTracker(bridgeRoot).formatReport(5));
} else {
  console.log("tools:", indexTools.join(", "));
}
