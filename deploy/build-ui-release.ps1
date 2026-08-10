[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$OutputRoot = "",
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$deployRoot = $PSScriptRoot
$workspace = Split-Path -Parent $deployRoot
$controlRoot = Join-Path $workspace "control-center"
$gatewayRoot = Join-Path $workspace "traffic-gateway"
$allowedOutputRoot = [IO.Path]::GetFullPath((Join-Path $workspace "outputs\server"))
if (-not $OutputRoot) { $OutputRoot = $allowedOutputRoot }
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$allowedPrefix = $allowedOutputRoot + [IO.Path]::DirectorySeparatorChar
if ($OutputRoot -ne $allowedOutputRoot -and -not $OutputRoot.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "UI releases must be written below $allowedOutputRoot"
}

$controlPackage = Get-Content -Raw -LiteralPath (Join-Path $controlRoot "package.json") | ConvertFrom-Json
$gatewayPackage = Get-Content -Raw -LiteralPath (Join-Path $gatewayRoot "package.json") | ConvertFrom-Json
if (-not $Version) { $Version = [string]$controlPackage.version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must use MAJOR.MINOR.PATCH format" }
if ($controlPackage.version -ne $Version) { throw "Control-center package version does not match $Version" }
if ($gatewayPackage.version -ne $Version) { throw "Traffic-gateway package version does not match $Version" }
$versionSource = Get-Content -Raw -LiteralPath (Join-Path $controlRoot "src\version.ts")
if ($versionSource -notmatch 'APP_VERSION\s*=\s*"([^"\r\n]+)"' -or $Matches[1] -ne $Version) {
    throw "Control-center health version does not match $Version"
}

$imageTag = "home-tunnel/control-center:$Version-arm64"
$gatewayImageTag = "home-tunnel/traffic-gateway:$Version-arm64"
$composeSource = Get-Content -Raw -LiteralPath (Join-Path $deployRoot "compose.yaml")
foreach ($expectedImage in @($imageTag, $gatewayImageTag)) {
    if ($composeSource -notmatch "(?m)^    image: $([regex]::Escape($expectedImage))\s*$") {
        throw "Compose does not reference $expectedImage"
    }
}
if ($composeSource -match '(?im)^\s*postgres:|home-tunnel-postgres|PGHOST|PGPASSWORD') {
    throw "Managed Compose still contains PostgreSQL configuration"
}

$pnpm = Get-Command pnpm -ErrorAction Stop | Select-Object -ExpandProperty Source -First 1
$docker = Get-Command docker -ErrorAction Stop | Select-Object -ExpandProperty Source -First 1
foreach ($tool in @($pnpm, $docker)) {
    if (-not $tool -or -not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Required build tool is missing: $tool" }
}

if (-not $SkipTests) {
    & $pnpm --dir $controlRoot run check
    if ($LASTEXITCODE -ne 0) { throw "Control-center type check failed" }
    & $pnpm --dir $controlRoot run build
    if ($LASTEXITCODE -ne 0) { throw "Control-center build failed" }
    & $pnpm --dir $controlRoot test
    if ($LASTEXITCODE -ne 0) { throw "Control-center security tests failed" }
    & $pnpm --dir $controlRoot run test:public
    if ($LASTEXITCODE -ne 0) { throw "Control-center public tests failed" }
    & $pnpm --dir $controlRoot run test:integration
    if ($LASTEXITCODE -ne 0) { throw "Control-center SQLite integration tests failed" }
    & $pnpm --dir $gatewayRoot run check
    if ($LASTEXITCODE -ne 0) { throw "Traffic-gateway type check failed" }
    & $pnpm --dir $gatewayRoot run build
    if ($LASTEXITCODE -ne 0) { throw "Traffic-gateway build failed" }
    & $pnpm --dir $gatewayRoot test
    if ($LASTEXITCODE -ne 0) { throw "Traffic-gateway tests failed" }
}

$nodeImage = if ($env:HOME_TUNNEL_NODE_IMAGE) { $env:HOME_TUNNEL_NODE_IMAGE } else { "node:22.17.1-alpine" }
$toolsRoot = [IO.Path]::GetFullPath((Join-Path $workspace ".codex-tools"))
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null

function Remove-SafeBuildContext([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    $safePrefix = $toolsRoot + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing unsafe build-context cleanup"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

$controlContext = Join-Path $toolsRoot ("control-center-prebuilt-" + [Guid]::NewGuid().ToString("N").Substring(0, 10))
try {
    New-Item -ItemType Directory -Path $controlContext | Out-Null
    Copy-Item -LiteralPath (Join-Path $controlRoot "package.json"), (Join-Path $controlRoot "pnpm-lock.yaml") -Destination $controlContext
    foreach ($directory in @("dist", "migrations", "public")) {
        Copy-Item -LiteralPath (Join-Path $controlRoot $directory) -Destination (Join-Path $controlContext $directory) -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $controlRoot "Dockerfile.prebuilt") -Destination (Join-Path $controlContext "Dockerfile.prebuilt")
    & $pnpm --dir $controlContext install --prod --offline --frozen-lockfile --config.node-linker=hoisted
    if ($LASTEXITCODE -ne 0) { throw "Offline production dependency staging failed" }
    if (Get-ChildItem -LiteralPath (Join-Path $controlContext "node_modules") -Recurse -Filter "*.node" -File | Select-Object -First 1) {
        throw "A native Node dependency prevents architecture-neutral staging"
    }
    & $docker buildx build --platform linux/arm64 --load --no-cache `
        --file (Join-Path $controlContext "Dockerfile.prebuilt") `
        --build-arg "NODE_IMAGE=$nodeImage" `
        --label "com.home-tunnel.managed=true" `
        --label "org.opencontainers.image.version=$Version" `
        --label "org.opencontainers.image.revision=v$Version-lightweight" `
        --tag $imageTag $controlContext
    if ($LASTEXITCODE -ne 0) { throw "ARM64 control-center image build failed" }
}
finally {
    Remove-SafeBuildContext $controlContext
}

$gatewayContext = Join-Path $toolsRoot ("traffic-gateway-prebuilt-" + [Guid]::NewGuid().ToString("N").Substring(0, 10))
try {
    New-Item -ItemType Directory -Path $gatewayContext | Out-Null
    Copy-Item -LiteralPath (Join-Path $gatewayRoot "package.json") -Destination (Join-Path $gatewayContext "package.json")
    Copy-Item -LiteralPath (Join-Path $gatewayRoot "dist") -Destination (Join-Path $gatewayContext "dist") -Recurse
    Copy-Item -LiteralPath (Join-Path $gatewayRoot "Dockerfile.prebuilt") -Destination (Join-Path $gatewayContext "Dockerfile.prebuilt")
    & $docker buildx build --platform linux/arm64 --load --no-cache `
        --file (Join-Path $gatewayContext "Dockerfile.prebuilt") `
        --build-arg "NODE_IMAGE=$nodeImage" `
        --label "com.home-tunnel.managed=true" `
        --label "org.opencontainers.image.version=$Version" `
        --label "org.opencontainers.image.revision=v$Version-lightweight" `
        --tag $gatewayImageTag $gatewayContext
    if ($LASTEXITCODE -ne 0) { throw "ARM64 traffic-gateway image build failed" }
}
finally {
    Remove-SafeBuildContext $gatewayContext
}

$imageArchitecture = (& $docker image inspect -f "{{.Architecture}}" $imageTag).Trim()
$imageUser = (& $docker image inspect -f "{{.Config.User}}" $imageTag).Trim()
$imageVersion = (& $docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' $imageTag).Trim()
$imageId = (& $docker image inspect -f "{{.Id}}" $imageTag).Trim()
$gatewayArchitecture = (& $docker image inspect -f "{{.Architecture}}" $gatewayImageTag).Trim()
$gatewayUser = (& $docker image inspect -f "{{.Config.User}}" $gatewayImageTag).Trim()
$gatewayVersion = (& $docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' $gatewayImageTag).Trim()
$gatewayImageId = (& $docker image inspect -f "{{.Id}}" $gatewayImageTag).Trim()
if ($imageArchitecture -ne "arm64" -or $imageUser -ne "10001:10001" -or $imageVersion -ne $Version) {
    throw "ARM64 control-center image metadata validation failed"
}
if ($gatewayArchitecture -ne "arm64" -or $gatewayUser -ne "10001:10001" -or $gatewayVersion -ne $Version) {
    throw "ARM64 traffic-gateway image metadata validation failed"
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$releaseName = "home-tunnel-ui-$Version-arm64-$stamp"
$releaseDirectory = Join-Path $OutputRoot $releaseName
if (Test-Path -LiteralPath $releaseDirectory) { throw "Refusing to overwrite $releaseDirectory" }

try {
    New-Item -ItemType Directory -Path $releaseDirectory | Out-Null
    $imageArchive = Join-Path $releaseDirectory "home-tunnel-ui-images.tar"
    & $docker image save --platform linux/arm64 --output $imageArchive $imageTag $gatewayImageTag
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $imageArchive -PathType Leaf)) {
        throw "Combined ARM64 image archive creation failed"
    }
    Copy-Item -LiteralPath (Join-Path $deployRoot "scripts\update-ui.sh") -Destination (Join-Path $releaseDirectory "update-ui.sh")

    $files = [ordered]@{}
    foreach ($name in @("home-tunnel-ui-images.tar", "update-ui.sh")) {
        $path = Join-Path $releaseDirectory $name
        $item = Get-Item -LiteralPath $path
        $files[$name] = [ordered]@{
            size_bytes = $item.Length
            sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    $release = [ordered]@{
        version = $Version
        created_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        target = "linux/arm64"
        image_tag = $imageTag
        image_id = $imageId
        image_user = $imageUser
        gateway_image_tag = $gatewayImageTag
        gateway_image_id = $gatewayImageId
        gateway_image_user = $gatewayUser
        files = $files
    }
    $releaseJson = Join-Path $releaseDirectory "release.json"
    [IO.File]::WriteAllText($releaseJson, ($release | ConvertTo-Json -Depth 6) + "`n", [Text.UTF8Encoding]::new($false))

    Write-Output "RELEASE_DIRECTORY=$releaseDirectory"
    Write-Output "VERSION=$Version"
    Write-Output "IMAGE=$imageTag"
    Write-Output "IMAGE_ID=$imageId"
    Write-Output "GATEWAY_IMAGE=$gatewayImageTag"
    Write-Output "GATEWAY_IMAGE_ID=$gatewayImageId"
    Write-Output "IMAGES_TAR_SHA256=$($files['home-tunnel-ui-images.tar'].sha256)"
}
catch {
    $safePrefix = $allowedOutputRoot + [IO.Path]::DirectorySeparatorChar
    if ($releaseDirectory.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $releaseDirectory)) {
        [IO.Directory]::Delete($releaseDirectory, $true)
    }
    throw
}
