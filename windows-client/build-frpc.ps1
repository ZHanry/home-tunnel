param(
    [string]$WindRes = ""
)

$ErrorActionPreference = "Stop"
Write-Warning "build-frpc.ps1 已兼容转发到专用 Home Tunnel Agent 构建；不再生成通用 frpc.exe。"
& (Join-Path $PSScriptRoot "build-agent.ps1") `
    -WindRes $WindRes
if ($LASTEXITCODE -ne 0) { throw "Home Tunnel Agent build failed" }
