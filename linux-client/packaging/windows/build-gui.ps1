# Builds the shared Go graphical client for Windows x64.
# Requires Go 1.26+. Prefer packaging/windows/build-release.ps1 for the zip.

param(
    [string]$Version = "3.2.0",
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
$clientDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $OutputDir) {
    $OutputDir = Join-Path (Split-Path -Parent $clientDir) "outputs\windows"
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$env:CGO_ENABLED = "0"
$env:GOOS = "windows"
$env:GOARCH = "amd64"
$env:GOFLAGS = "-buildvcs=false"
Push-Location $clientDir
try {
    go build -trimpath -ldflags "-s -w -H windowsgui -buildid= -X main.version=$Version" `
        -o (Join-Path $OutputDir "home-tunnel-gui.exe") ./cmd/home-tunnel-gui
}
finally {
    Pop-Location
}
Write-Host "GUI=$(Join-Path $OutputDir 'home-tunnel-gui.exe')"
