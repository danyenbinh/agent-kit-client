"use strict";

const vscode = require("vscode");
const { applyCoreToWorkspace, readLocalStatus, resolvePaths } = require("./applyCore");

function cfg() {
  const c = vscode.workspace.getConfiguration("agentKit");
  return {
    licenseApi: String(c.get("licenseApi") || "").trim(),
    freeKey: String(c.get("freeKey") || "").trim(),
    portalPath: c.get("portalPath") || "/app",
  };
}

function workspaceFolder() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

function portalUrl() {
  const { licenseApi, portalPath } = cfg();
  if (!licenseApi) return null;
  return String(licenseApi).replace(/\/$/, "") + portalPath;
}

/**
 * @param {vscode.ExtensionContext} context
 */
function getWebviewHtml(webview, nonce, state) {
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Kit for Unity</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --btn: var(--vscode-button-background);
      --btnFg: var(--vscode-button-foreground);
      --btn2: var(--vscode-button-secondaryBackground);
      --btn2Fg: var(--vscode-button-secondaryForeground);
      --input: var(--vscode-input-background);
      --border: var(--vscode-panel-border, #333);
      --ok: #3ecf8e;
      --warn: #d4a35c;
    }
    body {
      font-family: var(--vscode-font-family);
      color: var(--fg);
      background: transparent;
      padding: 12px 14px 24px;
      line-height: 1.45;
      font-size: 13px;
    }
    h1 { font-size: 15px; margin: 0 0 4px; font-weight: 700; }
    .muted { color: var(--muted); font-size: 12px; }
    .card {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      margin: 12px 0;
      background: color-mix(in srgb, var(--bg) 88%, #fff 4%);
    }
    label { display: block; font-size: 11px; color: var(--muted); margin: 8px 0 4px; }
    input {
      width: 100%; box-sizing: border-box;
      background: var(--input); color: var(--fg);
      border: 1px solid var(--border); border-radius: 6px;
      padding: 7px 8px;
    }
    .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    button {
      border: none; border-radius: 6px; padding: 8px 12px;
      font-weight: 650; cursor: pointer;
    }
    button.primary { background: var(--btn); color: var(--btnFg); }
    button.ghost { background: var(--btn2); color: var(--btn2Fg); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    #status { margin-top: 10px; white-space: pre-wrap; font-size: 12px; }
    #status.ok { color: var(--ok); }
    #status.err { color: #f07178; }
    .badge {
      display: inline-block; font-size: 10px; font-weight: 700;
      padding: 2px 7px; border-radius: 999px;
      background: color-mix(in srgb, var(--warn) 25%, transparent);
      color: var(--warn);
    }
    ul { margin: 6px 0 0; padding-left: 18px; color: var(--muted); font-size: 12px; }
  </style>
</head>
<body>
  <h1>Agent Kit for Unity</h1>
  <p class="muted">Free tier: Core + basic Unity MCP + PKE (+ ISR tools). VFX / Builder / Shader stay on Pro / Studio.</p>

  <div class="card">
    <div class="muted">Workspace status</div>
    <div id="localStatus">—</div>
  </div>

  <div class="card">
    <label for="licenseApi">License API (HTTPS)</label>
    <input id="licenseApi" placeholder="https://license.example.com" value="${escapeHtml(state.licenseApi)}" />
    <label for="freeKey">Core license key</label>
    <input id="freeKey" placeholder="your-core-key" value="${escapeHtml(state.freeKey)}" />
    <div class="row">
      <button class="primary" id="btnApply">Apply free packs</button>
      <button class="ghost" id="btnRefresh">Refresh</button>
    </div>
    <div id="status"></div>
  </div>

  <div class="card">
    <div class="muted">Account</div>
    <div class="row">
      <button class="ghost" id="btnPortal">Open account page</button>
    </div>
    <ul>
      <li>Apply only contacts the license API you configure.</li>
      <li>After Apply, reload MCP if tip tools are missing.</li>
    </ul>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);
    function setStatus(t, ok) {
      const el = $("status");
      el.textContent = t || "";
      el.className = ok === true ? "ok" : ok === false ? "err" : "";
    }
    function renderLocal(s) {
      if (!s) { $("localStatus").textContent = "Open a folder workspace first."; return; }
      $("localStatus").innerHTML =
        "Packs: <code>" + ((s.installedPacks || []).join(", ") || "—") + "</code><br/>" +
        "Core: <code>" + (s.coreVersion || "—") + "</code> · " +
        "Runtime: <code>" + (s.unityRuntimeVersion || "—") + "</code> · " +
        "PKE: <code>" + (s.pkeVersion || "—") + "</code><br/>" +
        "License: " + (s.licenseKey || "—") + "<br/>" +
        "Tip MCP wired: " + (s.hasTipMcp ? "yes" : "no");
    }
    window.addEventListener("message", (e) => {
      const m = e.data || {};
      if (m.type === "localStatus") renderLocal(m.status);
      if (m.type === "applyResult") {
        $("btnApply").disabled = false;
        $("btnApply").textContent = "Apply free packs";
        if (m.ok) setStatus("Free packs applied.\\n" + (m.summary || ""), true);
        else setStatus(m.error || "Apply failed", false);
        if (m.status) renderLocal(m.status);
      }
      if (m.type === "busy") {
        $("btnApply").disabled = true;
        $("btnApply").textContent = "Applying…";
        setStatus("Downloading core + unity-runtime + pke…", null);
      }
    });
    $("btnApply").onclick = () => {
      vscode.postMessage({
        type: "applyCore",
        licenseApi: $("licenseApi").value.trim(),
        freeKey: $("freeKey").value.trim()
      });
    };
    $("btnRefresh").onclick = () => vscode.postMessage({ type: "refresh" });
    $("btnPortal").onclick = () => vscode.postMessage({ type: "openPortal" });
    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

class AgentKitUnityProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this._context = context;
    this._view = null;
  }

  /**
   * @param {vscode.WebviewView} webviewView
   */
  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };
    const nonce = String(Date.now());
    const c = cfg();
    webviewView.webview.html = getWebviewHtml(webviewView.webview, nonce, c);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === "ready" || msg.type === "refresh") {
        this.postLocalStatus();
        return;
      }
      if (msg.type === "openPortal") {
        const url = portalUrl();
        if (!url) {
          vscode.window.showWarningMessage(
            "Set agentKit.licenseApi in Settings first."
          );
          return;
        }
        await vscode.env.openExternal(vscode.Uri.parse(url));
        return;
      }
      if (msg.type === "applyCore") {
        await this.runApply(msg.licenseApi, msg.freeKey);
      }
    });
  }

  postLocalStatus() {
    const folder = workspaceFolder();
    const status = folder ? readLocalStatus(folder) : null;
    this._view?.webview.postMessage({ type: "localStatus", status });
  }

  async runApply(licenseApi, freeKey) {
    const folder = workspaceFolder();
    if (!folder) {
      vscode.window.showErrorMessage(
        "Agent Kit for Unity: open a workspace folder first."
      );
      this._view?.webview.postMessage({
        type: "applyResult",
        ok: false,
        error: "No workspace folder",
      });
      return;
    }
    this._view?.webview.postMessage({ type: "busy" });
    const api = (licenseApi || cfg().licenseApi).replace(/\/$/, "");
    const key = freeKey || cfg().freeKey;
    if (!api || !key) {
      this._view?.webview.postMessage({
        type: "applyResult",
        ok: false,
        error: "Set License API and Core license key first",
        status: readLocalStatus(folder),
      });
      vscode.window.showWarningMessage(
        "Agent Kit for Unity: set licenseApi and freeKey in Settings or the panel."
      );
      return;
    }
    if (!/^https?:\/\//i.test(api)) {
      this._view?.webview.postMessage({
        type: "applyResult",
        ok: false,
        error: "licenseApi must start with http:// or https://",
        status: readLocalStatus(folder),
      });
      return;
    }

    try {
      const result = await applyCoreToWorkspace({
        extensionPath: this._context.extensionPath,
        workspaceFolder: folder,
        key,
        licenseApi: api,
        org: "Core Free",
      });
      const status = readLocalStatus(folder);
      if (!result.ok) {
        const err =
          result.error ||
          result.apply?.error ||
          JSON.stringify(result.apply?.errors || result);
        this._view?.webview.postMessage({
          type: "applyResult",
          ok: false,
          error: String(err),
          status,
        });
        vscode.window.showErrorMessage(
          "Agent Kit for Unity — Apply Core failed: " + err
        );
        return;
      }
      const summary = [
        `installed: ${(result.apply?.installed || ["core"]).join(", ")}`,
        `core version: ${status.coreVersion || "?"}`,
        `tip MCP: ${result.mcp?.path || ""}`,
        "Reload MCP to pick up agent_kit_* tools. Upgrade Unity packs in portal.",
      ].join("\n");
      this._view?.webview.postMessage({
        type: "applyResult",
        ok: true,
        summary,
        status,
      });
      vscode.window.showInformationMessage(
        "Agent Kit for Unity: Core applied. Reload MCP if tip tools are missing."
      );
    } catch (e) {
      const status = readLocalStatus(folder);
      this._view?.webview.postMessage({
        type: "applyResult",
        ok: false,
        error: String(e?.message || e),
        status,
      });
      vscode.window.showErrorMessage(
        "Agent Kit for Unity error: " + (e?.message || e)
      );
    }
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const provider = new AgentKitUnityProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("agentKitUnity.panel", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("agentKitUnity.openPanel", async () => {
      await vscode.commands.executeCommand("agentKitUnity.panel.focus");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("agentKitUnity.applyCore", async () => {
      const c = cfg();
      await provider.runApply(c.licenseApi, c.freeKey);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("agentKitUnity.openPortal", async () => {
      const url = portalUrl();
      if (!url) {
        vscode.window.showWarningMessage(
          "Set agentKit.licenseApi in Settings first."
        );
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    })
  );

  const folder = workspaceFolder();
  if (folder) {
    const paths = resolvePaths(context.extensionPath, folder);
    if (!paths.tipMcp) {
      console.warn(
        "[agent-kit-for-unity] tip MCP missing — run npm run sync-vendor in extension/"
      );
    }
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
