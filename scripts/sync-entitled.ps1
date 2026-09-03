param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$ClientRelPath = "agent-kit-client",
    [string]$CloudRelPath = "agent-kit-cloud",
    [string]$LicensePath = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$clientRoot = Join-Path $ProjectRoot $ClientRelPath
$cloudRoot = Join-Path $ProjectRoot $CloudRelPath

if (-not $LicensePath) {
    $LicensePath = Join-Path $ProjectRoot ".cursor\agent-kit-license.json"
}
if (-not (Test-Path $LicensePath)) {
    throw "Missing license: $LicensePath — copy agent-kit-client/license/license.example.json"
}

$license = Get-Content $LicensePath -Raw | ConvertFrom-Json
$api = if ($license.licenseApi) { $license.licenseApi.TrimEnd("/") } else { "http://localhost:8787" }
$key = $license.key
Write-Host "Entitlements from $api key=$key"

$entJson = $null
try {
    $entJson = Invoke-RestMethod -Uri "$api/v1/entitlements?key=$([uri]::EscapeDataString($key))" -Method Get
} catch {
    Write-Warning "License API unreachable ($($_.Exception.Message)). Falling back to local cloud dist if present."
}

$packs = @()
if ($entJson -and $entJson.packs) {
    $packs = @($entJson.packs)
} elseif ($license.installedPacks -and $license.installedPacks.Count -gt 0) {
    $packs = @($license.installedPacks)
} else {
    # Dev fallback: core only from local cloud dist
    $packs = @("core")
    Write-Host "No entitlements — install pack 'core' only (dev fallback)"
}

$skillsRoot = Join-Path $ProjectRoot ".cursor\skills"
$installedDir = Join-Path $ProjectRoot ".cursor\agent-kit\installed"
New-Item -ItemType Directory -Force -Path $installedDir | Out-Null
New-Item -ItemType Directory -Force -Path $skillsRoot | Out-Null

foreach ($packId in $packs) {
    $distZip = Join-Path $cloudRoot "dist\$packId.zip"
    $distDir = Join-Path $cloudRoot "dist\$packId"
    $packManifest = Join-Path $cloudRoot "packs\$packId\pack.json"

    if (-not (Test-Path $packManifest)) {
        Write-Warning "No pack manifest for '$packId' — skip"
        continue
    }
    $manifest = Get-Content $packManifest -Raw | ConvertFrom-Json

    # Prefer already-built dist folder; else zip; else build from factory
    if (-not (Test-Path $distDir)) {
        if (Test-Path $distZip) {
            Expand-Archive -Path $distZip -DestinationPath $distDir -Force
        } elseif (Test-Path (Join-Path $cloudRoot "factory\build-pack.ps1")) {
            Write-Host "Building pack $packId locally from agent-kit-cloud..."
            & (Join-Path $cloudRoot "factory\build-pack.ps1") -PackId $packId -CloudRoot $cloudRoot
        } else {
            Write-Warning "Pack '$packId' not in dist and cannot build — skip"
            continue
        }
    }

    if (-not (Test-Path $distDir)) {
        Write-Warning "Pack '$packId' dist missing after build — skip"
        continue
    }

    # Install skills from pack
    $packSkills = Join-Path $distDir "skills"
    if (Test-Path $packSkills) {
        Get-ChildItem $packSkills -Directory | ForEach-Object {
            $dst = Join-Path $skillsRoot $_.Name
            if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
            Copy-Item $_.FullName $dst -Recurse -Force
            Write-Host "installed skill $($_.Name) from pack $packId"
        }
    }

    # Mark installed
    $mark = Join-Path $installedDir "$packId.json"
    [ordered]@{
        packId      = $packId
        installedAt = (Get-Date).ToString("o")
        version     = $manifest.version
        label       = $manifest.label
    } | ConvertTo-Json | Set-Content $mark -Encoding UTF8
}

$license.installedPacks = @($packs)
$license | ConvertTo-Json -Depth 5 | Set-Content $LicensePath -Encoding UTF8
Write-Host "sync-entitled OK packs=$($packs -join ',')"
