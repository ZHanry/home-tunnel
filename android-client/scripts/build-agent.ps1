[CmdletBinding()]
param(
    [string]$Abis = $env:ANDROID_AGENT_ABIS
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDir = $PSScriptRoot
$clientDir = Split-Path -Parent $scriptDir
$workspaceDir = Split-Path -Parent $clientDir
$buildRoot = Join-Path $clientDir ".agent-build"
$downloadsDir = Join-Path $buildRoot "downloads"
$goVersion = "1.26.6"
$ndkVersion = "27.2.12479018"
$frpVersion = "0.70.1"
$agentVersion = "3.2.0"
$frpCommit = "fa3bcca2b0c4753cd4f0e2ab189dd6a5a6a15708"
$frpArchiveSha256 = "9c6b0188a8f74e982069dc89218cc3d79bada8663cedf3b514b98847530cbf7d"
$frpArchive = Join-Path $downloadsDir "frp-$frpCommit.zip"
$frpExtractRoot = Join-Path $buildRoot "frp-$frpCommit"

$go = Get-Command go -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $go) { throw "Go $goVersion is required" }
$actualGoVersion = (& $go version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $actualGoVersion -notlike "go version go$goVersion *") {
    throw "Go $goVersion is required; found: $actualGoVersion"
}

New-Item -ItemType Directory -Force $downloadsDir | Out-Null
if (-not (Test-Path -LiteralPath $frpArchive -PathType Leaf)) {
    Invoke-WebRequest -UseBasicParsing -Headers @{
        "Accept" = "application/vnd.github+json"
        "User-Agent" = "HomeTunnelAndroidBuild"
        "X-GitHub-Api-Version" = "2022-11-28"
    } "https://api.github.com/repos/fatedier/frp/zipball/$frpCommit" -OutFile $frpArchive
}
$actualArchiveSha256 = (Get-FileHash -LiteralPath $frpArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualArchiveSha256 -ne $frpArchiveSha256) {
    throw "Pinned FRP source checksum mismatch: $actualArchiveSha256"
}
if (-not (Test-Path -LiteralPath $frpExtractRoot -PathType Container)) {
    New-Item -ItemType Directory -Force $frpExtractRoot | Out-Null
    Expand-Archive -LiteralPath $frpArchive -DestinationPath $frpExtractRoot
}
$frpSource = Get-ChildItem -LiteralPath $frpExtractRoot -Directory |
    Where-Object { $_.Name -like "fatedier-frp-$($frpCommit.Substring(0,7))*" -and (Test-Path (Join-Path $_.FullName "go.mod")) } |
    Select-Object -First 1
if (-not $frpSource) { throw "Pinned FRP source tree not found" }

$temporaryCommand = Join-Path $frpSource.FullName "cmd\home-tunnel-agent-android-build"
if (Test-Path -LiteralPath $temporaryCommand) {
    throw "Fixed Android Agent build directory is already in use: $temporaryCommand"
}
try {
    New-Item -ItemType Directory -Force $temporaryCommand | Out-Null
    Copy-Item -LiteralPath (Join-Path $workspaceDir "windows-agent\main.go") -Destination (Join-Path $temporaryCommand "main.go")
    if ([string]::IsNullOrWhiteSpace($Abis)) { $Abis = "arm64-v8a,x86_64" }
    $requestedAbis = $Abis.Split(',', [StringSplitOptions]::RemoveEmptyEntries) | ForEach-Object { $_.Trim() }
    if (-not $requestedAbis) { throw "ANDROID_AGENT_ABIS is empty" }

    foreach ($abi in $requestedAbis) {
        $goArch = switch ($abi) {
            "arm64-v8a" { "arm64" }
            "x86_64" { "amd64" }
            default { throw "Unsupported Android Agent ABI: $abi" }
        }
        $outputDir = Join-Path $clientDir "app\src\main\jniLibs\$abi"
        $output = Join-Path $outputDir "libhometunnel_agent.so"
        New-Item -ItemType Directory -Force $outputDir | Out-Null
        $previousCgo = $env:CGO_ENABLED
        $previousGoos = $env:GOOS
        $previousGoarch = $env:GOARCH
        $previousGoflags = $env:GOFLAGS
        $previousCc = $env:CC
        $previousCxx = $env:CXX
        try {
            $env:CGO_ENABLED = "0"
            $env:GOOS = "android"
            $env:GOARCH = $goArch
            $env:GOFLAGS = "-buildvcs=false"
            if ($abi -eq "x86_64") {
                $ndkRoot = @($env:ANDROID_NDK_ROOT, $env:ANDROID_NDK_HOME, $env:ANDROID_NDK_LATEST_HOME) |
                    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
                    Select-Object -First 1
                if (-not $ndkRoot) {
                    $sdkRoot = @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME) |
                        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
                        Select-Object -First 1
                    if ($sdkRoot) { $ndkRoot = Join-Path $sdkRoot "ndk\$ndkVersion" }
                }
                if (-not $ndkRoot -or -not (Test-Path -LiteralPath (Join-Path $ndkRoot "toolchains\llvm\prebuilt") -PathType Container)) {
                    throw "x86_64 requires Android NDK $ndkVersion; set ANDROID_NDK_ROOT, ANDROID_NDK_HOME, or ANDROID_NDK_LATEST_HOME"
                }
                $toolchainBin = Join-Path $ndkRoot "toolchains\llvm\prebuilt\windows-x86_64\bin"
                $ccCandidate = @(
                    (Join-Path $toolchainBin "x86_64-linux-android26-clang.cmd"),
                    (Join-Path $toolchainBin "x86_64-linux-android26-clang.exe"),
                    (Join-Path $toolchainBin "x86_64-linux-android26-clang")
                ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
                $cxxCandidate = @(
                    (Join-Path $toolchainBin "x86_64-linux-android26-clang++.cmd"),
                    (Join-Path $toolchainBin "x86_64-linux-android26-clang++.exe"),
                    (Join-Path $toolchainBin "x86_64-linux-android26-clang++")
                ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
                if (-not $ccCandidate -or -not $cxxCandidate) {
                    throw "NDK x86_64 API 26 clang wrappers not found under $toolchainBin"
                }
                $env:CGO_ENABLED = "1"
                $env:CC = $ccCandidate
                $env:CXX = $cxxCandidate
            }
            else {
                Remove-Item Env:CC -ErrorAction SilentlyContinue
                Remove-Item Env:CXX -ErrorAction SilentlyContinue
            }
            Push-Location $frpSource.FullName
            $linkerFlags = "-s -w -buildid= -X main.agentVersion=$agentVersion -X main.frpVersion=$frpVersion -X main.frpCommit=$frpCommit"
            & $go build -trimpath -buildmode=pie -ldflags $linkerFlags -o $output "./cmd/$([IO.Path]::GetFileName($temporaryCommand))"
            if ($LASTEXITCODE -ne 0) { throw "Android Agent build failed for $abi" }
        }
        finally {
            Pop-Location
            $env:CGO_ENABLED = $previousCgo
            $env:GOOS = $previousGoos
            $env:GOARCH = $previousGoarch
            $env:GOFLAGS = $previousGoflags
            $env:CC = $previousCc
            $env:CXX = $previousCxx
        }
        $agentSha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
        Write-Output "ANDROID_AGENT_ABI=$abi"
        Write-Output "ANDROID_AGENT_SHA256=$agentSha256"
        Write-Output "ANDROID_AGENT_PATH=$([IO.Path]::GetFullPath($output))"
    }
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
