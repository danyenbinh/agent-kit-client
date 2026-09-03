#!/usr/bin/env node
/** CLI test MCP logic without Cursor: node tools/strategy-paths-unity-mcp/cli.mjs validate */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUsageTracker, estimateTokens } from "./usage-tracker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
process.env.STRATEGY_PATHS_PROJECT_ROOT = projectRoot;

const bridgeRoot = path.join(projectRoot, ".cursor", "unity-bridge");
const usage = createUsageTracker(bridgeRoot);

const cmd = process.argv[2] ?? "usage";

if (cmd === "validate") {
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, "run-tool.mjs"), "agent_validate_registry"],
    { encoding: "utf8", cwd: projectRoot }
  );
  console.log(r.stdout || r.stderr);
} else if (cmd === "record") {
  const userChars = Number(process.argv[3] ?? 200);
  const agentChars = Number(process.argv[4] ?? 1500);
  const userTok = estimateTokens("x".repeat(userChars));
  const agentTok = estimateTokens("x".repeat(agentChars));
  console.log(`est. user ~${userTok} + agent ~${agentTok} = ~${userTok + agentTok} tokens`);
} else {
  console.log(usage.formatReport(5));
}
