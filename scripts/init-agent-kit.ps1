<#
.SYNOPSIS
  Offline init Agent Kit free tier into the current Unity/game project.
  No portal / web Apply required for core + unity-runtime + pke.
#>
param(
  [string]$ProjectRoot = "",
  [ValidateSet("cursor", "claude-code", "both")]
  [string]$HostName = "both"
)

$ErrorActionPreference = "Stop"
$clientRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $clientRoot "..")).Path
}
$ProjectRoot = (Resolve-Path $ProjectRoot).Path

$bundle = Join-Path $clientRoot "free-bundle\MANIFEST.json"
if (-not (Test-Path $bundle)) {
  Write-Host "Building free-bundle from cloud dist..."
  & node (Join-Path $clientRoot "scripts\sync-free-bundle.mjs")
  if ($LASTEXITCODE -ne 0) { throw "sync-free-bundle failed" }
}

$hostsJson = '["cursor"]'
if ($HostName -eq "claude-code") { $hostsJson = '["claude-code"]' }
if ($HostName -eq "both") { $hostsJson = '["cursor","claude-code"]' }

$initJs = Join-Path $clientRoot "mcp\agent-kit-client\init-free.mjs"
$payload = @{
  projectRoot = $ProjectRoot
  clientRoot = $clientRoot
  hosts = ($hostsJson | ConvertFrom-Json)
} | ConvertTo-Json -Compress

# Avoid PowerShell mangling JSON — write temp file
$tmp = Join-Path $env:TEMP ("akit-init-" + [guid]::NewGuid().ToString() + ".json")
Set-Content -Path $tmp -Value (@{
  projectRoot = $ProjectRoot
  clientRoot = $clientRoot
  hosts = if ($HostName -eq "claude-code") { @("claude-code") } elseif ($HostName -eq "both") { @("cursor", "claude-code") } else { @("cursor") }
} | ConvertTo-Json -Compress) -Encoding utf8

& node --input-type=module -e "import fs from 'node:fs'; import { initFreeBundleToProject } from process.argv[1]; const o = JSON.parse(fs.readFileSync(process.argv[2],'utf8')); console.log(JSON.stringify(initFreeBundleToProject(o.projectRoot,{ clientRoot:o.clientRoot, hosts:o.hosts }),null,2));" $initJs $tmp
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Next: Reload MCP in Cursor and/or Claude Code."
Write-Host "Try: agent_kit_client_status | unity_ping | agent_get_index_health | agent_record_turn"
