[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$OutputRoot = "",
    [switch]$SkipInstallerBuild,
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$deployRoot = $PSScriptRoot
$workspace = Split-Path -Parent $deployRoot
$clientRoot = Join-Path $workspace "windows-client"
$controlRoot = Join-Path $workspace "control-center"
$gatewayRoot = Join-Path $workspace "traffic-gateway"
$windowsOutput = Join-Path $workspace "outputs\windows"
$allowedOutputRoot = [IO.Path]::GetFullPath((Join-Path $workspace "outputs\server"))
if (-not $OutputRoot) { $OutputRoot = $allowedOutputRoot }
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$allowedPrefix = $allowedOutputRoot + [IO.Path]::DirectorySeparatorChar
if ($OutputRoot -ne $allowedOutputRoot -and -not $OutputRoot.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "UI releases must be written below $allowedOutputRoot"
}

$projectPath = Join-Path $clientRoot "HomeTunnel.Client.csproj"
$projectVersion = (Select-Xml -LiteralPath $projectPath -XPath "/Project/PropertyGroup/Version" | Select-Object -First 1).Node.InnerText
if (-not $Version) { $Version = $projectVersion }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must use MAJOR.MINOR.PATCH format" }
if ($projectVersion -ne $Version) { throw "Windows project version $projectVersion does not match release version $Version" }

$controlPackage = Get-Content -Raw -LiteralPath (Join-Path $controlRoot "package.json") | ConvertFrom-Json
if ($controlPackage.version -ne $Version) { throw "Control-center package version $($controlPackage.version) does not match $Version" }
$gatewayPackage = Get-Content -Raw -LiteralPath (Join-Path $gatewayRoot "package.json") | ConvertFrom-Json
if ($gatewayPackage.version -ne $Version) { throw "Traffic-gateway package version $($gatewayPackage.version) does not match $Version" }
$versionSource = Get-Content -Raw -LiteralPath (Join-Path $controlRoot "src\version.ts")
if ($versionSource -notmatch 'APP_VERSION\s*=\s*"([^"\r\n]+)"' -or $Matches[1] -ne $Version) {
    throw "Control-center health version does not match $Version"
}
$composeSource = Get-Content -Raw -LiteralPath (Join-Path $deployRoot "compose.yaml")
$imageTag = "home-tunnel/control-center:$Version-arm64"
$gatewayImageTag = "home-tunnel/traffic-gateway:$Version-arm64"
foreach ($expectedImage in @($imageTag, $gatewayImageTag)) {
    if ($composeSource -notmatch "(?m)^    image: $([regex]::Escape($expectedImage))\s*$") {
        throw "Compose does not reference $expectedImage"
    }
}
$installerScript = Get-Content -Raw -LiteralPath (Join-Path $clientRoot "packaging\HomeTunnel.iss")
if ($installerScript -notmatch '#define MyAppVersion "([^"\r\n]+)"' -or $Matches[1] -ne $Version) {
    throw "Inno Setup default version does not match $Version"
}

$dotnetCandidates = @((Get-Command dotnet -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1))
$localPrograms = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) "Programs"
if (Test-Path -LiteralPath $localPrograms -PathType Container) {
    $dotnetCandidates += Get-ChildItem -LiteralPath $localPrograms -Recurse -Filter dotnet.exe -File -ErrorAction SilentlyContinue |
        Where-Object FullName -Match '[\\/]dotnet-sdk[\\/]' |
        Select-Object -ExpandProperty FullName
}
$dotnetCandidates = $dotnetCandidates | Where-Object { $_ }
$dotnet = $dotnetCandidates | Where-Object {
    if (-not (Test-Path -LiteralPath $_ -PathType Leaf)) { return $false }
    try { (& $_ --list-sdks 2>$null) -match '^8\.' } catch { $false }
} | Select-Object -First 1
$pnpm = Get-Command pnpm -ErrorAction Stop | Select-Object -ExpandProperty Source -First 1
$docker = Get-Command docker -ErrorAction Stop | Select-Object -ExpandProperty Source -First 1
foreach ($tool in @($dotnet, $pnpm, $docker)) {
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
    & $pnpm --dir $gatewayRoot run check
    if ($LASTEXITCODE -ne 0) { throw "Traffic-gateway type check failed" }
    & $pnpm --dir $gatewayRoot run build
    if ($LASTEXITCODE -ne 0) { throw "Traffic-gateway build failed" }
    & $pnpm --dir $gatewayRoot test
    if ($LASTEXITCODE -ne 0) { throw "Traffic-gateway tests failed" }
    & $dotnet run --project (Join-Path $workspace "windows-client-tests\HomeTunnel.Client.Tests.csproj") -c Debug
    if ($LASTEXITCODE -ne 0) { throw "Windows update tests failed" }
    foreach ($configuration in @("Debug", "Release")) {
        & $dotnet build $projectPath -c $configuration --no-restore --nologo
        if ($LASTEXITCODE -ne 0) { throw "Windows $configuration build failed" }
    }
}

if (-not $SkipInstallerBuild) {
    & (Join-Path $clientRoot "packaging\build-exe.ps1") -Version $Version -OutputDirectory $windowsOutput
    if ($LASTEXITCODE -ne 0) { throw "Windows EXE build failed" }
}

$metadataPath = Join-Path $windowsOutput "latest.json"
if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { throw "latest.json is missing" }
$releaseMetadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json
$expectedInstallerName = "HomeTunnel-Setup-$Version-x64.exe"
$expectedDownloadUrl = "https://github.com/ZHanry/home-tunnel/releases/download/v$Version/$expectedInstallerName"
if ($releaseMetadata.version -ne $Version -or $releaseMetadata.file_name -ne $expectedInstallerName -or
    $releaseMetadata.download_url -ne $expectedDownloadUrl -or
    $releaseMetadata.stable_download_url -ne "https://github.com/ZHanry/home-tunnel/releases/latest") {
    throw "Windows release metadata version does not match $Version"
}
$installerPath = Join-Path $windowsOutput $expectedInstallerName
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw "Windows installer is missing: $installerPath" }
$installerInfo = Get-Item -LiteralPath $installerPath
$installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($releaseMetadata.sha256 -ne $installerHash -or $releaseMetadata.size_bytes -ne $installerInfo.Length) {
    throw "Windows installer does not match latest.json"
}

$nodeDigest = "sha256:2fa754a9ba4d7adbd2a51d182eaabbe355c82b673624035a38c0d42b08724854"
$officialNodeImage = "node:22.17.1-bookworm-slim@$nodeDigest"
$mirrorNodeImage = "docker.m.daocloud.io/library/node:22.17.1-bookworm-slim@$nodeDigest"
& $docker image inspect $mirrorNodeImage *> $null
$nodeImage = if ($LASTEXITCODE -eq 0) { $mirrorNodeImage } else { $officialNodeImage }
$toolsRoot = [IO.Path]::GetFullPath((Join-Path $workspace ".codex-tools"))
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
$prebuiltContext = Join-Path $toolsRoot ("control-center-prebuilt-" + [Guid]::NewGuid().ToString("N").Substring(0, 10))
try {
    New-Item -ItemType Directory -Path $prebuiltContext | Out-Null
    Copy-Item -LiteralPath (Join-Path $controlRoot "package.json"), (Join-Path $controlRoot "pnpm-lock.yaml") -Destination $prebuiltContext
    foreach ($directory in @("dist", "migrations", "public")) {
        Copy-Item -LiteralPath (Join-Path $controlRoot $directory) -Destination (Join-Path $prebuiltContext $directory) -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $controlRoot "Dockerfile.prebuilt") -Destination (Join-Path $prebuiltContext "Dockerfile.prebuilt")
    & $pnpm --dir $prebuiltContext install --prod --offline --frozen-lockfile --config.node-linker=hoisted
    if ($LASTEXITCODE -ne 0) { throw "Offline production dependency staging failed" }
    if (Get-ChildItem -LiteralPath (Join-Path $prebuiltContext "node_modules") -Recurse -Filter "*.node" -File | Select-Object -First 1) {
        throw "A native Node dependency prevents architecture-neutral staging"
    }

    & $docker buildx build --platform linux/arm64 --load --no-cache `
        --file (Join-Path $prebuiltContext "Dockerfile.prebuilt") `
        --build-arg "NODE_IMAGE=$nodeImage" `
        --label "com.home-tunnel.managed=true" `
        --label "org.opencontainers.image.version=$Version" `
        --label "org.opencontainers.image.revision=v$Version-product-refresh" `
        --tag $imageTag $prebuiltContext
    if ($LASTEXITCODE -ne 0) { throw "ARM64 control-center image build failed" }
}
finally {
    if (Test-Path -LiteralPath $prebuiltContext) {
        $resolvedContext = (Resolve-Path -LiteralPath $prebuiltContext).Path
        $safeToolsPrefix = $toolsRoot + [IO.Path]::DirectorySeparatorChar
        if (-not $resolvedContext.StartsWith($safeToolsPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing unsafe prebuilt context cleanup"
        }
        Remove-Item -LiteralPath $resolvedContext -Recurse -Force
    }
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
        --label "org.opencontainers.image.revision=v$Version-performance" `
        --tag $gatewayImageTag $gatewayContext
    if ($LASTEXITCODE -ne 0) { throw "ARM64 traffic-gateway image build failed" }
}
finally {
    if (Test-Path -LiteralPath $gatewayContext) {
        $resolvedContext = (Resolve-Path -LiteralPath $gatewayContext).Path
        $safeToolsPrefix = $toolsRoot + [IO.Path]::DirectorySeparatorChar
        if (-not $resolvedContext.StartsWith($safeToolsPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing unsafe gateway context cleanup"
        }
        Remove-Item -LiteralPath $resolvedContext -Recurse -Force
    }
}

$imageArchitecture = (& $docker image inspect -f "{{.Architecture}}" $imageTag).Trim()
$imageUser = (& $docker image inspect -f "{{.Config.User}}" $imageTag).Trim()
$imageVersion = (& $docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' $imageTag).Trim()
$imageId = (& $docker image inspect -f "{{.Id}}" $imageTag).Trim()
if ($LASTEXITCODE -ne 0 -or $imageArchitecture -ne "arm64" -or $imageUser -ne "10001:10001" -or $imageVersion -ne $Version) {
    throw "ARM64 image metadata validation failed"
}
$gatewayArchitecture = (& $docker image inspect -f "{{.Architecture}}" $gatewayImageTag).Trim()
$gatewayUser = (& $docker image inspect -f "{{.Config.User}}" $gatewayImageTag).Trim()
$gatewayVersion = (& $docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' $gatewayImageTag).Trim()
$gatewayImageId = (& $docker image inspect -f "{{.Id}}" $gatewayImageTag).Trim()
if ($LASTEXITCODE -ne 0 -or $gatewayArchitecture -ne "arm64" -or $gatewayUser -ne "10001:10001" -or $gatewayVersion -ne $Version) {
    throw "ARM64 traffic-gateway image metadata validation failed"
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$releaseName = "home-tunnel-ui-$Version-arm64-$stamp"
$releaseDirectory = Join-Path $OutputRoot $releaseName
if (Test-Path -LiteralPath $releaseDirectory) { throw "Refusing to overwrite $releaseDirectory" }

try {
    New-Item -ItemType Directory -Path $releaseDirectory | Out-Null
    $imageArchive = Join-Path $releaseDirectory "control-center-image.tar"
    & $docker image save --platform linux/arm64 --output $imageArchive $imageTag
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $imageArchive -PathType Leaf)) {
        throw "ARM64 image archive creation failed"
    }
    $gatewayImageArchive = Join-Path $releaseDirectory "traffic-gateway-image.tar"
    & $docker image save --platform linux/arm64 --output $gatewayImageArchive $gatewayImageTag
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $gatewayImageArchive -PathType Leaf)) {
        throw "ARM64 traffic-gateway image archive creation failed"
    }
    Copy-Item -LiteralPath $installerPath -Destination (Join-Path $releaseDirectory $expectedInstallerName)
    Copy-Item -LiteralPath $metadataPath -Destination (Join-Path $releaseDirectory "latest.json")
    Copy-Item -LiteralPath (Join-Path $deployRoot "scripts\update-ui.sh") -Destination (Join-Path $releaseDirectory "update-ui.sh")

    $files = [ordered]@{}
    foreach ($name in @("control-center-image.tar", "traffic-gateway-image.tar", $expectedInstallerName, "latest.json", "update-ui.sh")) {
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
    Write-Output "IMAGE_TAR_SHA256=$($files['control-center-image.tar'].sha256)"
    Write-Output "GATEWAY_IMAGE_TAR_SHA256=$($files['traffic-gateway-image.tar'].sha256)"
    Write-Output "INSTALLER_SHA256=$installerHash"
}
catch {
    $safePrefix = $allowedOutputRoot + [IO.Path]::DirectorySeparatorChar
    if ($releaseDirectory.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $releaseDirectory)) {
        [IO.Directory]::Delete($releaseDirectory, $true)
    }
    throw
}
