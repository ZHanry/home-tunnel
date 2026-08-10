[CmdletBinding()]
param(
    [string]$OutputRoot = "",
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$deployRoot = $PSScriptRoot
$workspaceRoot = Split-Path -Parent $deployRoot
$allowedOutputRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot "outputs\server"))
if (-not $OutputRoot) { $OutputRoot = $allowedOutputRoot }
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$allowedPrefix = $allowedOutputRoot + [IO.Path]::DirectorySeparatorChar
if ($OutputRoot -ne $allowedOutputRoot -and -not $OutputRoot.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Server releases must be written below $allowedOutputRoot"
}

$controlPackage = Get-Content -Raw -LiteralPath (Join-Path $workspaceRoot "control-center\package.json") | ConvertFrom-Json
$gatewayPackage = Get-Content -Raw -LiteralPath (Join-Path $workspaceRoot "traffic-gateway\package.json") | ConvertFrom-Json
if (-not $Version) { $Version = [string]$controlPackage.version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must use MAJOR.MINOR.PATCH format" }
if ($controlPackage.version -ne $Version) { throw "Control-center package version does not match $Version" }
$version = $Version
$gatewayVersion = [string]$gatewayPackage.version
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$releaseName = "home-tunnel-release-$version-arm64-$stamp"
$releaseDirectory = Join-Path $OutputRoot $releaseName
$archivePath = Join-Path $OutputRoot ($releaseName + ".tar.gz")
$archiveChecksumPath = $archivePath + ".sha256"
$frpcSource = Join-Path $workspaceRoot ".downloads\frp-linux-arm64\frp_0.62.1_linux_arm64\frpc"
$expectedFrpcHash = "3f900ac9b035aac50b117ce5f7c450ca073d3e453448783979e978dc57bc39a9"
$sbomSource = Join-Path $allowedOutputRoot "sbom"
$windowsOutput = Join-Path $workspaceRoot "outputs\windows"
$releaseMetadata = Join-Path $windowsOutput "latest.json"
$sbomNames = @(
    "control-center.spdx.json",
    "traffic-gateway.spdx.json",
    "frps.spdx.json",
    "postgres.spdx.json"
)
$images = @(
    "home-tunnel/control-center:$version-arm64",
    "home-tunnel/traffic-gateway:$gatewayVersion-arm64",
    "home-tunnel/frps:0.62.1-arm64",
    "postgres:17.5-bookworm"
)

foreach ($required in @($frpcSource, (Join-Path $deployRoot "compose.yaml"), $releaseMetadata)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required release input is missing: $required" }
}
$latestWindowsRelease = Get-Content -Raw -LiteralPath $releaseMetadata | ConvertFrom-Json
if ($latestWindowsRelease.file_name -notmatch '^HomeTunnel-Setup-\d+\.\d+\.\d+-x64\.exe$') { throw "Malformed Windows release metadata" }
$expectedInstallerName = "HomeTunnel-Setup-$version-x64.exe"
$expectedDownloadUrl = "https://github.com/ZHanry/home-tunnel/releases/download/v$version/$expectedInstallerName"
if ($latestWindowsRelease.version -ne $version -or $latestWindowsRelease.file_name -ne $expectedInstallerName -or
    $latestWindowsRelease.download_url -ne $expectedDownloadUrl -or
    $latestWindowsRelease.stable_download_url -ne "https://github.com/ZHanry/home-tunnel/releases/latest") {
    throw "Windows release metadata does not match server release version $version"
}
$composeSource = Get-Content -Raw -LiteralPath (Join-Path $deployRoot "compose.yaml")
foreach ($expectedImage in @("home-tunnel/control-center:$version-arm64", "home-tunnel/traffic-gateway:$gatewayVersion-arm64")) {
    if ($composeSource -notmatch "(?m)^    image: $([regex]::Escape($expectedImage))\s*$") {
        throw "Compose does not reference $expectedImage"
    }
}
$windowsInstaller = Join-Path $windowsOutput $latestWindowsRelease.file_name
if (-not (Test-Path -LiteralPath $windowsInstaller -PathType Leaf)) { throw "Windows installer is missing: $windowsInstaller" }
if ((Get-FileHash -LiteralPath $windowsInstaller -Algorithm SHA256).Hash.ToLowerInvariant() -ne $latestWindowsRelease.sha256) {
    throw "Windows installer hash does not match latest.json"
}
if ((Get-Item -LiteralPath $windowsInstaller).Length -ne $latestWindowsRelease.size_bytes) {
    throw "Windows installer size does not match latest.json"
}
if ((Get-FileHash -LiteralPath $frpcSource -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedFrpcHash) {
    throw "Pinned ARM64 FRPC hash mismatch"
}
foreach ($sbomName in $sbomNames) {
    $sbomPath = Join-Path $sbomSource $sbomName
    if (-not (Test-Path -LiteralPath $sbomPath -PathType Leaf)) { throw "Required SBOM is missing: $sbomPath" }
    $sbom = Get-Content -Raw -LiteralPath $sbomPath | ConvertFrom-Json
    if ($sbom.spdxVersion -ne "SPDX-2.3") { throw "Unexpected SPDX version in $sbomName" }
}

$imageEvidence = [Collections.Generic.List[string]]::new()
foreach ($image in $images) {
    $architecture = (& docker image inspect --platform linux/arm64 -f "{{.Architecture}}" $image).Trim()
    if ($LASTEXITCODE -ne 0 -or $architecture -ne "arm64") { throw "ARM64 image is unavailable locally: $image" }
    $identifier = (& docker image inspect --platform linux/arm64 -f "{{.Id}}" $image).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect image identifier: $image" }
    $imageEvidence.Add("$image platform=linux/arm64 id=$identifier")
}

New-Item -ItemType Directory -Force $OutputRoot | Out-Null
if ((Test-Path -LiteralPath $releaseDirectory) -or (Test-Path -LiteralPath $archivePath) -or (Test-Path -LiteralPath $archiveChecksumPath)) {
    throw "Refusing to overwrite an existing release: $releaseName"
}

try {
    foreach ($directory in @("caddy", "scripts", "systemd", "images", "sbom", "downloads")) {
        New-Item -ItemType Directory -Force (Join-Path $releaseDirectory $directory) | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $deployRoot "compose.yaml") -Destination (Join-Path $releaseDirectory "compose.yaml")
    Copy-Item -LiteralPath $frpcSource -Destination (Join-Path $releaseDirectory "frpc")
    Copy-Item -LiteralPath $releaseMetadata -Destination (Join-Path $releaseDirectory "downloads\latest.json")
    Copy-Item -LiteralPath $windowsInstaller -Destination (Join-Path $releaseDirectory ("downloads\" + $latestWindowsRelease.file_name))
    foreach ($directory in @("caddy", "scripts", "systemd")) {
        Get-ChildItem -LiteralPath (Join-Path $deployRoot $directory) -File | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path (Join-Path $releaseDirectory $directory) $_.Name)
        }
    }
    foreach ($sbomName in $sbomNames) {
        Copy-Item -LiteralPath (Join-Path $sbomSource $sbomName) -Destination (Join-Path (Join-Path $releaseDirectory "sbom") $sbomName)
    }

    $releaseInfoLines = @("Home Tunnel server release $version", "Created (UTC): $stamp", "Target: linux/arm64") + $imageEvidence
    [IO.File]::WriteAllText(
        (Join-Path $releaseDirectory "release-info.txt"),
        ($releaseInfoLines -join "`n") + "`n",
        [Text.UTF8Encoding]::new($false)
    )

    $imageArchive = Join-Path $releaseDirectory "images\home-tunnel-images.tar"
    & docker image save --platform linux/arm64 --output $imageArchive @images
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $imageArchive -PathType Leaf)) {
        throw "ARM64 image archive creation failed"
    }

    $manifestPath = Join-Path $releaseDirectory "manifest.sha256"
    $manifestLines = Get-ChildItem -LiteralPath $releaseDirectory -Recurse -File |
        Where-Object FullName -ne $manifestPath |
        ForEach-Object {
            $relativePath = [IO.Path]::GetRelativePath($releaseDirectory, $_.FullName).Replace("\", "/")
            "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relativePath
        } |
        Sort-Object
    [IO.File]::WriteAllText($manifestPath, ($manifestLines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))

    foreach ($line in Get-Content -LiteralPath $manifestPath) {
        if ($line -notmatch "^([0-9a-f]{64})  (.+)$") { throw "Malformed manifest line" }
        $candidate = Join-Path $releaseDirectory $Matches[2]
        $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $Matches[1]) { throw "Release manifest verification failed for $($Matches[2])" }
    }

    & tar.exe -czf $archivePath -C $releaseDirectory .
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $archivePath -PathType Leaf)) { throw "Release compression failed" }
    $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText(
        $archiveChecksumPath,
        "$archiveHash  $([IO.Path]::GetFileName($archivePath))`n",
        [Text.UTF8Encoding]::new($false)
    )

    Write-Output "RELEASE_DIRECTORY=$releaseDirectory"
    Write-Output "RELEASE_ARCHIVE=$archivePath"
    Write-Output "RELEASE_SHA256=$archiveHash"
}
catch {
    $releasePrefix = $OutputRoot + [IO.Path]::DirectorySeparatorChar
    if ($releaseDirectory.StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $releaseDirectory)) {
        [IO.Directory]::Delete($releaseDirectory, $true)
    }
    foreach ($partial in @($archivePath, $archiveChecksumPath)) {
        if ($partial.StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase) -and [IO.File]::Exists($partial)) {
            [IO.File]::Delete($partial)
        }
    }
    throw
}
