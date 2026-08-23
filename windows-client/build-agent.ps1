[CmdletBinding()]
param(
    [string]$WindRes = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$clientDir = $PSScriptRoot
$workspaceDir = Split-Path -Parent $clientDir
$agentSourceDir = Join-Path $workspaceDir "windows-agent"
$toolsDir = Join-Path $workspaceDir ".downloads\go-toolchain"
$goExe = Join-Path $toolsDir "go\bin\go.exe"
$goVersion = "1.26.6"
$goArchive = Join-Path $toolsDir "go$goVersion.windows-amd64.zip"
$goArchiveSha256 = "5b6c5b556525810463b5c897b50dc7a82d6a3dc0bfaf55d990a7e9f31d6b2318"
$frpVersion = "0.70.1"
$agentVersion = "3.2.0"
$frpCommit = "fa3bcca2b0c4753cd4f0e2ab189dd6a5a6a15708"
$frpArchive = Join-Path $workspaceDir ".downloads\frp-$frpCommit.zip"
$frpArchiveSha256 = "9c6b0188a8f74e982069dc89218cc3d79bada8663cedf3b514b98847530cbf7d"
$frpExtractRoot = Join-Path $workspaceDir ".downloads\frp-api-$frpCommit"
$output = Join-Path $clientDir "assets\HomeTunnel.Agent.exe"

New-Item -ItemType Directory -Force $toolsDir, (Split-Path -Parent $output) | Out-Null

if (Test-Path -LiteralPath $goExe -PathType Leaf) {
    $installedGoVersion = (& $goExe version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $installedGoVersion -ne "go version go$goVersion windows/amd64") {
        $goRoot = Join-Path $toolsDir "go"
        $resolvedGoRoot = (Resolve-Path -LiteralPath $goRoot).Path
        $safeToolsRoot = [IO.Path]::GetFullPath($toolsDir) + [IO.Path]::DirectorySeparatorChar
        if (-not $resolvedGoRoot.StartsWith($safeToolsRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing unsafe Go toolchain cache cleanup"
        }
        Remove-Item -LiteralPath $resolvedGoRoot -Recurse -Force
    }
}
if (-not (Test-Path -LiteralPath $goExe -PathType Leaf)) {
    if (-not (Test-Path -LiteralPath $goArchive -PathType Leaf)) {
        Invoke-WebRequest -UseBasicParsing "https://go.dev/dl/go$goVersion.windows-amd64.zip" -OutFile $goArchive
    }
    $actual = (Get-FileHash -LiteralPath $goArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $goArchiveSha256) { throw "Go toolchain checksum mismatch: $actual" }
    Expand-Archive -LiteralPath $goArchive -DestinationPath $toolsDir -Force
}

if (-not (Test-Path -LiteralPath $frpArchive -PathType Leaf)) {
    Invoke-WebRequest -UseBasicParsing -Headers @{
        "Accept" = "application/vnd.github+json"
        "User-Agent" = "HomeTunnelBuild"
        "X-GitHub-Api-Version" = "2022-11-28"
    } "https://api.github.com/repos/fatedier/frp/zipball/$frpCommit" -OutFile $frpArchive
}
$actualFrpArchiveHash = (Get-FileHash -LiteralPath $frpArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualFrpArchiveHash -ne $frpArchiveSha256) { throw "Pinned FRP source checksum mismatch: $actualFrpArchiveHash" }

if (-not (Test-Path -LiteralPath $frpExtractRoot -PathType Container)) {
    New-Item -ItemType Directory -Force $frpExtractRoot | Out-Null
    Expand-Archive -LiteralPath $frpArchive -DestinationPath $frpExtractRoot -Force
}
$frpSource = Get-ChildItem -LiteralPath $frpExtractRoot -Directory |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "go.mod") } |
    Select-Object -First 1
if (-not $frpSource -or $frpSource.Name -notlike "fatedier-frp-$($frpCommit.Substring(0,7))*") {
    throw "Pinned FRP source archive did not contain the expected commit directory"
}

if (-not $WindRes) {
    $windResCandidates = @((Get-Command windres -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1))
    $llvmMingwRoot = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) "Programs\llvm-mingw"
    if (Test-Path -LiteralPath $llvmMingwRoot -PathType Container) {
        $windResCandidates += Get-ChildItem -LiteralPath $llvmMingwRoot -Recurse -Filter windres.exe -File -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty FullName
    }
    $WindRes = $windResCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $WindRes -or -not (Test-Path -LiteralPath $WindRes -PathType Leaf)) {
    throw "windres.exe is required to embed the Home Tunnel icon and version metadata"
}

$temporaryCommand = Join-Path $frpSource.FullName "cmd\home-tunnel-agent"
if (Test-Path -LiteralPath $temporaryCommand) {
    throw "Fixed Home Tunnel Agent build directory is already in use: $temporaryCommand"
}
try {
    New-Item -ItemType Directory -Force $temporaryCommand | Out-Null
    Copy-Item -LiteralPath (Join-Path $agentSourceDir "main.go") -Destination (Join-Path $temporaryCommand "main.go")
    Copy-Item -LiteralPath (Join-Path $agentSourceDir "HomeTunnel.Agent.rc") -Destination (Join-Path $temporaryCommand "HomeTunnel.Agent.rc")
    Copy-Item -LiteralPath (Join-Path $clientDir "assets\HomeTunnel.ico") -Destination (Join-Path $temporaryCommand "HomeTunnel.ico")

    # GNU windres otherwise writes the current time into the COFF header, which
    # makes the reviewed Agent SHA-256 change on every protected rebuild.
    $previousSourceDateEpoch = [Environment]::GetEnvironmentVariable("SOURCE_DATE_EPOCH", "Process")
    try {
        $env:SOURCE_DATE_EPOCH = "0"
        & $WindRes -i (Join-Path $temporaryCommand "HomeTunnel.Agent.rc") `
            -o (Join-Path $temporaryCommand "resource_windows_amd64.syso") `
            -O coff --target=pe-x86-64
        $windResExitCode = $LASTEXITCODE
    }
    finally {
        if ($null -eq $previousSourceDateEpoch) {
            Remove-Item Env:SOURCE_DATE_EPOCH -ErrorAction SilentlyContinue
        }
        else {
            $env:SOURCE_DATE_EPOCH = $previousSourceDateEpoch
        }
    }
    if ($windResExitCode -ne 0) { throw "Agent Windows resource compilation failed" }

    $env:CGO_ENABLED = "0"
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    $env:GOFLAGS = "-buildvcs=false"
    $env:GOPROXY = "https://proxy.golang.org,direct"
    $env:GOSUMDB = "sum.golang.org"
    Push-Location $frpSource.FullName
    try {
        $package = "./" + [IO.Path]::GetRelativePath($frpSource.FullName, $temporaryCommand).Replace("\", "/")
        $linkerFlags = "-s -w -buildid= -X main.agentVersion=$agentVersion -X main.frpVersion=$frpVersion -X main.frpCommit=$frpCommit"
        & $goExe build -trimpath -ldflags $linkerFlags -o $output $package
    }
    finally {
        Pop-Location
    }
    if ($LASTEXITCODE -ne 0) { throw "Home Tunnel Agent source build failed" }
}
finally {
    if (Test-Path -LiteralPath $temporaryCommand) {
        $resolved = (Resolve-Path -LiteralPath $temporaryCommand).Path
        $safeRoot = [IO.Path]::GetFullPath((Join-Path $frpSource.FullName "cmd")) + [IO.Path]::DirectorySeparatorChar
        if (-not $resolved.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing unsafe Agent build cleanup"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

$versionOutput = (& $output version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -notlike "Home Tunnel Agent $agentVersion*") {
    throw "Home Tunnel Agent version self-check failed: $versionOutput"
}
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
$versionInfo = (Get-Item -LiteralPath $output).VersionInfo
if ($versionInfo.ProductVersion -notlike "$agentVersion*") { throw "Agent product version resource is missing" }

Write-Output "AGENT_VERSION=$agentVersion"
Write-Output "FRP_VERSION=$frpVersion"
Write-Output "FRP_COMMIT=$frpCommit"
Write-Output "AGENT_SHA256=$hash"
Write-Output "AGENT=$output"
