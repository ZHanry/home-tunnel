$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
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
    Copy-Item -LiteralPath (Join-Path $workspace "deploy\compose.yaml") -Destination (Join-Path $testRoot "compose.yaml")
    Copy-Item -LiteralPath (Join-Path $workspace "deploy\compose.tcp.yaml") -Destination (Join-Path $testRoot "compose.tcp.yaml")
    $composeArgs = @("-f", (Join-Path $testRoot "compose.yaml"), "-f", (Join-Path $testRoot "compose.tcp.yaml"))
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

    & docker exec home-tunnel-control-center node -e "fetch('http://127.0.0.1:8080/healthz').then(async r=>{if(r.ok===false)process.exit(1);const j=await r.json();console.log(j.status,j.version)}).catch(()=>process.exit(1))"
    if ($LASTEXITCODE -ne 0) { throw "Control health request failed" }
    & docker exec home-tunnel-traffic-gateway node -e "fetch('http://127.0.0.1:8080/healthz',{headers:{host:'127.0.0.1'}}).then(async r=>{if(r.ok===false)process.exit(1);const j=await r.json();console.log(j.status,j.revision)}).catch(()=>process.exit(1))"
    if ($LASTEXITCODE -ne 0) { throw "Gateway health request failed" }

    foreach ($name in @("home-tunnel-control-center", "home-tunnel-traffic-gateway", "home-tunnel-frps")) {
        $uid = (& docker exec $name id -u).Trim()
        if ($uid -ne "10001") { throw "$name runs as uid $uid" }
        Write-Output "$name uid=$uid"
    }
    & docker exec home-tunnel-control-center node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync(process.env.SQLITE_PATH,{readOnly:true}); console.log(db.prepare('SELECT max(version) AS version FROM schema_migrations').get().version); db.close()"
    if ($LASTEXITCODE -ne 0) { throw "Migration query failed" }
    & docker exec home-tunnel-frps grep -F "allowPorts = [{ start = 11000, end = 11009 }]" /run/frp/frps.toml
    if ($LASTEXITCODE -ne 0) { throw "FRPS TCP allowPorts configuration was not applied" }
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
