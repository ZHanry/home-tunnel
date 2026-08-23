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
if ($FrpsPublicHost.StartsWith("[") -and $FrpsPublicHost.EndsWith("]")) {
    $FrpsPublicHost = $FrpsPublicHost.Substring(1, $FrpsPublicHost.Length - 2)
}
if (-not $ConsoleHost) { $ConsoleHost = "console.$TunnelDomain" }
$ConsoleHost = $ConsoleHost.Trim().Trim(".").ToLowerInvariant()
if (-not $AcmeEmail) { $AcmeEmail = "admin@$TunnelDomain" }
$AcmeEmail = $AcmeEmail.Trim()

$dnsPattern = '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
if ($TunnelDomain -notmatch $dnsPattern) { throw "TunnelDomain is not a valid DNS suffix" }
if ($ConsoleHost -notmatch $dnsPattern) { throw "ConsoleHost is not a valid DNS name" }
$parsedFrpsIp = $null
$frpsHostIsIp = [Net.IPAddress]::TryParse($FrpsPublicHost, [ref]$parsedFrpsIp)
if (-not $frpsHostIsIp -and $FrpsPublicHost -notmatch '^[A-Za-z0-9.-]{1,253}$') {
    throw "FrpsPublicHost is not a valid host or IP address"
}
if ($AcmeEmail -notmatch '^[^\s@]+@[^\s@]+$') { throw "AcmeEmail is not valid" }

$secretNames = @(
    "internal_service_key",
    "frps_plugin_key",
    "lease_signing_key",
    "bootstrap_admin_password"
)
$existing = @(
    @($environmentPath) + @($secretNames | ForEach-Object { Join-Path $secretRoot $_ }) |
        Where-Object { Test-Path -LiteralPath $_ }
)
if ($existing.Count -gt 0 -and -not $Force) {
    throw "Local configuration already exists. Re-run with -Force only if you intend to rotate and replace it."
}

function New-HexSecret([int]$Bytes) {
    return [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)).ToLowerInvariant()
}

if ($PSCmdlet.ShouldProcess($workspaceRoot, "create local self-host configuration and secrets")) {
    New-Item -ItemType Directory -Force -Path $secretRoot | Out-Null
    $values = @{
        internal_service_key = New-HexSecret 32
        frps_plugin_key = New-HexSecret 32
        lease_signing_key = New-HexSecret 32
        bootstrap_admin_password = "Ht-$(New-HexSecret 18)-A7!"
    }
    foreach ($name in $secretNames) {
        [IO.File]::WriteAllText((Join-Path $secretRoot $name), $values[$name] + "`n", [Text.UTF8Encoding]::new($false))
    }
    # Ten-year self-signed FRPS TLS certificate: the control center serves the
    # public part through /api/v1/public/config so managed clients can pin the
    # FRPS identity. Skip generation when both files already exist (idempotent).
    $certPath = Join-Path $secretRoot "frps_tls_cert.pem"
    $keyPath = Join-Path $secretRoot "frps_tls_key.pem"
    if (-not ((Test-Path -LiteralPath $certPath) -and (Test-Path -LiteralPath $keyPath))) {
        $key = [Security.Cryptography.ECDsa]::Create([Security.Cryptography.ECCurve+NamedCurves]::nistP256)
        try {
            $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
                "CN=$FrpsPublicHost",
                $key,
                [Security.Cryptography.HashAlgorithmName]::SHA256)
            $sanBuilder = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
            if ($frpsHostIsIp) {
                $sanBuilder.AddIpAddress($parsedFrpsIp)
            }
            else {
                $sanBuilder.AddDnsName($FrpsPublicHost)
            }
            $request.CertificateExtensions.Add($sanBuilder.Build())
            $notBefore = [DateTimeOffset]::UtcNow.AddMinutes(-5)
            $certificate = $request.CreateSelfSigned($notBefore, $notBefore.AddDays(3650))
            try {
                $certPem = "-----BEGIN CERTIFICATE-----`n" +
                    [Convert]::ToBase64String($certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert), "InsertLineBreaks").Replace("`r`n", "`n") +
                    "`n-----END CERTIFICATE-----`n"
                $keyPem = "-----BEGIN PRIVATE KEY-----`n" +
                    [Convert]::ToBase64String($key.ExportPkcs8PrivateKey(), "InsertLineBreaks").Replace("`r`n", "`n") +
                    "`n-----END PRIVATE KEY-----`n"
                [IO.File]::WriteAllText($certPath, $certPem, [Text.UTF8Encoding]::new($false))
                [IO.File]::WriteAllText($keyPath, $keyPem, [Text.UTF8Encoding]::new($false))
            }
            finally {
                $certificate.Dispose()
            }
        }
        finally {
            $key.Dispose()
        }
    }

    # Secret files must stay readable by the non-root container user (uid 10001):
    # compose bind mounts them with host ownership, so 0600 root-owned files would
    # be unreadable inside the containers. World-read 0644 on the files is safe
    # because the 0700 directory blocks other host users from reaching them (bind
    # mount path resolution is done by the docker daemon, not the container).
    if ($IsLinux -or $IsMacOS) {
        chmod 0700 $secretRoot
        foreach ($name in $secretNames + @("frps_tls_cert.pem", "frps_tls_key.pem")) {
            chmod 0644 (Join-Path $secretRoot $name)
        }
    }

    $environment = @"
HOME_TUNNEL_VERSION=3.2.0-rc.2
HOME_TUNNEL_CONSOLE_HOST=$ConsoleHost
HOME_TUNNEL_TUNNEL_DOMAIN=$TunnelDomain
HOME_TUNNEL_PUBLIC_BASE_URL=https://$ConsoleHost
HOME_TUNNEL_FRPS_PUBLIC_HOST=$FrpsPublicHost
HOME_TUNNEL_FRPS_BIND_ADDRESS=0.0.0.0
HOME_TUNNEL_FRPS_PORT=7000
HOME_TUNNEL_TCP_BIND_ADDRESS=0.0.0.0
HOME_TUNNEL_TCP_PORT_START=10000
HOME_TUNNEL_TCP_PORT_END=10099
HOME_TUNNEL_UDP_BIND_ADDRESS=0.0.0.0
HOME_TUNNEL_UDP_PORT_START=10000
HOME_TUNNEL_UDP_PORT_END=10099
HOME_TUNNEL_L4_BIND_ADDRESS=0.0.0.0
HOME_TUNNEL_L4_PORT_START=10000
HOME_TUNNEL_L4_PORT_END=10099
HOME_TUNNEL_ACME_EMAIL=$AcmeEmail
HOME_TUNNEL_BOOTSTRAP_ADMIN_USERNAME=admin
"@
    [IO.File]::WriteAllText($environmentPath, $environment.TrimStart() + "`n", [Text.UTF8Encoding]::new($false))
    $values.Clear()

    Write-Output "Created $environmentPath"
    Write-Output "Created the untracked secret files below $secretRoot"
    Write-Output "Bootstrap username: admin"
    Write-Output "Read deploy/secrets/bootstrap_admin_password locally for the one-time password."
}
