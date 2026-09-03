# Agent Kit for Unity

**One command. No portal. Free Unity agent toolkit for Cursor and Claude Code.**

Install this extension (or clone [agent-kit-client](https://github.com/danyenbinh/agent-kit-client)), open your Unity project, then:

### Cursor

1. Command Palette → **Agent Kit for Unity: Init into project**  
   — or open the side panel → **Init Agent Kit**  
2. Reload MCP  
3. In chat: `agent_kit_init` already done — try `agent_kit_client_status`, `unity_ping`, `agent_get_index_health`, `agent_record_turn`

### Claude Code / git client

```powershell
# from repo that contains agent-kit-client (or pass -ProjectRoot)
pwsh -File agent-kit-client/scripts/init-agent-kit.ps1 -HostName both
```

Or in Claude (after tip MCP is available): call MCP **`agent_kit_init`** with `hosts: ["cursor","claude-code"]`.

---

### What Init installs (offline, bundled)

| Piece | Why it helps |
|-------|----------------|
| **core** | Tip MCP + license stub |
| **unity-runtime MCP** | Bridge ping / compile / verify + ISR meta |
| **pke MCP modules** | Live C# / prefab index (less blind Grep) |

**Not in free (separate pack MCP):** VFX · Builder · Shader Graph · Figma HUD. Those modules ship only inside their Pro/Studio pack zips and merge on Apply.

---

### Built for Cursor and Claude Code

Same free packs on both hosts — one init, shared project map. Studios can mix Cursor day-to-day and Claude Code for deep refactors without two toolchains.

---

### Privacy

- Free **Init** does **not** call the network (copies from the bundled free pack).  
- Optional **Open account page** only if you set a License API (Pro upgrades).  
- May run local `npm install` once inside bundled MCP folders.

---

### Links

- [GitHub](https://github.com/danyenbinh/agent-kit-client) · [Issues](https://github.com/danyenbinh/agent-kit-client/issues)  
- MIT — [LICENSE](LICENSE)
