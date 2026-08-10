[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$TunnelDomain,
    [Parameter(Mandatory = $true)]
    [string]$FrpsPublicHost,
    [string]$ConsoleHost = "",
    [string]$AcmeEmail = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$deployRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $deployRoot
$environmentPath = Join-Path $workspaceRoot ".env"
$secretRoot = Join-Path $deployRoot "secrets"

$TunnelDomain = $TunnelDomain.Trim().Trim(".").ToLowerInvariant()
$FrpsPublicHost = $FrpsPublicHost.Trim()
if (-not $ConsoleHost) { $ConsoleHost = "console.$TunnelDomain" }
$ConsoleHost = $ConsoleHost.Trim().Trim(".").ToLowerInvariant()
if (-not $AcmeEmail) { $AcmeEmail = "admin@$TunnelDomain" }
$AcmeEmail = $AcmeEmail.Trim()

$dnsPattern = '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
if ($TunnelDomain -notmatch $dnsPattern) { throw "TunnelDomain is not a valid DNS suffix" }
if ($ConsoleHost -notmatch $dnsPattern) { throw "ConsoleHost is not a valid DNS name" }
if ($FrpsPublicHost -notmatch '^[A-Za-z0-9.-]{1,253}$') { throw "FrpsPublicHost is not a valid host or IP address" }
if ($AcmeEmail -notmatch '^[^\s@]+@[^\s@]+$') { throw "AcmeEmail is not valid" }

$secretNames = @(
    "postgres_password",
    "internal_service_key",
    "frps_plugin_key",
    "lease_signing_key",
    "bootstrap_admin_password"
)
$existing = @($environmentPath) + @($secretNames | ForEach-Object { Join-Path $secretRoot $_ }) |
    Where-Object { Test-Path -LiteralPath $_ }
if ($existing.Count -gt 0 -and -not $Force) {
    throw "Local configuration already exists. Re-run with -Force only if you intend to rotate and replace it."
}

function New-HexSecret([int]$Bytes) {
    return [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)).ToLowerInvariant()
}

if ($PSCmdlet.ShouldProcess($workspaceRoot, "create local self-host configuration and secrets")) {
    New-Item -ItemType Directory -Force -Path $secretRoot | Out-Null
    $values = @{
        postgres_password = New-HexSecret 32
        internal_service_key = New-HexSecret 32
        frps_plugin_key = New-HexSecret 32
        lease_signing_key = New-HexSecret 32
        bootstrap_admin_password = "Ht-$(New-HexSecret 18)-A7!"
    }
    foreach ($name in $secretNames) {
        [IO.File]::WriteAllText((Join-Path $secretRoot $name), $values[$name] + "`n", [Text.UTF8Encoding]::new($false))
    }

    $environment = @"
HOME_TUNNEL_VERSION=2.2.5
HOME_TUNNEL_CONSOLE_HOST=$ConsoleHost
HOME_TUNNEL_TUNNEL_DOMAIN=$TunnelDomain
HOME_TUNNEL_PUBLIC_BASE_URL=https://$ConsoleHost
HOME_TUNNEL_FRPS_PUBLIC_HOST=$FrpsPublicHost
HOME_TUNNEL_FRPS_BIND_ADDRESS=0.0.0.0
HOME_TUNNEL_FRPS_PORT=7000
HOME_TUNNEL_ACME_EMAIL=$AcmeEmail
HOME_TUNNEL_BOOTSTRAP_ADMIN_USERNAME=admin
"@
    [IO.File]::WriteAllText($environmentPath, $environment.TrimStart() + "`n", [Text.UTF8Encoding]::new($false))
    $values.Clear()

    Write-Output "Created $environmentPath"
    Write-Output "Created five untracked secret files below $secretRoot"
    Write-Output "Bootstrap username: admin"
    Write-Output "Read deploy/secrets/bootstrap_admin_password locally for the one-time password."
}
