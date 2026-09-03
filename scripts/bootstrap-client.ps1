param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$ClientRelPath = "agent-kit-client",
    [ValidateSet("cursor", "claude-code", "both")]
    [string]$HostName = "cursor",
    [string]$ProjectName = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$clientRoot = Join-Path $ProjectRoot $ClientRelPath
if (-not (Test-Path (Join-Path $clientRoot "README.md"))) {
    throw "agent-kit-client not found at $clientRoot"
}
if (-not $ProjectName) {
    $ProjectName = Split-Path $ProjectRoot -Leaf
}

$hosts = @()
if ($HostName -eq "both") { $hosts = @("cursor", "claude-code") } else { $hosts = @($HostName) }

$cursorDir = Join-Path $ProjectRoot ".cursor"
$agentKitDir = Join-Path $cursorDir "agent-kit"
$skillsRoot = Join-Path $cursorDir "skills"
New-Item -ItemType Directory -Force -Path $skillsRoot | Out-Null
New-Item -ItemType Directory -Force -Path $agentKitDir | Out-Null

function Install-CoreSkill {
    $coreSrc = Join-Path $clientRoot "skills\agent-kit-runtime"
    $coreDst = Join-Path $skillsRoot "agent-kit-runtime"
    if (Test-Path $coreDst) { Remove-Item $coreDst -Recurse -Force }
    Copy-Item $coreSrc $coreDst -Recurse -Force
    Write-Host "skill agent-kit-runtime"
    $legacy = Join-Path $skillsRoot "unity-agent-runtime"
    if (Test-Path $legacy) { Remove-Item $legacy -Recurse -Force }
}

function Install-Stubs {
    $stubsRoot = Join-Path $clientRoot "skills\_stubs"
    Get-ChildItem $stubsRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $dst = Join-Path $skillsRoot $_.Name
        if (-not (Test-Path $dst)) {
            Copy-Item $_.FullName $dst -Recurse -Force
            Write-Host "stub -> $($_.Name)"
        }
    }
}

function Ensure-License {
    $licenseDst = Join-Path $cursorDir "agent-kit-license.json"
    if (-not (Test-Path $licenseDst)) {
        Copy-Item (Join-Path $clientRoot "license\license.example.json") $licenseDst -Force
        Write-Host "Created $licenseDst"
    }
}

function Write-CursorMcp {
    $tmpl = Join-Path $clientRoot "setup\cursor\mcp.json.template"
    $dst = Join-Path $cursorDir "mcp.json"
    if (-not (Test-Path $dst)) {
        Copy-Item $tmpl $dst -Force
        Write-Host "wrote .cursor/mcp.json (agent-kit-client tip)"
    } else {
        Write-Host "keep existing .cursor/mcp.json (merge agent-kit-client manually if needed)"
    }
}

function Write-ClaudeMcp {
    $tmpl = Join-Path $clientRoot "setup\claude-code\mcp.json.template"
    $dst = Join-Path $ProjectRoot ".mcp.json"
    if (-not (Test-Path $dst)) {
        Copy-Item $tmpl $dst -Force
        Write-Host "wrote .mcp.json"
    } else {
        Write-Host "keep existing .mcp.json"
    }
    $claudeTmpl = Join-Path $clientRoot "setup\claude-code\CLAUDE.md.template"
    $claudeDst = Join-Path $ProjectRoot "CLAUDE.md"
    if (-not (Test-Path $claudeDst)) {
        $text = (Get-Content $claudeTmpl -Raw) -replace '\{\{PROJECT_NAME\}\}', $ProjectName
        Set-Content $claudeDst -Value $text -Encoding UTF8
        Write-Host "wrote CLAUDE.md"
    }
}

Install-CoreSkill
Install-Stubs
Ensure-License
Copy-Item (Join-Path $clientRoot "registry\commercial-packs.json") (Join-Path $agentKitDir "commercial-packs.json") -Force

foreach ($h in $hosts) {
    if ($h -eq "cursor") { Write-CursorMcp }
    if ($h -eq "claude-code") { Write-ClaudeMcp }
}

$status = [ordered]@{
    bootstrappedAt = (Get-Date).ToString("o")
    clientPath     = $ClientRelPath
    hosts          = $hosts
    mode           = "client-tip"
    phase          = "1"
    next           = "sync-entitled.ps1"
}
$status | ConvertTo-Json | Set-Content (Join-Path $agentKitDir "bootstrap-status.json") -Encoding UTF8
Write-Host "bootstrap-client OK hosts=$($hosts -join ',') -> .cursor/agent-kit/"
Write-Host "Then: npm install in agent-kit-client/mcp/agent-kit-client ; Reload MCP"
