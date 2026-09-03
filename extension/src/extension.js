"use strict";

const vscode = require("vscode");
const { initAgentKitToWorkspace, readLocalStatus, resolvePaths } = require("./applyCore");

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
  <p class="muted">One-click offline init: core + Unity MCP + PKE + ISR tools. No portal required for free tier.</p>

  <div class="card">
    <div class="muted">Workspace status</div>
    <div id="localStatus">—</div>
  </div>

  <div class="card">
    <div class="muted">Hosts to wire</div>
    <label><input type="checkbox" id="hostCursor" checked /> Cursor</label>
    <label style="margin-left:0.75rem"><input type="checkbox" id="hostClaude" /> Claude Code</label>
    <div class="row">
      <button class="primary" id="btnInit">Init Agent Kit</button>
      <button class="ghost" id="btnRefresh">Refresh</button>
    </div>
    <div id="status"></div>
  </div>

  <div class="card">
    <div class="muted">Pro / Studio (optional)</div>
    <p class="muted" style="margin:0.4rem 0">VFX, Builder, Shader still use your account portal.</p>
    <label for="licenseApi">License API</label>
    <input id="licenseApi" placeholder="https://license.example.com" value="${escapeHtml(state.licenseApi)}" />
    <div class="row">
      <button class="ghost" id="btnPortal">Open account page</button>
    </div>
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
        "Tip MCP: " + (s.hasTipMcp ? "yes" : "no") + " · Unity MCP: " + (s.hasUnityMcp ? "yes" : "no") + "<br/>" +
        "Init: " + (s.initSource || "—");
    }
    window.addEventListener("message", (e) => {
      const m = e.data || {};
      if (m.type === "localStatus") renderLocal(m.status);
      if (m.type === "applyResult") {
        $("btnInit").disabled = false;
        $("btnInit").textContent = "Init Agent Kit";
        if (m.ok) setStatus("Init OK.\\n" + (m.summary || ""), true);
        else setStatus(m.error || "Init failed", false);
        if (m.status) renderLocal(m.status);
      }
      if (m.type === "busy") {
        $("btnInit").disabled = true;
        $("btnInit").textContent = "Initializing…";
        setStatus("Copying free bundle into this project…", null);
      }
    });
    $("btnInit").onclick = () => {
      const hosts = [];
      if ($("hostCursor").checked) hosts.push("cursor");
      if ($("hostClaude").checked) hosts.push("claude-code");
      if (!hosts.length) hosts.push("cursor");
      vscode.postMessage({ type: "init", hosts });
    };
    $("btnRefresh").onclick = () => vscode.postMessage({ type: "refresh" });
    $("btnPortal").onclick = () => vscode.postMessage({
      type: "openPortal",
      licenseApi: $("licenseApi").value.trim()
    });
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
        const api = (msg.licenseApi || cfg().licenseApi || "").replace(/\/$/, "");
        if (!api) {
          vscode.window.showWarningMessage(
            "Set License API in the panel (Pro portal only)."
          );
          return;
        }
        const pathSuffix = cfg().portalPath || "/app";
        await vscode.env.openExternal(vscode.Uri.parse(api + pathSuffix));
        return;
      }
      if (msg.type === "init") {
        await this.runInit(msg.hosts);
      }
    });
  }

  postLocalStatus() {
    const folder = workspaceFolder();
    const status = folder ? readLocalStatus(folder) : null;
    this._view?.webview.postMessage({ type: "localStatus", status });
  }

  async runInit(hosts) {
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
    try {
      const result = await initAgentKitToWorkspace({
        extensionPath: this._context.extensionPath,
        workspaceFolder: folder,
        hosts: hosts && hosts.length ? hosts : ["cursor"],
      });
      const status = readLocalStatus(folder);
      if (!result.ok) {
        const err = result.error || result.hint || JSON.stringify(result);
        this._view?.webview.postMessage({
          type: "applyResult",
          ok: false,
          error: String(err),
          status,
        });
        vscode.window.showErrorMessage("Agent Kit init failed: " + err);
        return;
      }
      const summary = [
        `packs: ${(result.packs || []).join(", ")}`,
        `skills: ${(result.skillsInstalled || []).length}`,
        `hosts: ${(result.hosts || []).join(", ")}`,
        result.next || "Reload MCP",
      ].join("\n");
      this._view?.webview.postMessage({
        type: "applyResult",
        ok: true,
        summary,
        status,
      });
      vscode.window.showInformationMessage(
        "Agent Kit initialized. Reload MCP, then use agent_kit_client_status / unity_ping."
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
        "Agent Kit init error: " + (e?.message || e)
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
      await provider.runInit(["cursor"]);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("agentKitUnity.init", async () => {
      await provider.runInit(["cursor"]);
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
