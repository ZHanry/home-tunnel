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
    $composePrepared = $true
    $secrets = @{
        postgres_password_db = "Local-Compose-Only-Db-9-safe"
        postgres_password_control = "Local-Compose-Only-Db-9-safe"
        internal_service_key = "11" * 32
        frps_plugin_key_control = "22" * 32
        frps_plugin_key_frps = "22" * 32
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

    & docker network inspect home-tunnel-edge *> $null
    if ($LASTEXITCODE -ne 0) {
        & docker network create --label com.home-tunnel.local-smoke=true home-tunnel-edge *> $null
        if ($LASTEXITCODE -ne 0) { throw "Network create failed" }
        $networkCreated = $true
    }

    $env:FRPS_BIND_ADDRESS = "127.0.0.1"
    $env:FRPS_HOST_PORT = "17000"
    $env:HOME_TUNNEL_PUBLIC_BASE_URL = "https://console.tunnel.example.com"
    $env:HOME_TUNNEL_TUNNEL_DOMAIN = "tunnel.example.com"
    $env:HOME_TUNNEL_FRPS_PUBLIC_HOST = "203.0.113.10"
    $env:HOME_TUNNEL_FRPS_PORT = "17000"
    & docker compose -f (Join-Path $testRoot "compose.yaml") up -d
    if ($LASTEXITCODE -ne 0) { throw "Compose smoke start failed" }

    foreach ($name in @("home-tunnel-postgres", "home-tunnel-control-center", "home-tunnel-frps", "home-tunnel-traffic-gateway")) {
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
    & docker exec home-tunnel-postgres psql -U home_tunnel -d home_tunnel -Atqc "SELECT max(version) FROM schema_migrations"
    if ($LASTEXITCODE -ne 0) { throw "Migration query failed" }
    & docker compose -f (Join-Path $testRoot "compose.yaml") ps
}
finally {
    if ($composePrepared) {
        & docker compose -f (Join-Path $testRoot "compose.yaml") down -v --remove-orphans *> $null
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

Write-Output "Local ARM64 Compose smoke resources removed."
