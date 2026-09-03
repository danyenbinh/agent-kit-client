/**
 * Pillar 1 — compile + playmode verify orchestration (bridge-first).
 */
import fs from "node:fs";
import path from "node:path";
import { invokeBridgeBatch } from "./invoke-bridge-batch.mjs";

const CAPTURE_DIR = path.join(".cursor", "unity-bridge", "captures");
const VERIFY_CONFIG = path.join(".cursor", "verify-config.json");
const MAX_ERROR_LINES = 25;
const MAX_RESPONSE_CHARS = 4000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function verifyConfigPath(projectRoot) {
  return path.join(projectRoot, VERIFY_CONFIG);
}

export function loadVerifyConfig(projectRoot) {
  const p = verifyConfigPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function truncateErrors(errors, limit = MAX_ERROR_LINES) {
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, limit);
}

export function countPlaymodeErrors(entries) {
  if (!Array.isArray(entries)) return 0;
  return entries.filter((e) => {
    const t = String(e?.type ?? "");
    return t === "Error" || t === "Exception" || t === "Assert";
  }).length;
}

export function parseCompileResult(batchResult) {
  const consoleRes = batchResult.results?.find((r) => r.command === "console_errors");
  const editorRes = batchResult.results?.find((r) => r.command === "editor_state");
  const ce = consoleRes?.data?.consoleErrors;
  const compiling = editorRes?.data?.editorState?.isCompiling === true;
  const errors = ce?.lines ?? [];
  const ok =
    !compiling &&
    consoleRes?.ok !== false &&
    ce?.compileStatus === "ok" &&
    (ce?.count ?? 0) === 0;
  return { ok, compiling, errors, compileStatus: ce?.compileStatus ?? "unknown" };
}

export function saveCapturePng(projectRoot, pngBase64) {
  if (!pngBase64) return null;
  const dir = path.join(projectRoot, CAPTURE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  const full = path.join(dir, name);
  fs.writeFileSync(full, Buffer.from(pngBase64, "base64"));
  return path.join(CAPTURE_DIR, name).replace(/\\/g, "/");
}

export function buildVerdict({ compile, playmode, capturePath, elapsedMs, skippedPlaymode }) {
  let verdict = "pass";
  if (!compile?.ok) verdict = "fail_compile";
  else if (skippedPlaymode) verdict = "pass";
  else if (playmode?.timedOut) verdict = "timeout";
  else if ((playmode?.errorCount ?? 0) > 0) verdict = "fail_playmode";

  return {
    verdict,
    compile: compile ?? { ok: false, errors: [] },
    playmode: playmode ?? { errorCount: 0, errors: [], durationSec: 0, skipped: skippedPlaymode },
    capturePath: capturePath ?? null,
    elapsedMs: elapsedMs ?? 0,
  };
}

export function formatVerdictText(verdictObj) {
  const lines = [
    `verdict=${verdictObj.verdict}`,
    `compile.ok=${verdictObj.compile?.ok}`,
    `compile.status=${verdictObj.compile?.compileStatus ?? "?"}`,
  ];
  if (verdictObj.compile?.errors?.length) {
    for (const e of truncateErrors(verdictObj.compile.errors, 10)) {
      lines.push(`compile: ${String(e).slice(0, 200)}`);
    }
  }
  if (verdictObj.playmode?.skipped) {
    lines.push("playmode=skipped (no smokeScene in verify-config)");
  } else {
    lines.push(
      `playmode.errorCount=${verdictObj.playmode?.errorCount ?? 0}`,
      `playmode.durationSec=${verdictObj.playmode?.durationSec ?? 0}`
    );
    for (const e of truncateErrors(verdictObj.playmode?.errors ?? [], 10)) {
      lines.push(`playmode: [${e.type}] ${String(e.message ?? "").slice(0, 200)}`);
    }
  }
  if (verdictObj.capturePath) lines.push(`capturePath=${verdictObj.capturePath}`);
  lines.push(`elapsedMs=${verdictObj.elapsedMs}`);
  let text = lines.join("\n");
  if (text.length > MAX_RESPONSE_CHARS) {
    text = `${text.slice(0, MAX_RESPONSE_CHARS - 20)}…(truncated)`;
  }
  return text;
}

/**
 * @param {string} projectRoot
 * @param {{ pathFilter?: string, maxPolls?: number }} options
 */
export async function verifyCompile(projectRoot, options = {}) {
  const pathFilter = options.pathFilter ?? "";
  const maxPolls = options.maxPolls ?? 3;
  const t0 = Date.now();

  for (let poll = 0; poll < maxPolls; poll++) {
    const batch = await invokeBridgeBatch(
      projectRoot,
      [
        { command: "assets_refresh", args: {} },
        { command: "editor_state", args: {} },
        {
          command: "console_errors",
          args: {
            maxEntries: "25",
            scanMode: "compileSession",
            ...(pathFilter ? { pathFilter } : {}),
          },
        },
      ],
      { timeoutMs: 60000 }
    );

    const parsed = parseCompileResult(batch);
    if (parsed.compiling && poll < maxPolls - 1) {
      await sleep(4000);
      continue;
    }

    return {
      ok: parsed.ok && batch.ok,
      errors: parsed.errors,
      compileStatus: parsed.compileStatus,
      elapsedMs: Date.now() - t0,
    };
  }

  return {
    ok: false,
    errors: ["compile verify: max polls exceeded"],
    compileStatus: "timeout",
    elapsedMs: Date.now() - t0,
  };
}

/**
 * @param {string} projectRoot
 * @param {{ scenePath?: string, waitSec?: number, capture?: boolean }} options
 */
export async function verifyPlaymode(projectRoot, options = {}) {
  const t0 = Date.now();
  const config = loadVerifyConfig(projectRoot) ?? {};
  const scenePath = options.scenePath ?? config.smokeScene;
  const waitSec = options.waitSec ?? config.playmodeWaitSec ?? 5;
  const capture = options.capture ?? config.capture ?? true;

  if (!scenePath) {
    return {
      skipped: true,
      ok: true,
      errorCount: 0,
      errors: [],
      durationSec: 0,
      elapsedMs: Date.now() - t0,
    };
  }

  const args = {
    waitSec: String(waitSec),
    capture: capture ? "true" : "false",
    clearErrorsFirst: "true",
    scenePath,
  };

  const batch = await invokeBridgeBatch(
    projectRoot,
    [{ command: "playmode_session", args }],
    { timeoutMs: 120000 }
  );

  const res = batch.results?.[0];
  const session = res?.data?.playmodeSession;
  if (!res?.ok || !session) {
    return {
      skipped: false,
      ok: false,
      errorCount: 1,
      errors: [{ type: "BridgeError", message: res?.error ?? "playmode_session failed" }],
      durationSec: 0,
      timedOut: res?.error?.includes("timeout"),
      elapsedMs: Date.now() - t0,
      capturePath: null,
    };
  }

  let capturePath = null;
  if (session.capture?.pngBase64) {
    capturePath = saveCapturePng(projectRoot, session.capture.pngBase64);
  }

  return {
    skipped: false,
    ok: session.ok === true,
    errorCount: session.errorCount ?? countPlaymodeErrors(session.errors),
    errors: session.errors ?? [],
    durationSec: session.durationSec ?? 0,
    timedOut: session.timedOut === true,
    elapsedMs: Date.now() - t0,
    capturePath,
  };
}

/**
 * Full verify: compile then optional playmode from verify-config.
 */
export async function runVerifyLoop(projectRoot, options = {}) {
  const t0 = Date.now();
  const config = loadVerifyConfig(projectRoot) ?? {};
  const pathFilter = options.pathFilter ?? config.pathFilter ?? "";

  const compile = await verifyCompile(projectRoot, {
    pathFilter,
    maxPolls: options.maxPolls ?? 3,
  });

  if (!compile.ok) {
    return buildVerdict({
      compile,
      playmode: null,
      capturePath: null,
      elapsedMs: Date.now() - t0,
      skippedPlaymode: true,
    });
  }

  const playmode = await verifyPlaymode(projectRoot, {
    scenePath: options.scenePath,
    waitSec: options.waitSec,
    capture: options.capture,
  });

  return buildVerdict({
    compile,
    playmode,
    capturePath: playmode.capturePath,
    elapsedMs: Date.now() - t0,
    skippedPlaymode: playmode.skipped === true,
  });
}
