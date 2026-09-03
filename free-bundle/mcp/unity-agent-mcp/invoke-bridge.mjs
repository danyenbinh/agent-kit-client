#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function resolveProjectRoot() {
  if (process.env.AGENT_PROJECT_ROOT) return path.resolve(process.env.AGENT_PROJECT_ROOT);
  if (process.env.STRATEGY_PATHS_PROJECT_ROOT) return path.resolve(process.env.STRATEGY_PATHS_PROJECT_ROOT);
  return path.resolve(__dirname, "../..");
}

const projectRoot = resolveProjectRoot();
const capabilitiesPath = path.join(projectRoot, ".cursor", "agent-capabilities.json");
const DEFAULT_BATCH_EXECUTE_METHOD =
  "CursorAgentKit.Editor.AgentBridge.AgentBridgeBatchEntry.ProcessOnce";

function getBatchExecuteMethod() {
  if (!fs.existsSync(capabilitiesPath)) return DEFAULT_BATCH_EXECUTE_METHOD;
  try {
    const cap = JSON.parse(fs.readFileSync(capabilitiesPath, "utf8"));
    return cap.unityBridge?.batchExecuteMethod || DEFAULT_BATCH_EXECUTE_METHOD;
  } catch {
    return DEFAULT_BATCH_EXECUTE_METHOD;
  }
}
const bridgeRoot = path.join(projectRoot, ".cursor", "unity-bridge");
const requestsDir = path.join(bridgeRoot, "requests");
const responsesDir = path.join(bridgeRoot, "responses");

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

async function waitForFile(filePath, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        return null;
      }
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
}

async function invokeBridge(command, args = {}) {
  fs.mkdirSync(requestsDir, { recursive: true });
  fs.mkdirSync(responsesDir, { recursive: true });
  const id = randomUUID();
  const responsePath = path.join(responsesDir, `${id}.json`);
  fs.writeFileSync(
    path.join(requestsDir, `${id}.json`),
    JSON.stringify({ id, command, args }, null, 2),
    "utf8"
  );
  let response = await waitForFile(responsePath, 10000);
  if (!response) {
    runBatch();
    response = await waitForFile(responsePath, 15000);
  }
  return response;
}

const cmd = process.argv[2] ?? "ping";
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const response = await invokeBridge(cmd, args);
if (!response) {
  console.error("Bridge timeout. Mở Unity Editor với project này.");
  process.exit(1);
}
console.log(JSON.stringify(response, null, 2));
