# Agent Kit for Unity

**Make your AI coding agent actually useful on a real Unity game — fewer wrong files, fewer broken compiles, faster answers.**

Most AI helpers only see open tabs and a vague chat. **Agent Kit for Unity** gives **Cursor** and **Claude Code** the same project toolkit: skills + MCP that understand *your* Unity layout — so the agent finds the right script, prefab, and compile path instead of guessing.

Free to install. You click **Apply** once. No Unity Editor rewrite. No new IDE. Same packs whether you live in Cursor chat or Claude Code.

---

### Built for Cursor **and** Claude Code

Agent Kit is **host-friendly by design** — not locked to one chat product.

| Host | How Agent Kit helps |
|------|---------------------|
| **Cursor** | Side panel **Apply free packs** wires `.cursor/mcp.json` + skills; your Cursor agent gets tip MCP (`agent_kit_*`), PKE, and Unity bridge tools in the same workspace you already use |
| **Claude Code** | Same entitled packs sync into the Claude Code MCP layout (`.mcp.json` / project bootstrap); keep using Claude for long refactors while tools still see your Unity index and compile gate |
| **Both on one project** | One license · one Apply / sync · shared `.cursor` skills — switch host without re-learning a different “Unity AI” product |

**Why that matters:** studios often mix Cursor for day-to-day edits and Claude Code for deep passes. Agent Kit keeps **one Unity-aware toolkit** under both, instead of two incompatible setups.

This VS Code/Cursor extension is the easiest on-ramp on Cursor; Claude Code users can use the same [agent-kit-client](https://github.com/danyenbinh/agent-kit-client) bootstrap / sync scripts for the identical free packs.

---

### What you get day-to-day (free)

**1. Stop blind search across the whole repo**  
PKE (Project Knowledge Engine) builds a live index of C# types, modules, and prefab fingerprints. In Cursor or Claude Code, the agent can ask “where is this manager?” or “what references this prefab?” without dumping thousands of lines into context.

**2. Safer Unity changes**  
Basic Unity MCP (bridge) lets the agent **ping the Editor**, run a **compile check**, and verify playmode-related paths when Unity is open — so “I fixed it” is backed by a real compile, not vibes. Works from whichever host is calling the tools.

**3. Less setup friction for the whole team**  
Cursor: one side panel → **Apply free packs**. Claude Code: same packs via client bootstrap/sync. New hires get the same agent toolkit without hunting wiki pages.

**4. Better prompts, less token waste**  
With an index + structured tools, Cursor and Claude prefer short targeted queries over “read every `.cs` under Assets”. Clearer answers, fewer context overflows on big games.

**5. Capabilities for your agent — not another chatbot**  
We don’t replace Cursor or Claude. We **add Unity-aware MCP + skills** so the agent you already pay for works better on *this* repo.

**6. Clear upgrade path when you need content tools**  
Free covers “understand & verify the project” on both hosts. VFX catalogs, Builder recipes, or Shader Graph helpers unlock on the Agent Kit portal — same workflow, more packs.

---

### Concrete jobs it helps with

| Job | How free Agent Kit helps |
|-----|---------------------------|
| “Where is battle pass / boot / room UI code?” | PKE module / type lookup instead of repo-wide grep (Cursor **or** Claude Code) |
| “Did this C# change even compile?” | Unity bridge compile / verify tools from either host |
| “Wire MCP the same on every machine” | Apply (Cursor) or sync scripts (Claude Code) → consistent project setup |
| “Dev uses Cursor, lead uses Claude Code” | Shared packs + license — same project map for both |
| “Onboard a contractor to our Unity repo” | Same key + Apply/sync; agent already has project map |
| “Debug missing refs / prefab wiring” | Prefab fingerprints + index (when packs applied) |
| “Keep AI from editing the wrong assembly” | Index-first discipline before wide file reads |

---

### What’s in the free Apply

| Pack | Useful for |
|------|------------|
| **core** | License, tip MCP (`agent_kit_*`), **Cursor + Claude Code** host wiring |
| **unity-runtime** | Editor bridge basics — ping, compile, verify |
| **pke** | Live C# / prefab / reference index |

**Not in free (Pro / Studio):** VFX catalog, Builder recipes, Shader Graph, Figma→HUD, Review cloud.

---

### Quick start (Cursor)

1. Open your **Unity project folder** as the workspace  
2. Install this extension → open **Agent Kit for Unity** in the activity bar  
3. Set **License API** (HTTPS) + **Core license key**  
4. Click **Apply free packs**  
5. Reload MCP if prompted · open Unity with Bridge when you need compile/ping  

### Claude Code

Use the same free packs from [agent-kit-client](https://github.com/danyenbinh/agent-kit-client) (`bootstrap-client` / `sync-entitled` with Claude Code host) — identical `core` + `unity-runtime` + `pke` entitlements.

**Requires:** Node.js 18+ on `PATH`.

---

### Privacy

- No telemetry from this extension  
- Network only when you press **Apply free packs**, only to *your* license API  
- May run a one-time `npm install` in the bundled tip MCP folder (`adm-zip`)  

---

### Links

- [agent-kit-client on GitHub](https://github.com/danyenbinh/agent-kit-client) · [Issues](https://github.com/danyenbinh/agent-kit-client/issues)  
- License: MIT — [LICENSE](LICENSE)
