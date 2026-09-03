# Agent Kit for Unity

VS Code / Cursor **workspace helper** for Unity projects that use [Agent Kit](https://github.com/danyenbinh/agent-kit-client).

## What it does

1. Opens a side panel in the activity bar  
2. On **Apply free packs** (explicit user action):  
   - Writes `.cursor/agent-kit-license.json`  
   - Downloads **core** + **unity-runtime** (basic Unity MCP) + **pke**  
   - Installs `agent-kit-runtime` and wires tip MCP into `.cursor/mcp.json`  
   - Enables **ISR** usage via meta tools (`agent_record_turn`) when Unity MCP is present  

**Not included (Pro / Studio):** VFX, Builder, Shader Graph, Figma HUD, Review cloud.

## Requirements

- Folder workspace  
- Node.js 18+ on `PATH`  
- Agent Kit license API (HTTPS) + Core license key (`dev-core` on local vendor API includes free packs)

## Privacy & network

- No telemetry by this extension.  
- Network only on **Apply free packs**, to your configured `agentKit.licenseApi`.  
- May run `npm install` once in the bundled tip MCP folder (`adm-zip`).  

## Support

https://github.com/danyenbinh/agent-kit-client/issues

## License

MIT — see [LICENSE](LICENSE).
