param(
    [Parameter(Mandatory = $true)][string]$Sha,
    [ValidateSet("approve", "revise", "block", "info")]
    [string]$Verdict = "info",
    [string]$Body = "",
    [string]$LicensePath = "",
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$Api = ""
)

$ErrorActionPreference = "Stop"
if (-not $LicensePath) {
    $LicensePath = Join-Path $ProjectRoot ".cursor\agent-kit-license.json"
}
$key = $null
$org = $null
if (Test-Path $LicensePath) {
    $lic = Get-Content $LicensePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $key = $lic.key
    $org = $lic.org
    if (-not $Api -and $lic.licenseApi) { $Api = $lic.licenseApi }
}
if (-not $Api) { $Api = "http://localhost:8787" }
$Api = $Api.TrimEnd("/")

$payload = @{
    sha     = $Sha
    verdict = $Verdict
    body    = $Body
    key     = $key
    org     = $org
    issues  = @()
} | ConvertTo-Json -Depth 4

$res = Invoke-RestMethod -Method Post -Uri "$Api/v1/reviews" -ContentType "application/json" -Body $payload
$res | ConvertTo-Json -Depth 5
Write-Host "review submitted id=$($res.id)"
