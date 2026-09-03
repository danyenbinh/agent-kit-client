param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$ClientRelPath = "agent-kit-client"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$clientRoot = Join-Path $ProjectRoot $ClientRelPath
if (-not (Test-Path (Join-Path $clientRoot "README.md"))) {
    throw "agent-kit-client not found at $clientRoot"
}

$cursor = Join-Path $ProjectRoot ".cursor"
$skills = Join-Path $cursor "skills"
$licenseDst = Join-Path $cursor "agent-kit-license.json"
New-Item -ItemType Directory -Force -Path $skills | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $cursor "agent-kit") | Out-Null

# Core runtime skill
$coreSrc = Join-Path $clientRoot "skills\unity-agent-runtime"
$coreDst = Join-Path $skills "unity-agent-runtime"
if (Test-Path $coreDst) { Remove-Item $coreDst -Recurse -Force }
Copy-Item $coreSrc $coreDst -Recurse -Force

# Stubs for unpurchased packs
$stubsRoot = Join-Path $clientRoot "skills\_stubs"
Get-ChildItem $stubsRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $dst = Join-Path $skills $_.Name
    if (-not (Test-Path $dst)) {
        Copy-Item $_.FullName $dst -Recurse -Force
        Write-Host "stub -> $($_.Name)"
    }
}

if (-not (Test-Path $licenseDst)) {
    Copy-Item (Join-Path $clientRoot "license\license.example.json") $licenseDst -Force
    Write-Host "Created $licenseDst — điền key rồi chạy sync-entitled.ps1"
}

$packsManifest = Join-Path $clientRoot "registry\commercial-packs.json"
Copy-Item $packsManifest (Join-Path $cursor "agent-kit\commercial-packs.json") -Force

$status = [ordered]@{
    bootstrappedAt = (Get-Date).ToString("o")
    clientPath     = $ClientRelPath
    mode           = "client-tip"
    next           = "sync-entitled.ps1"
}
$status | ConvertTo-Json | Set-Content (Join-Path $cursor "agent-kit\bootstrap-status.json") -Encoding UTF8
Write-Host "bootstrap-client OK → .cursor/agent-kit/"
