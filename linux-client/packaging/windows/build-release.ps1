# Builds the unified Windows x64 desktop package: home-tunnel-gui.exe + Agent.
param(
    [string]$Version = "3.2.0",
    [string]$WindRes = "",
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$packagingDir = $PSScriptRoot
$clientDir = Split-Path -Parent (Split-Path -Parent $packagingDir)
$workspace = Split-Path -Parent $clientDir
if (-not $OutputDir) {
    $OutputDir = Join-Path $workspace "outputs\windows"
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$agentScript = Join-Path $workspace "windows-agent\build-agent.ps1"
$agentLines = if ($WindRes) {
    & $agentScript -WindRes $WindRes
} else {
    & $agentScript
}
$agentLines | ForEach-Object { Write-Host $_ }
$agentSha = ($agentLines | Where-Object { $_ -like "AGENT_SHA256=*" } | Select-Object -First 1) -replace "^AGENT_SHA256=", ""
if ($agentSha -notmatch "^[0-9a-f]{64}$") {
    throw "Agent SHA-256 missing from build-agent.ps1"
}
$agentSource = Join-Path $workspace "windows-agent\assets\HomeTunnel.Agent.exe"
if (-not (Test-Path -LiteralPath $agentSource -PathType Leaf)) {
    throw "Agent executable was not produced"
}

$env:CGO_ENABLED = "0"
$env:GOOS = "windows"
$env:GOARCH = "amd64"
$env:GOFLAGS = "-buildvcs=false"
$gui = Join-Path $OutputDir "home-tunnel-gui.exe"
$agent = Join-Path $OutputDir "home-tunnel-agent.exe"
Push-Location $clientDir
try {
    go build -trimpath `
        -ldflags "-s -w -H windowsgui -buildid= -X main.version=$Version -X main.expectedAgentSHA256=$agentSha" `
        -o $gui ./cmd/home-tunnel-gui
}
finally {
    Pop-Location
}
Copy-Item -LiteralPath $agentSource -Destination $agent -Force

$zipName = "HomeTunnel-Windows-$Version-x64.zip"
$zip = Join-Path $OutputDir $zipName
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path $gui, $agent -DestinationPath $zip -Force
$sha = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(
    "$zip.sha256",
    "$sha  $zipName" + [char]10,
    [Text.UTF8Encoding]::new($false)
)
$manifest = [ordered]@{
    version = $Version
    platform = "windows"
    architecture = "x64"
    file_name = $zipName
    size_bytes = (Get-Item -LiteralPath $zip).Length
    sha256 = $sha
    released_at = [DateTime]::UtcNow.ToString("o")
    download_url = "https://github.com/ZHanry/home-tunnel/releases/latest/download/$zipName"
}
($manifest | ConvertTo-Json) + "`n" | Set-Content -LiteralPath (Join-Path $OutputDir "latest.json") -Encoding utf8
Write-Host "ZIP=$zip"
Write-Host "ZIP_SHA256=$sha"
Write-Host "AGENT_SHA256=$agentSha"
