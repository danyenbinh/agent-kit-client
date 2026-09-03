param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$ClientRelPath = "agent-kit-client",
    [string]$CloudRelPath = "agent-kit-cloud",
    [string]$DistRoot = "",
    [ValidateSet("cursor", "claude-code", "both")]
    [string]$HostName = "both",
    [string]$LicensePath = "",
    [switch]$EnforceStrict
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$clientRoot = Join-Path $ProjectRoot $ClientRelPath
$cloudRoot = Join-Path $ProjectRoot $CloudRelPath
if (-not $DistRoot) {
    $DistRoot = Join-Path $cloudRoot "dist"
} else {
    $DistRoot = (Resolve-Path $DistRoot).Path
}

if (-not $LicensePath) {
    $LicensePath = Join-Path $ProjectRoot ".cursor\agent-kit-license.json"
}
if (-not (Test-Path $LicensePath)) {
    throw "Missing license: $LicensePath"
}

$license = Get-Content $LicensePath -Raw -Encoding UTF8 | ConvertFrom-Json
$api = if ($license.licenseApi) { $license.licenseApi.TrimEnd("/") } else { "http://localhost:8787" }
$key = $license.key
Write-Host "Entitlements from $api key=$key"

$entJson = $null
try {
    $entJson = Invoke-RestMethod -Uri "$api/v1/entitlements?key=$([uri]::EscapeDataString($key))" -Method Get
} catch {
    Write-Warning "License API unreachable ($($_.Exception.Message)). Using local fallback."
}

# Expire check
if ($entJson -and $entJson.expiresAt) {
    $exp = [datetime]::Parse($entJson.expiresAt)
    if ((Get-Date).ToUniversalTime() -gt $exp.ToUniversalTime()) {
        throw "License expired at $($entJson.expiresAt)"
    }
}

$packs = @()
if ($entJson -and $entJson.packs) {
    $packs = @($entJson.packs)
} elseif ($license.installedPacks -and $license.installedPacks.Count -gt 0) {
    $packs = @($license.installedPacks)
} else {
    $packs = @("core")
    Write-Host "Dev fallback packs=core"
}

# Drop planned-only packs if somehow listed
$packs = @($packs | Where-Object { $_ -and $_ -ne "unity-runtime-planned" })

$skillsRoot = Join-Path $ProjectRoot ".cursor\skills"
$installedDir = Join-Path $ProjectRoot ".cursor\agent-kit\installed"
New-Item -ItemType Directory -Force -Path $installedDir | Out-Null
New-Item -ItemType Directory -Force -Path $skillsRoot | Out-Null

$neverShip = @(
    "agent-kit-promotion", "agent-core-governance", "agent-north-star",
    "agent-skill-registry", "agent-skill-lifecycle", "agent-project-orchestrator"
)

$mergedTools = New-Object System.Collections.Generic.List[string]
$mergedGroups = New-Object System.Collections.Generic.List[string]
$fragmentPacks = New-Object System.Collections.Generic.List[string]
foreach ($tip in @("agent_kit_client_status", "agent_kit_entitlements", "agent_kit_allowed_tools")) {
    [void]$mergedTools.Add($tip)
}

foreach ($packId in $packs) {
    $distZip = Join-Path $DistRoot "$packId.zip"
    $distDir = Join-Path $DistRoot $packId
    $packManifest = Join-Path $cloudRoot "packs\$packId\pack.json"
    $distMetaManifest = Join-Path $distDir "meta\pack.json"
    if (-not (Test-Path $packManifest) -and (Test-Path $distMetaManifest)) {
        $packManifest = $distMetaManifest
    }

    if (-not (Test-Path $packManifest)) {
        Write-Warning "No pack manifest for '$packId' - skip"
        continue
    }
    $manifest = Get-Content $packManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.status -eq "planned") {
        Write-Warning "Pack '$packId' still planned - skip"
        continue
    }

    if (-not (Test-Path $distDir)) {
        if (Test-Path $distZip) {
            Expand-Archive -Path $distZip -DestinationPath $distDir -Force
        } elseif (Test-Path (Join-Path $cloudRoot "factory\build-pack.ps1")) {
            Write-Host "Building pack $packId..."
            & (Join-Path $cloudRoot "factory\build-pack.ps1") -PackId $packId -CloudRoot $cloudRoot
        } else {
            Write-Warning "Pack '$packId' missing dist - skip"
            continue
        }
    }

    if (-not (Test-Path $distDir)) {
        Write-Warning "Pack '$packId' dist missing - skip"
        continue
    }

    $packSkills = Join-Path $distDir "skills"
    if (Test-Path $packSkills) {
        Get-ChildItem $packSkills -Directory | ForEach-Object {
            if ($neverShip -contains $_.Name) {
                Write-Warning "Blocked neverShip skill $($_.Name)"
                return
            }
            $dst = Join-Path $skillsRoot $_.Name
            if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
            Copy-Item $_.FullName $dst -Recurse -Force
            Write-Host "installed skill $($_.Name) from $packId"
        }
    }

    $fragPath = Join-Path $distDir "meta\mcp-fragment.json"
    if (Test-Path $fragPath) {
        $frag = Get-Content $fragPath -Raw -Encoding UTF8 | ConvertFrom-Json
        [void]$fragmentPacks.Add($packId)
        foreach ($g in @($frag.toolGroups)) {
            if ($g -and -not $mergedGroups.Contains([string]$g)) { [void]$mergedGroups.Add([string]$g) }
        }
        foreach ($t in @($frag.tools)) {
            $ts = [string]$t
            if ($ts -and -not $mergedTools.Contains($ts)) { [void]$mergedTools.Add($ts) }
        }
        Write-Host "merged mcp-fragment $packId tools+=$(@($frag.tools).Count)"
    }

    $bridgeMarker = Join-Path $distDir "reference"
    if (Test-Path $bridgeMarker) {
        $markBridge = Join-Path $installedDir "$packId.bridge.json"
        [ordered]@{
            packId = $packId
            bridgePresentInDist = $true
            note = "Run Unity setup / copy-bridge from dist when adopting unity-runtime"
        } | ConvertTo-Json | Set-Content $markBridge -Encoding UTF8
    }

    $mark = Join-Path $installedDir "$packId.json"
    [ordered]@{
        packId      = $packId
        platform    = $manifest.platform
        hosts       = $manifest.hosts
        installedAt = (Get-Date).ToString("o")
        version     = $manifest.version
        label       = $manifest.label
    } | ConvertTo-Json | Set-Content $mark -Encoding UTF8
}

# Phase 2: write merged MCP allowlist + advisory tool profile
# Phase 3: allowlist - strict when Unity Pro/Studio tool set large enough, or -EnforceStrict
$enforce =
    if ($env:AGENT_KIT_ALLOWLIST_ADVISORY -eq "1") { "advisory" }
    elseif ($EnforceStrict -or $env:AGENT_KIT_ENFORCE_STRICT -eq "1") { "strict" }
    elseif ($mergedTools.Count -ge 10) { "strict" }
    else { "advisory" }

$allowlist = [ordered]@{
    version     = 1
    phase       = 3
    skuHint     = if ($packs -contains "shadergraph" -or $packs -contains "builder" -or $packs -contains "figma-hud") { "unity-studio" } elseif ($packs -contains "pke" -and $packs -contains "vfx") { "unity-pro" } else { "custom" }
    packs       = @($fragmentPacks)
    toolGroups  = @($mergedGroups)
    tools       = @($mergedTools)
    updatedAt   = (Get-Date).ToString("o")
    enforcement = $enforce
    note        = "strict: entitled Unity MCP filters tools/list + blocks unauthorized calls"
}
$allowPath = Join-Path $ProjectRoot ".cursor\agent-kit\mcp-allowlist.json"
$allowlist | ConvertTo-Json -Depth 5 | Set-Content $allowPath -Encoding UTF8
Write-Host "wrote $allowPath tools=$($mergedTools.Count)"

$profilePath = Join-Path $ProjectRoot ".cursor\agent-tool-profile.json"
$profile = [ordered]@{
    profile      = if ($mergedGroups -contains "editor-bridge") { "full" } else { "code" }
    enforcement  = "advisory"
    source       = "agent-kit-sync-entitled"
    suggestedTools = @($mergedTools)
    updatedAt    = (Get-Date).ToString("o")
}
$profile | ConvertTo-Json -Depth 5 | Set-Content $profilePath -Encoding UTF8
Write-Host "wrote $profilePath (advisory)"

# Install Unity MCP from unity-runtime dist (V1 - zero kit-dev on customer disk)
$unityMcpRel = ".cursor/agent-kit/mcp/unity-agent-mcp/index.mjs"
$unityMcpInstalled = $false
$runtimeDistMcp = Join-Path $DistRoot "unity-runtime\mcp\unity-agent-mcp"
if ($packs -contains "unity-runtime" -and (Test-Path $runtimeDistMcp)) {
    $mcpDst = Join-Path $ProjectRoot ".cursor\agent-kit\mcp\unity-agent-mcp"
    New-Item -ItemType Directory -Force -Path (Split-Path $mcpDst -Parent) | Out-Null
    if (Test-Path $mcpDst) { Remove-Item $mcpDst -Recurse -Force }
    Copy-Item $runtimeDistMcp $mcpDst -Recurse -Force
    $unityMcpInstalled = $true
    Write-Host "installed Unity MCP -> $mcpDst (run npm install there once)"
}

# Entitled mcp hint (customer projects) - never points at kit-dev
$hintPath = Join-Path $ProjectRoot ".cursor\agent-kit\mcp.entitled.hint.json"
[ordered]@{
    tipServer = @{
        command = "node"
        args    = @("agent-kit-client/mcp/agent-kit-client/index.mjs")
        env     = @{ AGENT_PROJECT_ROOT = "`${workspaceFolder}"; AGENT_KIT_ALLOWLIST = ".cursor/agent-kit/mcp-allowlist.json" }
    }
    unityServerWhenEntitled = @{
        note = if ($unityMcpInstalled) {
            "Merge into .cursor/mcp.json / .mcp.json. npm install in .cursor/agent-kit/mcp/unity-agent-mcp"
        } else {
            "Entitled unity-runtime sync installs MCP under .cursor/agent-kit/mcp/unity-agent-mcp - do not use kit-dev"
        }
        args = @($unityMcpRel)
        env  = @{ AGENT_PROJECT_ROOT = "`${workspaceFolder}"; AGENT_KIT_ALLOWLIST = ".cursor/agent-kit/mcp-allowlist.json" }
        installed = $unityMcpInstalled
    }
    installedUnityPacks = @($packs | Where-Object { $_ -in @("unity-runtime","pke","vfx","shadergraph","figma-hud","builder") })
} | ConvertTo-Json -Depth 6 | Set-Content $hintPath -Encoding UTF8


if ($entJson) {
    function Set-LicProp([string]$Name, $Value) {
        if ($null -eq $Value) { return }
        if ($license.PSObject.Properties.Name -contains $Name) {
            $license.$Name = $Value
        } else {
            $license | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
        }
    }
    Set-LicProp "org" $entJson.org
    Set-LicProp "seats" $entJson.seats
    Set-LicProp "platforms" $entJson.platforms
    Set-LicProp "expiresAt" $entJson.expiresAt
    Set-LicProp "plan" $entJson.plan
}
$license.installedPacks = @($packs)
if ($license.PSObject.Properties.Name -contains "host") {
    $license.host = $HostName
} else {
    $license | Add-Member -NotePropertyName "host" -NotePropertyValue $HostName -Force
}
$license | ConvertTo-Json -Depth 6 | Set-Content $LicensePath -Encoding UTF8
Write-Host "sync-entitled OK packs=$($packs -join ',') host=$HostName"
