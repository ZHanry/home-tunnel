param(
    [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+(?:-rc\.[0-9]+)?$')]
    [string]$Version = "3.0.0-rc.2",
    [ValidateSet("amd64", "arm64")]
    [string]$Architecture = "arm64"
)

$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$null = New-Item -ItemType Directory -Force -Path (Join-Path $workspace ".codex-tools")
$toolsRoot = (Resolve-Path (Join-Path $workspace ".codex-tools")).Path
$testRoot = Join-Path $toolsRoot ("compose-smoke-" + [Guid]::NewGuid().ToString("N").Substring(0, 10))
if (-not $testRoot.StartsWith($toolsRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe test path"
}

$networkCreated = $false
$composePrepared = $false
try {
    $existing = @(& docker ps -a --format "{{.Names}}" | Where-Object { $_ -like "home-tunnel-*" })
    if ($existing.Count -gt 0) { throw "Existing Home Tunnel containers: $($existing -join ',')" }

    New-Item -ItemType Directory -Path $testRoot, (Join-Path $testRoot "secrets"), (Join-Path $testRoot "status"), (Join-Path $testRoot "downloads") | Out-Null
    $composeSource = Get-Content -Raw -LiteralPath (Join-Path $workspace "deploy\compose.yaml")
    $composeSource = $composeSource.Replace(
        "home-tunnel/control-center:3.0.0-rc.2-arm64",
        "home-tunnel/control-center:$Version-$Architecture"
    ).Replace(
        "home-tunnel/traffic-gateway:3.0.0-rc.2-arm64",
        "home-tunnel/traffic-gateway:$Version-$Architecture"
    )
    [IO.File]::WriteAllText(
        (Join-Path $testRoot "compose.yaml"),
        $composeSource,
        [Text.UTF8Encoding]::new($false)
    )
    Copy-Item -LiteralPath (Join-Path $workspace "deploy\compose.tcp.yaml") -Destination (Join-Path $testRoot "compose.tcp.yaml")
    # Docker Desktop validates the ARM64 release images through emulation on
    # x64 hosts. Node startup and health commands are much slower under QEMU,
    # so keep the production checks but give only this local smoke stack a
    # longer command timeout.
    $smokeOverride = @"
services:
  control-center:
    platform: linux/$Architecture
    healthcheck:
      timeout: 30s
  traffic-gateway:
    platform: linux/$Architecture
    healthcheck:
      timeout: 30s
  frps:
    platform: linux/$Architecture
    healthcheck:
      timeout: 15s
"@
    [IO.File]::WriteAllText(
        (Join-Path $testRoot "compose.smoke.yaml"),
        $smokeOverride,
        [Text.UTF8Encoding]::new($false)
    )
    $composeArgs = @(
        "-f", (Join-Path $testRoot "compose.yaml"),
        "-f", (Join-Path $testRoot "compose.tcp.yaml"),
        "-f", (Join-Path $testRoot "compose.smoke.yaml")
    )
    $composePrepared = $true
    $secrets = @{
        internal_service_key = "11" * 32
        frps_plugin_key = "22" * 32
        lease_signing_key = "33" * 32
        bootstrap_admin_password = "Local-Bootstrap-Only-Q8-safe"
    }
    foreach ($entry in $secrets.GetEnumerator()) {
        [IO.File]::WriteAllText(
            (Join-Path $testRoot ("secrets\" + $entry.Key)),
            $entry.Value + "`n",
            [Text.UTF8Encoding]::new($false)
        )
    }

    # FRPS actually loads this key pair and the control center validates the
    # PEM at startup, so the smoke stack needs a real throwaway certificate.
    $smokeKey = [Security.Cryptography.ECDsa]::Create([Security.Cryptography.ECCurve+NamedCurves]::nistP256)
    try {
        $smokeRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
            "CN=frps.home-tunnel.test",
            $smokeKey,
            [Security.Cryptography.HashAlgorithmName]::SHA256)
        $smokeSan = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
        $smokeSan.AddDnsName("frps.home-tunnel.test")
        $smokeRequest.CertificateExtensions.Add($smokeSan.Build())
        $smokeNotBefore = [DateTimeOffset]::UtcNow.AddMinutes(-5)
        $smokeCertificate = $smokeRequest.CreateSelfSigned($smokeNotBefore, $smokeNotBefore.AddDays(30))
        try {
            $smokeCertPem = "-----BEGIN CERTIFICATE-----`n" +
                [Convert]::ToBase64String($smokeCertificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert), "InsertLineBreaks").Replace("`r`n", "`n") +
                "`n-----END CERTIFICATE-----`n"
            $smokeKeyPem = "-----BEGIN PRIVATE KEY-----`n" +
                [Convert]::ToBase64String($smokeKey.ExportPkcs8PrivateKey(), "InsertLineBreaks").Replace("`r`n", "`n") +
                "`n-----END PRIVATE KEY-----`n"
            [IO.File]::WriteAllText((Join-Path $testRoot "secrets\frps_tls_cert.pem"), $smokeCertPem, [Text.UTF8Encoding]::new($false))
            [IO.File]::WriteAllText((Join-Path $testRoot "secrets\frps_tls_key.pem"), $smokeKeyPem, [Text.UTF8Encoding]::new($false))
        }
        finally {
            $smokeCertificate.Dispose()
        }
    }
    finally {
        $smokeKey.Dispose()
    }

    & docker network inspect home-tunnel-edge *> $null
    if ($LASTEXITCODE -ne 0) {
        & docker network create --label com.home-tunnel.local-smoke=true home-tunnel-edge *> $null
        if ($LASTEXITCODE -ne 0) { throw "Network create failed" }
        $networkCreated = $true
    }

    $env:HOME_TUNNEL_FRPS_BIND_ADDRESS = "127.0.0.1"
    $env:HOME_TUNNEL_PUBLIC_BASE_URL = "https://console.home-tunnel.test"
    $env:HOME_TUNNEL_TUNNEL_DOMAIN = "tunnel.home-tunnel.test"
    $env:HOME_TUNNEL_FRPS_PUBLIC_HOST = "frps.home-tunnel.test"
    $env:HOME_TUNNEL_FRPS_PORT = "17000"
    $env:HOME_TUNNEL_TCP_BIND_ADDRESS = "127.0.0.1"
    $env:HOME_TUNNEL_TCP_PORT_START = "11000"
    $env:HOME_TUNNEL_TCP_PORT_END = "11009"
    & docker compose @composeArgs up -d
    if ($LASTEXITCODE -ne 0) {
        & docker compose @composeArgs ps -a
        & docker compose @composeArgs logs --no-color --tail 100
        throw "Compose smoke start failed"
    }

    foreach ($name in @("home-tunnel-control-center", "home-tunnel-frps", "home-tunnel-traffic-gateway")) {
        $healthy = $false
        for ($index = 0; $index -lt 120; $index++) {
            $state = (& docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $name 2>$null).Trim()
            if ($state -eq "healthy") { $healthy = $true; break }
            if ($state -eq "exited") {
                & docker logs --tail 100 $name
                throw "$name exited"
            }
            Start-Sleep -Seconds 1
        }
        if (-not $healthy) {
            & docker logs --tail 100 $name
            throw "$name did not become healthy"
        }
    }

    function Invoke-ContainerCheck([string]$Name, [string]$Script, [string]$Failure) {
        # An emulated process can very occasionally lose its binfmt handler
        # between execs on Docker Desktop. Retry only the read-only assertion;
        # native ARM64 hosts complete on the first attempt.
        for ($attempt = 0; $attempt -lt 5; $attempt++) {
            & docker exec $Name node -e $Script
            if ($LASTEXITCODE -eq 0) { return }
            Start-Sleep -Seconds 2
        }
        throw $Failure
    }
    function Invoke-ContainerCommand([string]$Name, [string[]]$Arguments, [string]$Failure) {
        for ($attempt = 0; $attempt -lt 5; $attempt++) {
            $output = @(& docker exec $Name @Arguments)
            if ($LASTEXITCODE -eq 0) { return ($output -join "`n").Trim() }
            Start-Sleep -Seconds 2
        }
        throw $Failure
    }
    Invoke-ContainerCheck "home-tunnel-control-center" "fetch('http://127.0.0.1:8080/healthz').then(async r=>{if(r.ok===false)process.exit(1);const j=await r.json();console.log(j.status,j.version)}).catch(()=>process.exit(1))" "Control health request failed"
    Invoke-ContainerCheck "home-tunnel-traffic-gateway" "fetch('http://127.0.0.1:8080/healthz',{headers:{host:'127.0.0.1'}}).then(async r=>{if(r.ok===false)process.exit(1);const j=await r.json();console.log(j.status,j.revision)}).catch(()=>process.exit(1))" "Gateway health request failed"

    foreach ($name in @("home-tunnel-control-center", "home-tunnel-traffic-gateway", "home-tunnel-frps")) {
        $uid = Invoke-ContainerCommand $name @("id", "-u") "Could not read uid from $name"
        if ($uid -ne "10001") { throw "$name runs as uid $uid" }
        Write-Output "$name uid=$uid"
    }
    $migrationVersion = Invoke-ContainerCommand "home-tunnel-control-center" @("node", "--input-type=module", "-e", "import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync(process.env.SQLITE_PATH,{readOnly:true}); console.log(db.prepare('SELECT max(version) AS version FROM schema_migrations').get().version); db.close()") "Migration query failed"
    if ($migrationVersion -ne "7") { throw "Expected migration 7, received $migrationVersion" }
    Write-Output "schema migration=$migrationVersion"
    $allowPorts = Invoke-ContainerCommand "home-tunnel-frps" @("grep", "-F", "allowPorts = [{ start = 11000, end = 11009 }]", "/run/frp/frps.toml") "FRPS TCP allowPorts configuration was not applied"
    Write-Output $allowPorts
    & docker compose @composeArgs ps
}
finally {
    if ($composePrepared) {
        & docker compose @composeArgs down -v --remove-orphans *> $null
    }
    if ($networkCreated) {
        $label = (& docker network inspect -f "{{index .Labels `"com.home-tunnel.local-smoke`"}}" home-tunnel-edge 2>$null).Trim()
        $containers = (& docker network inspect -f "{{len .Containers}}" home-tunnel-edge 2>$null).Trim()
        if ($label -eq "true" -and $containers -eq "0") {
            & docker network rm home-tunnel-edge *> $null
        }
    }
    if (Test-Path -LiteralPath $testRoot) {
        $resolved = (Resolve-Path -LiteralPath $testRoot).Path
        if (-not $resolved.StartsWith($toolsRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing unsafe cleanup"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

Write-Output "Local Compose smoke resources removed."
