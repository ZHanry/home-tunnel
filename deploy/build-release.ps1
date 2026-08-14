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
if (-not $Version) {
    $Version = (Get-Content -LiteralPath (Join-Path $workspaceRoot ".env.example") |
        Where-Object { $_ -match '^HOME_TUNNEL_VERSION=' } |
        Select-Object -First 1) -replace '^HOME_TUNNEL_VERSION=', ''
}
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-rc\.\d+)?$') { throw "Version must use MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-rc.N format" }
$sourceVersion = $Version -replace '-rc\.\d+$', ''
if ($controlPackage.version -ne $sourceVersion) { throw "Control-center package version does not match source version $sourceVersion" }
$version = $Version
$gatewaySourceVersion = [string]$gatewayPackage.version
if ($gatewaySourceVersion -ne $sourceVersion) { throw "Traffic-gateway package version does not match source version $sourceVersion" }
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$releaseName = "home-tunnel-release-$version-arm64-$stamp"
$releaseDirectory = Join-Path $OutputRoot $releaseName
$archivePath = Join-Path $OutputRoot ($releaseName + ".tar.gz")
$archiveChecksumPath = $archivePath + ".sha256"
$frpcSource = Join-Path $workspaceRoot ".downloads\frp-linux-arm64\frp_0.70.1_linux_arm64\frpc"
$expectedFrpcHash = "312be2787dc17c79b68ebf6cc9b536039b2fba595431782c68e3c056c1d491f8"
$sbomSource = Join-Path $allowedOutputRoot "sbom"
$sbomNames = @(
    "control-center.spdx.json",
    "traffic-gateway.spdx.json",
    "frps.spdx.json"
)
$images = @(
    "home-tunnel/control-center:$version-arm64",
    "home-tunnel/traffic-gateway:$version-arm64",
    "home-tunnel/frps:0.70.1-arm64"
)

foreach ($required in @($frpcSource, (Join-Path $deployRoot "compose.yaml"))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required release input is missing: $required" }
}
$composeSource = Get-Content -Raw -LiteralPath (Join-Path $deployRoot "compose.yaml")
foreach ($expectedImage in @("home-tunnel/control-center:$version-arm64", "home-tunnel/traffic-gateway:$version-arm64")) {
    if ($composeSource -notmatch "(?m)^    image: $([regex]::Escape($expectedImage))\s*$") {
        throw "Compose does not reference $expectedImage"
    }
}
if ($composeSource -match '(?im)^\s*postgres:|home-tunnel-postgres|PGHOST|PGPASSWORD') {
    throw "Server Compose still contains PostgreSQL configuration"
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
    foreach ($directory in @("caddy", "scripts", "systemd", "images", "sbom")) {
        New-Item -ItemType Directory -Force (Join-Path $releaseDirectory $directory) | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $deployRoot "compose.yaml") -Destination (Join-Path $releaseDirectory "compose.yaml")
    Copy-Item -LiteralPath $frpcSource -Destination (Join-Path $releaseDirectory "frpc")
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
    $releaseJson = [ordered]@{
        version = $version
        created_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        target = "linux/arm64"
        database = "sqlite"
        images = $images
    }
    [IO.File]::WriteAllText(
        (Join-Path $releaseDirectory "release.json"),
        ($releaseJson | ConvertTo-Json -Depth 4) + "`n",
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
