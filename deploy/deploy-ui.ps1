[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ReleaseDirectory,
    [Parameter(Mandatory = $true)]
    [string]$ServerAddress,
    [string]$SshUser = "ubuntu",
    [string]$KeyPath = "",
    [string]$CaddyFilePath = "",
    [switch]$PreflightOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$deployRoot = $PSScriptRoot
$workspace = Split-Path -Parent $deployRoot
$KeyPath = if ($KeyPath) {
    $KeyPath
} elseif ($env:HOME_TUNNEL_SSH_KEY) {
    $env:HOME_TUNNEL_SSH_KEY
} else {
    Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)) "a.key"
}
$allowedReleaseRoot = [IO.Path]::GetFullPath((Join-Path $workspace "outputs\server"))
$ReleaseDirectory = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$releasePrefix = $allowedReleaseRoot + [IO.Path]::DirectorySeparatorChar
if (-not $ReleaseDirectory.StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Release directory must be below $allowedReleaseRoot"
}
if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw "SSH key is missing: $KeyPath" }
if ($ServerAddress -notmatch '^[A-Za-z0-9.-]+$' -or $SshUser -notmatch '^[a-z_][a-z0-9_-]*$') {
    throw "Invalid SSH target"
}
if ($CaddyFilePath -and $CaddyFilePath -notmatch '^/opt(?:/[A-Za-z0-9._-]+)+/Caddyfile$') {
    throw "Invalid remote Caddyfile path"
}

$releaseJsonPath = Join-Path $ReleaseDirectory "release.json"
if (-not (Test-Path -LiteralPath $releaseJsonPath -PathType Leaf)) { throw "release.json is missing" }
$release = Get-Content -Raw -LiteralPath $releaseJsonPath | ConvertFrom-Json
$version = [string]$release.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid release version" }
$expectedImageTag = "home-tunnel/control-center:$version-arm64"
$expectedGatewayImageTag = "home-tunnel/traffic-gateway:$version-arm64"
if ($release.target -ne "linux/arm64" -or $release.image_tag -ne $expectedImageTag -or
    $release.gateway_image_tag -ne $expectedGatewayImageTag) {
    throw "Release target metadata is invalid"
}

$installerName = "HomeTunnel-Setup-$version-x64.exe"
$fileNames = @("control-center-image.tar", "traffic-gateway-image.tar", $installerName, "latest.json", "update-ui.sh")
$localFiles = @{}
foreach ($name in $fileNames) {
    $path = Join-Path $ReleaseDirectory $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Release file is missing: $name" }
    $entry = $release.files.$name
    if (-not $entry) { throw "Release hash metadata is missing: $name" }
    $actualHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $actualSize = (Get-Item -LiteralPath $path).Length
    if ($entry.sha256 -ne $actualHash -or $entry.size_bytes -ne $actualSize) {
        throw "Release file does not match release.json: $name"
    }
    $localFiles[$name] = [pscustomobject]@{ Path = $path; Hash = $actualHash; Size = $actualSize }
}

$latest = Get-Content -Raw -LiteralPath $localFiles["latest.json"].Path | ConvertFrom-Json
$expectedDownloadUrl = "https://github.com/ZHanry/home-tunnel/releases/download/v$version/$installerName"
if ($latest.version -ne $version -or $latest.file_name -ne $installerName -or
    $latest.sha256 -ne $localFiles[$installerName].Hash -or $latest.size_bytes -ne $localFiles[$installerName].Size -or
    $latest.download_url -ne $expectedDownloadUrl -or
    $latest.stable_download_url -ne "https://github.com/ZHanry/home-tunnel/releases/latest") {
    throw "Installer and latest.json do not match"
}

$ssh = Get-Command ssh -ErrorAction Stop | Select-Object -ExpandProperty Source -First 1
$scp = Get-Command scp -ErrorAction Stop | Select-Object -ExpandProperty Source -First 1
$sshTarget = "$SshUser@$ServerAddress"
$commonArgs = @(
    "-i", $KeyPath,
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3"
)

function Invoke-Remote([string]$Command) {
    $output = & $ssh @commonArgs $sshTarget $Command 2>&1
    if ($LASTEXITCODE -ne 0) {
        $message = ($output | Out-String).Trim()
        throw "Remote command failed: $message"
    }
    return @($output)
}

$caddySelector = if ($CaddyFilePath) {
    'caddyfile="' + $CaddyFilePath + '"'
} else {
@'
caddyfile=""
caddy_count=0
for candidate in /opt/caddy/Caddyfile /opt/*/caddy/Caddyfile; do
  [ -f "$candidate" ] || continue
  caddyfile="$candidate"
  caddy_count=$((caddy_count + 1))
done
[ "$caddy_count" -eq 1 ]
'@
}

$preflightCommand = @'
sudo -n sh -c 'set -eu
[ "$(uname -m)" = "aarch64" ]
__CADDY_SELECTOR__
printf "CADDY_PATH=%s\n" "$caddyfile"
printf "CADDY_SHA="; sha256sum "$caddyfile" | cut -d" " -f1
printf "CADDY_INODE="; stat -c "%i" "$caddyfile"
printf "ROOT_FREE_KB="; df -Pk / | awk "NR==2 {print \$4}"
for name in home-tunnel-postgres home-tunnel-control-center home-tunnel-frps home-tunnel-traffic-gateway; do
  printf "%s=" "$name"
  docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}|{{.Image}}|{{.State.StartedAt}}" "$name"
done
printf "CONTROL_COMPOSE_IMAGE="
awk "/^  control-center:/{inside=1;next} inside && /^  [A-Za-z0-9_-]+:/{exit} inside && /^    image:/{print \$2;exit}" /opt/home-tunnel/compose.yaml
printf "GATEWAY_COMPOSE_IMAGE="
awk "/^  traffic-gateway:/{inside=1;next} inside && /^  [A-Za-z0-9_-]+:/{exit} inside && /^    image:/{print \$2;exit}" /opt/home-tunnel/compose.yaml
'
'@
$preflightCommand = $preflightCommand.Replace("__CADDY_SELECTOR__", $caddySelector)
$preflight = (Invoke-Remote $preflightCommand) -join "`n"
$caddyPath = [regex]::Match($preflight, '(?m)^CADDY_PATH=(/opt(?:/[A-Za-z0-9._-]+)+/Caddyfile)$').Groups[1].Value
$caddyHash = [regex]::Match($preflight, '(?m)^CADDY_SHA=([0-9a-f]{64})$').Groups[1].Value
$caddyInode = [regex]::Match($preflight, '(?m)^CADDY_INODE=([0-9]+)$').Groups[1].Value
$freeKb = [regex]::Match($preflight, '(?m)^ROOT_FREE_KB=([0-9]+)$').Groups[1].Value
if (-not $caddyPath -or -not $caddyHash -or -not $caddyInode -or -not $freeKb) { throw "Could not freeze the production baseline" }
if ([long]$freeKb -lt 4194304) { throw "Server has less than 4 GiB free disk space" }
foreach ($name in @("home-tunnel-postgres", "home-tunnel-control-center", "home-tunnel-frps", "home-tunnel-traffic-gateway")) {
    if ($preflight -notmatch "(?m)^$([regex]::Escape($name))=healthy\|") {
        throw "$name is not healthy before deployment"
    }
}
if ($PreflightOnly) {
    Write-Output "PREFLIGHT=passed"
    Write-Output "VERSION=$version"
    Write-Output "CADDY_SHA256=$caddyHash"
    Write-Output "CADDY_INODE=$caddyInode"
    Write-Output "ROOT_FREE_KB=$freeKb"
    return
}

$suffix = [Guid]::NewGuid().ToString("N").Substring(0, 10)
$stage = "/tmp/home-tunnel-ui-$version-$suffix"
if ($stage -notmatch '^/tmp/home-tunnel-ui-[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{10}$') { throw "Unsafe remote stage" }
$stageCreated = $false
$deploymentSucceeded = $false

try {
    Invoke-Remote "umask 077; install -d -m 0700 '$stage'" | Out-Null
    $stageCreated = $true

    foreach ($name in $fileNames) {
        $destination = "${SshUser}@${ServerAddress}:$stage/$name"
        $uploadOutput = & $scp @commonArgs -- $localFiles[$name].Path $destination 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Upload failed for ${name}: $(($uploadOutput | Out-String).Trim())"
        }
    }

    $remoteHashCommand = "cd '$stage'; sha256sum control-center-image.tar traffic-gateway-image.tar '$installerName' latest.json update-ui.sh"
    $remoteHashes = (Invoke-Remote $remoteHashCommand) -join "`n"
    foreach ($name in $fileNames) {
        if ($remoteHashes -notmatch "(?m)^$($localFiles[$name].Hash)  $([regex]::Escape($name))$") {
            throw "Remote SHA-256 verification failed for $name"
        }
    }

    $deployCommand = "sudo -n env CADDYFILE_PATH='$caddyPath' sh '$stage/update-ui.sh' '$stage' '$version' '$($localFiles['control-center-image.tar'].Hash)' '$($localFiles['traffic-gateway-image.tar'].Hash)' '$($localFiles[$installerName].Hash)' '$($localFiles['latest.json'].Hash)' '$caddyHash' '$caddyInode'"
    $deploymentOutput = Invoke-Remote $deployCommand
    $deploymentSucceeded = $true

    $postflightCommand = @'
sudo -n sh -c 'set -eu
[ ! -e "__STAGE__" ]
[ "$(sha256sum "__CADDY_PATH__" | awk "{print \$1}")" = "__CADDY_SHA__" ]
[ "$(stat -c "%i" "__CADDY_PATH__")" = "__CADDY_INODE__" ]
new_id="$(docker image inspect -f "{{.Id}}" "__IMAGE_TAG__")"
new_gateway_id="$(docker image inspect -f "{{.Id}}" "__GATEWAY_IMAGE_TAG__")"
[ "$(docker inspect -f "{{.Image}}" home-tunnel-control-center)" = "$new_id" ]
[ "$(docker inspect -f "{{.Image}}" home-tunnel-traffic-gateway)" = "$new_gateway_id" ]
[ "$(docker inspect -f "{{.State.Health.Status}}" home-tunnel-control-center)" = "healthy" ]
[ "$(docker inspect -f "{{.State.Health.Status}}" home-tunnel-traffic-gateway)" = "healthy" ]
[ "$(docker image inspect -f "{{index .Config.Labels \"org.opencontainers.image.version\"}}" "__IMAGE_TAG__")" = "__VERSION__" ]
[ "$(docker image inspect -f "{{index .Config.Labels \"org.opencontainers.image.version\"}}" "__GATEWAY_IMAGE_TAG__")" = "__VERSION__" ]
[ -f "/opt/home-tunnel/downloads/__INSTALLER__" ]
[ "$(sha256sum "/opt/home-tunnel/downloads/__INSTALLER__" | awk "{print \$1}")" = "__INSTALLER_SHA__" ]
[ ! -e /opt/home-tunnel/compose.yaml.new ]
[ ! -e "/opt/home-tunnel/downloads/__INSTALLER__.new" ]
[ ! -e "/opt/home-tunnel/downloads/__INSTALLER__.rollback" ]
[ ! -e /opt/home-tunnel/downloads/latest.json.new ]
[ ! -e /opt/home-tunnel/downloads/latest.json.rollback ]
! docker image ls --format "{{.Repository}}:{{.Tag}}" | grep -q "^home-tunnel/control-center:rollback-ui-"
! docker image ls --format "{{.Repository}}:{{.Tag}}" | grep -q "^home-tunnel/traffic-gateway:rollback-ui-"
docker image ls --format "{{.Repository}}:{{.Tag}}" | grep "^home-tunnel/control-center:"
docker image ls --format "{{.Repository}}:{{.Tag}}" | grep "^home-tunnel/traffic-gateway:"
'
'@
    $postflightCommand = $postflightCommand.Replace("__STAGE__", $stage).
        Replace("__CADDY_PATH__", $caddyPath).
        Replace("__CADDY_SHA__", $caddyHash).
        Replace("__CADDY_INODE__", $caddyInode).
        Replace("__IMAGE_TAG__", $expectedImageTag).
        Replace("__GATEWAY_IMAGE_TAG__", $expectedGatewayImageTag).
        Replace("__VERSION__", $version).
        Replace("__INSTALLER__", $installerName).
        Replace("__INSTALLER_SHA__", $localFiles[$installerName].Hash)
    $postflight = Invoke-Remote $postflightCommand

    $audit = [ordered]@{
        completed_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        server = $ServerAddress
        version = $version
        image_tag = $expectedImageTag
        gateway_image_tag = $expectedGatewayImageTag
        installer_sha256 = $localFiles[$installerName].Hash
        image_archive_sha256 = $localFiles["control-center-image.tar"].Hash
        gateway_image_archive_sha256 = $localFiles["traffic-gateway-image.tar"].Hash
        metadata_sha256 = $localFiles["latest.json"].Hash
        caddy_sha256 = $caddyHash
        caddy_inode = $caddyInode
        remote_result = ($deploymentOutput -join "`n").Trim()
        remaining_control_center_tags = @($postflight)
        temporary_stage_removed = $true
    }
    $auditPath = Join-Path $ReleaseDirectory "deployment-audit.json"
    [IO.File]::WriteAllText($auditPath, ($audit | ConvertTo-Json -Depth 4) + "`n", [Text.UTF8Encoding]::new($false))
    Write-Output "DEPLOYED_VERSION=$version"
    Write-Output "DEPLOYMENT_AUDIT=$auditPath"
}
finally {
    if ($stageCreated -and -not $deploymentSucceeded) {
        try { Invoke-Remote "case '$stage' in /tmp/home-tunnel-ui-*) rm -rf -- '$stage' ;; *) exit 64 ;; esac" | Out-Null } catch {}
    }
}
