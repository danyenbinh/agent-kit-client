import fs from "node:fs";
import path from "node:path";

/** Ước lượng token từ text (~3.5 char/token mixed EN/VI/code). */
export function estimateTokens(text) {
  if (!text) return 0;
  const s = typeof text === "string" ? text : JSON.stringify(text);
  return Math.max(1, Math.ceil(s.length / 3.5));
}

export function createUsageTracker(bridgeRoot) {
  const usageDir = path.join(bridgeRoot, "usage");
  const logPath = path.join(usageDir, "mcp-session.jsonl");
  const summaryPath = path.join(usageDir, "mcp-summary.json");

  function ensure() {
    fs.mkdirSync(usageDir, { recursive: true });
  }

  function record(toolName, inputText, outputText, elapsedMs = 0) {
    ensure();
    const inputTokens = estimateTokens(inputText);
    const outputTokens = estimateTokens(outputText);
    const entry = {
      ts: new Date().toISOString(),
      tool: toolName,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      elapsedMs,
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
    updateSummary(entry);
    return entry;
  }

  function updateSummary(entry) {
    let summary = {
      sessionStarted: entry.ts,
      lastUpdated: entry.ts,
      toolCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      byTool: {},
    };
    if (fs.existsSync(summaryPath)) {
      try {
        summary = { ...summary, ...JSON.parse(fs.readFileSync(summaryPath, "utf8")) };
      } catch {
        /* reset */
      }
    }
    summary.lastUpdated = entry.ts;
    summary.toolCalls += 1;
    summary.totalInputTokens += entry.inputTokens;
    summary.totalOutputTokens += entry.outputTokens;
    summary.totalTokens += entry.totalTokens;
    if (!summary.byTool[entry.tool]) {
      summary.byTool[entry.tool] = { calls: 0, totalTokens: 0 };
    }
    summary.byTool[entry.tool].calls += 1;
    summary.byTool[entry.tool].totalTokens += entry.totalTokens;
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  }

  function getSummary(lastN = 10) {
    ensure();
    let summary = null;
    if (fs.existsSync(summaryPath)) {
      summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    }
    const recent = [];
    if (fs.existsSync(logPath)) {
      const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
      for (let i = Math.max(0, lines.length - lastN); i < lines.length; i++) {
        recent.push(JSON.parse(lines[i]));
      }
    }
    return { summary, recent };
  }

  function formatReport(lastN = 5) {
    const { summary, recent } = getSummary(lastN);
    if (!summary) {
      return "MCP usage: chưa có tool call nào trong session này.";
    }
    const lines = [
      `MCP session: ${summary.toolCalls} calls | ~${summary.totalTokens} tokens (est.)`,
      `  in ~${summary.totalInputTokens} | out ~${summary.totalOutputTokens}`,
    ];
    if (recent.length) {
      lines.push("Recent:");
      for (const r of recent) {
        lines.push(`  ${r.tool}: ~${r.totalTokens} tok (${r.elapsedMs}ms)`);
      }
    }
    lines.push(
      "Note: LLM tokens (Cursor chat) xem Usage dashboard — MCP chỉ track tool I/O."
    );
    return lines.join("\n");
  }

  return { record, getSummary, formatReport, estimateTokens };
}
