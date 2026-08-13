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
if ($version -notmatch '^\d+\.\d+\.\d+(?:-rc\.\d+)?$') { throw "Invalid release version" }
$expectedImageTag = "home-tunnel/control-center:$version-arm64"
$expectedGatewayImageTag = "home-tunnel/traffic-gateway:$version-arm64"
if ($release.target -ne "linux/arm64" -or $release.image_tag -ne $expectedImageTag -or
    $release.gateway_image_tag -ne $expectedGatewayImageTag) {
    throw "Release target metadata is invalid"
}

$fileNames = @("home-tunnel-ui-images.tar", "update-ui.sh")
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
if docker ps -a --format "{{.Names}}" | grep -qx home-tunnel-postgres || grep -Eq "^  postgres:" /opt/home-tunnel/compose.yaml; then
  printf "LEGACY_POSTGRES=1\n"
else
  printf "LEGACY_POSTGRES=0\n"
  grep -q "SQLITE_PATH: /data/home-tunnel.db" /opt/home-tunnel/compose.yaml
  grep -q "sqlite-data:/data" /opt/home-tunnel/compose.yaml
fi
for name in home-tunnel-control-center home-tunnel-frps home-tunnel-traffic-gateway; do
  printf "%s=" "$name"
  docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}|{{.Image}}|{{.State.StartedAt}}" "$name"
done
'
'@
$preflightCommand = $preflightCommand.Replace("__CADDY_SELECTOR__", $caddySelector)
$preflight = (Invoke-Remote $preflightCommand) -join "`n"
$caddyPath = [regex]::Match($preflight, '(?m)^CADDY_PATH=(/opt(?:/[A-Za-z0-9._-]+)+/Caddyfile)$').Groups[1].Value
$caddyHash = [regex]::Match($preflight, '(?m)^CADDY_SHA=([0-9a-f]{64})$').Groups[1].Value
$caddyInode = [regex]::Match($preflight, '(?m)^CADDY_INODE=([0-9]+)$').Groups[1].Value
$freeKb = [regex]::Match($preflight, '(?m)^ROOT_FREE_KB=([0-9]+)$').Groups[1].Value
if (-not $caddyPath -or -not $caddyHash -or -not $caddyInode -or -not $freeKb) { throw "Could not freeze the production baseline" }
if ($preflight -match '(?m)^LEGACY_POSTGRES=1$') {
    throw "Legacy PostgreSQL deployment detected. This SQLite update intentionally stops before changing data; export or migrate the old database first."
}
$archiveKb = [Math]::Ceiling([double]$localFiles["home-tunnel-ui-images.tar"].Size / 1KB)
$requiredFreeKb = [Math]::Max(1048576, [long]($archiveKb * 3 + 262144))
if ([long]$freeKb -lt $requiredFreeKb) { throw "Server does not have enough free disk space for a rollback-safe update" }
foreach ($name in @("home-tunnel-control-center", "home-tunnel-frps", "home-tunnel-traffic-gateway")) {
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
if ($stage -notmatch '^/tmp/home-tunnel-ui-[0-9]+\.[0-9]+\.[0-9]+(?:-rc\.[0-9]+)?-[0-9a-f]{10}$') { throw "Unsafe remote stage" }
$stageCreated = $false
$deploymentSucceeded = $false

try {
    Invoke-Remote "umask 077; install -d -m 0700 '$stage'" | Out-Null
    $stageCreated = $true
    foreach ($name in $fileNames) {
        $destination = "${SshUser}@${ServerAddress}:$stage/$name"
        $uploadOutput = & $scp @commonArgs -- $localFiles[$name].Path $destination 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Upload failed for ${name}: $(($uploadOutput | Out-String).Trim())" }
    }

    $remoteHashes = (Invoke-Remote "cd '$stage'; sha256sum home-tunnel-ui-images.tar update-ui.sh") -join "`n"
    foreach ($name in $fileNames) {
        if ($remoteHashes -notmatch "(?m)^$($localFiles[$name].Hash)  $([regex]::Escape($name))$") {
            throw "Remote SHA-256 verification failed for $name"
        }
    }

    $deployCommand = "sudo -n env CADDYFILE_PATH='$caddyPath' sh '$stage/update-ui.sh' '$stage' '$version' '$($localFiles['home-tunnel-ui-images.tar'].Hash)' '$caddyHash' '$caddyInode'"
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
[ "$(docker inspect -f "{{.State.Health.Status}}" home-tunnel-frps)" = "healthy" ]
[ "$(docker image inspect -f "{{index .Config.Labels \"org.opencontainers.image.version\"}}" "__IMAGE_TAG__")" = "__VERSION__" ]
[ "$(docker image inspect -f "{{index .Config.Labels \"org.opencontainers.image.version\"}}" "__GATEWAY_IMAGE_TAG__")" = "__VERSION__" ]
! docker ps -a --format "{{.Names}}" | grep -qx home-tunnel-postgres
! find /opt/home-tunnel/downloads -maxdepth 1 -type f -name "HomeTunnel-Setup-*-x64.exe" | grep -q .
[ ! -e /opt/home-tunnel/compose.yaml.new ]
! docker image ls --format "{{.Repository}}:{{.Tag}}" | grep -q "^home-tunnel/control-center:rollback-ui-"
! docker image ls --format "{{.Repository}}:{{.Tag}}" | grep -q "^home-tunnel/traffic-gateway:rollback-ui-"
'
'@
    $postflightCommand = $postflightCommand.Replace("__STAGE__", $stage).
        Replace("__CADDY_PATH__", $caddyPath).
        Replace("__CADDY_SHA__", $caddyHash).
        Replace("__CADDY_INODE__", $caddyInode).
        Replace("__IMAGE_TAG__", $expectedImageTag).
        Replace("__GATEWAY_IMAGE_TAG__", $expectedGatewayImageTag).
        Replace("__VERSION__", $version)
    $postflight = Invoke-Remote $postflightCommand

    $audit = [ordered]@{
        completed_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        server = $ServerAddress
        version = $version
        image_tag = $expectedImageTag
        gateway_image_tag = $expectedGatewayImageTag
        combined_image_archive_sha256 = $localFiles["home-tunnel-ui-images.tar"].Hash
        caddy_sha256 = $caddyHash
        caddy_inode = $caddyInode
        remote_result = ($deploymentOutput -join "`n").Trim()
        postflight = @($postflight)
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
