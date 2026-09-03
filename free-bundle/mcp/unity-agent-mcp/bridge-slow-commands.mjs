/** Bridge commands that may exceed default 8s editor poll wait. */
export const SLOW_BRIDGE_COMMANDS = new Set([
  "rebuild_code_index",
  "rebuild_reference_index",
  "refresh_build_scene_index",
  "tests_run",
  "prefab_audit",
  "playmode_session",
  "playmode_enter",
]);

export const SLOW_BRIDGE_WAIT_MS = 120_000;

export function bridgeWaitMsForCommand(command) {
  return SLOW_BRIDGE_COMMANDS.has(command) ? SLOW_BRIDGE_WAIT_MS : 8_000;
}

export function batchNeedsSlowTimeout(commands) {
  if (!Array.isArray(commands)) return false;
  return commands.some((c) => SLOW_BRIDGE_COMMANDS.has(c?.command));
}

export function effectiveBatchTimeoutMs(commands, timeoutMs = 60_000) {
  return batchNeedsSlowTimeout(commands) ? Math.max(timeoutMs, SLOW_BRIDGE_WAIT_MS) : timeoutMs;
}

export function summarizeIndexHealth(indexHealth) {
  if (!indexHealth) return null;
  const lines = [
    `indexHealth fresh=${indexHealth.fresh} files=${indexHealth.csharpFiles ?? 0} types=${indexHealth.types ?? 0}`,
  ];
  if (indexHealth.lastTriggerReason) lines.push(`trigger=${indexHealth.lastTriggerReason}`);
  if (indexHealth.error) lines.push(`indexError=${indexHealth.error}`);
  return lines.join(" ");
}
