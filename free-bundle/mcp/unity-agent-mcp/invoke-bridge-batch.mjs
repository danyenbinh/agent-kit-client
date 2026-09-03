#!/usr/bin/env node
/**
 * Batch Unity bridge IPC — N commands, one round-trip (editor poll or batchmode).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  batchNeedsSlowTimeout,
  bridgeWaitMsForCommand,
  effectiveBatchTimeoutMs,
} from "./bridge-slow-commands.mjs";

const DEFAULT_MAX_COMMANDS = 16;
const DEFAULT_BATCH_EXECUTE_METHOD =
  "CursorAgentKit.Editor.AgentBridge.AgentBridgeBatchEntry.ProcessOnce";

export function resolveBridgePaths(projectRoot) {
  const bridgeRoot = path.join(projectRoot, ".cursor", "unity-bridge");
  return {
    bridgeRoot,
    requestsDir: path.join(bridgeRoot, "requests"),
    responsesDir: path.join(bridgeRoot, "responses"),
    capabilitiesPath: path.join(projectRoot, ".cursor", "agent-capabilities.json"),
  };
}

function getBatchExecuteMethod(capabilitiesPath) {
  if (!fs.existsSync(capabilitiesPath)) return DEFAULT_BATCH_EXECUTE_METHOD;
  try {
    const cap = JSON.parse(fs.readFileSync(capabilitiesPath, "utf8"));
    return cap.unityBridge?.batchExecuteMethod || DEFAULT_BATCH_EXECUTE_METHOD;
  } catch {
    return DEFAULT_BATCH_EXECUTE_METHOD;
  }
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

function runBatch(bridgeRoot, projectRoot, capabilitiesPath) {
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
      getBatchExecuteMethod(capabilitiesPath),
      "-logFile",
      path.join(bridgeRoot, "last-batch.log"),
    ],
    { timeout: 120000, encoding: "utf8" }
  );
  return r.status === 0 || r.status === null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForResponses(entries, responsesDir, timeoutMs) {
  const start = Date.now();
  const pending = new Set(entries.map((e) => e.id));
  const results = new Map();

  while (pending.size > 0 && Date.now() - start < timeoutMs) {
    for (const e of entries) {
      if (!pending.has(e.id)) continue;
      const responsePath = path.join(responsesDir, `${e.id}.json`);
      if (!fs.existsSync(responsePath)) continue;
      try {
        results.set(e.id, JSON.parse(fs.readFileSync(responsePath, "utf8")));
        pending.delete(e.id);
      } catch {
        /* retry */
      }
    }
    if (pending.size > 0) await sleep(120);
  }
  return { results, pending };
}

/**
 * @param {string} projectRoot
 * @param {{ command: string, args?: object }[]} commands
 * @param {{ timeoutMs?: number, maxCommands?: number }} options
 */
export async function invokeBridgeBatch(projectRoot, commands, options = {}) {
  const maxCommands = options.maxCommands ?? DEFAULT_MAX_COMMANDS;
  const timeoutMs = effectiveBatchTimeoutMs(commands, options.timeoutMs ?? 60000);
  const t0 = Date.now();
  const initialWaitMs = batchNeedsSlowTimeout(commands) ? bridgeWaitMsForCommand("rebuild_code_index") : 8000;

  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error("commands[] required");
  }
  if (commands.length > maxCommands) {
    throw new Error(`batch limit ${maxCommands} commands (got ${commands.length})`);
  }

  const { requestsDir, responsesDir, bridgeRoot, capabilitiesPath } =
    resolveBridgePaths(projectRoot);
  fs.mkdirSync(requestsDir, { recursive: true });
  fs.mkdirSync(responsesDir, { recursive: true });

  const entries = commands.map((c) => {
    const id = randomUUID();
    const command = c.command;
    const args = c.args ?? {};
    fs.writeFileSync(
      path.join(requestsDir, `${id}.json`),
      JSON.stringify({ id, command, args }, null, 2),
      "utf8"
    );
    return { id, command, args };
  });

  let { results, pending } = await waitForResponses(entries, responsesDir, initialWaitMs);
  if (pending.size > 0) {
    runBatch(bridgeRoot, projectRoot, capabilitiesPath);
    const second = await waitForResponses(
      entries.filter((e) => pending.has(e.id)),
      responsesDir,
      Math.max(5000, timeoutMs - (Date.now() - t0))
    );
    for (const [id, res] of second.results) results.set(id, res);
    pending = second.pending;
  }

  const ordered = entries.map((e) => {
    const response = results.get(e.id);
    if (!response) {
      return {
        command: e.command,
        ok: false,
        error: "timeout",
        data: null,
      };
    }
    return {
      command: e.command,
      ok: response.ok,
      error: response.error ?? null,
      data: response.data ?? null,
      id: e.id,
    };
  });

  const ok = ordered.every((r) => r.ok);
  return {
    ok,
    results: ordered,
    elapsedMs: Date.now() - t0,
    timedOut: pending.size,
  };
}
