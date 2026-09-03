# Builds the unified Windows x64 desktop package: home-tunnel-gui.exe + Agent.
param(
    [string]$Version = "4.0.0",
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
$icon = Join-Path $workspace "windows-agent\assets\HomeTunnel.ico"
Copy-Item -LiteralPath $icon -Destination (Join-Path $OutputDir "HomeTunnel.ico") -Force

$payloadDir = Join-Path $clientDir "cmd\home-tunnel-setup\payload"
New-Item -ItemType Directory -Force -Path $payloadDir | Out-Null
Copy-Item -LiteralPath $gui, $agent, $icon -Destination $payloadDir -Force
$setupName = "HomeTunnel-Setup-$Version-x64.exe"
$setup = Join-Path $OutputDir $setupName
if (Test-Path -LiteralPath $setup) { Remove-Item -LiteralPath $setup -Force }
Push-Location $clientDir
try {
    go build -trimpath `
        -ldflags "-s -w -H windowsgui -buildid= -X main.version=$Version" `
        -o $setup ./cmd/home-tunnel-setup
}
finally {
    Pop-Location
}
if (-not (Test-Path -LiteralPath $setup)) {
    throw "failed to produce $setup"
}
$sha = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(
    "$setup.sha256",
    "$sha  $setupName" + [char]10,
    [Text.UTF8Encoding]::new($false)
)
Write-Host "SETUP=$setup"
Write-Host "SETUP_SHA256=$sha"
Write-Host "AGENT_SHA256=$agentSha"
