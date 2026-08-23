<div align="center">
  <img src="control-center/public/HomeTunnel.svg" alt="Home Tunnel" width="92" height="92">
  <h1>Home Tunnel</h1>
  <p><strong>Self-hosted tunnels for home services</strong></p>
  <p><a href="https://zhanry.github.io/home-tunnel/en/">Website</a> · <a href="README.md">中文</a> · <a href="docs/SELF_HOSTING.md">Self-hosting</a> · <a href="SECURITY.md">Security</a></p>
</div>

Home Tunnel is a self-hosted tunneling platform for personal and family services. Publish Web services, general TCP byte streams, and fixed-port UDP services through an auditable control plane that you can revoke at any time.

![The real Home Tunnel management dashboard showing connections, traffic, and component health](docs/site/assets/admin-dashboard.jpg)

> `v3.2.0` is promoted from the same commit and immutable artifact set as `v3.2.0-rc.1`. The Linux server/client are Stable, macOS headless is Beta, and the Windows x64 plus Android 8.0+ `arm64-v8a` clients are Experimental.

## Quick Start

You need a public Linux server, a domain, and console plus wildcard DNS records pointing at that server.

```sh
git clone https://github.com/ZHanry/home-tunnel.git
cd home-tunnel
sh ./deploy/scripts/new-selfhost-config.sh \
  tunnel.example.com \
  203.0.113.10 \
  console.tunnel.example.com \
  admin@example.com
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
```

Read the one-time password from `deploy/secrets/bootstrap_admin_password`, open `https://console.tunnel.example.com/admin`, and change it immediately. See the [complete self-hosting guide](docs/SELF_HOSTING.md) for DNS, firewall, backup, rollback, and client instructions. Never use example domains, addresses, or `CHANGE_ME` values in a public deployment.

## Support matrix

| Component | Platform | Status | Distribution and limits |
| --- | --- | --- | --- |
| Server | Linux `amd64` / `arm64` | Stable | Containers and source builds; stable releases require both architectures |
| Headless client | Linux `amd64` / `arm64` | Stable | systemd, realtime configuration, and safety polling |
| Headless client | macOS `amd64` / `arm64` | Beta | launchd package; broader real-hardware coverage is pending |
| Desktop client | Windows 10/11 x64 | Experimental | Release provides a self-signed EXE and update manifest; Windows warns about the unknown publisher |
| Mobile client | Android 8.0+ `arm64-v8a` | Experimental | Sideloadable GitHub APK; the AAB is not directly installable or a Play-readiness claim |

Windows and Android packages are built in the same RC asset set later promoted unchanged to Stable, with SHA-256, SPDX SBOMs, Sigstore bundles, and GitHub provenance. Windows self-signing proves artifact consistency rather than publisher trust. Android updates require the fixed application ID and persistent release certificate to remain unchanged.

[Download the latest Windows x64 EXE](https://github.com/ZHanry/home-tunnel/releases/latest/download/HomeTunnel-Setup-3.2.0-x64.exe), verify its published SHA-256, and expect an unknown-publisher or SmartScreen prompt.

Android 8.0+ `arm64-v8a` users can sideload
`HomeTunnel-Android-3.2.0-arm64-v8a.apk` from the latest GitHub Release after
verifying `SHA256SUMS.txt`, the APK signing-certificate SHA-256, and Sigstore
evidence. Its application ID is `io.github.zhanry.hometunnel`. The attached AAB
cannot be installed directly and does not claim Google Play readiness. Foreground
service notifications, battery optimization, and OEM background restrictions can
affect long-running tunnels; this first Android release remains Experimental,
advertises HTTP support only, and does not start assigned TCP/UDP records.
See the [Android client guide](android-client/README.md) for build, permission,
foreground-service, and diagnostics details.

## Why not raw FRP?

- A capability-restricted Agent accepts only issued HTTP/HTTPS and verified custom-domain configurations plus TCP/UDP ports explicitly assigned by an administrator. It rejects arbitrary FRP commands and configurations that were not issued by the control center.
- Users, devices, connections, short-lived leases, and runtime state are controlled centrally. Web policy converges directly; FRPS `Ping` makes revoked TCP/UDP sessions fail closed within the roughly 90-second heartbeat window.
- Caddy is the only public Web entry point and issues certificates only for authorized names.
- The HTTP/HTTPS path provides IP allowlists, Basic Auth, hierarchical rate limits, traffic aggregation, and monthly quotas.
- Audit events, component health, verified backups, restore, and rollback tools support operations.
- SQLite and internal services expose no host ports by default; containers use read-only filesystems and minimal capabilities.

## Architecture

```text
Remote browser ─HTTPS→ Caddy ─→ Traffic Gateway ─→ FRPS ═managed tunnel═→ home device
Remote TCP/UDP client ─assigned public port→ FRPS ═managed tunnel═→ fixed home TCP/UDP port
Administrator  ─HTTPS→ Caddy ─→ Control Center ─→ SQLite
Windows/Linux/macOS/Android clients ─REST + WebSocket→ Control Center
```

Control traffic and application traffic are separated. See [Architecture](docs/ARCHITECTURE.md) and the [Security Model](docs/SECURITY_MODEL.md). The project intentionally provides no public dynamic demo. Screenshots are generated from the current UI Preview and production frontend using local fixture domains and data.

## General TCP, fixed-port UDP, and RTSP

Home Tunnel manages transport types, not an application-protocol catalog:

| Type | Typical use | Public path |
| --- | --- | --- |
| HTTP/HTTPS | Web applications and HTTPS local targets | Caddy → Traffic Gateway → FRPS |
| TCP | RTSP-over-TCP, SSH, RDP, MQTT, databases, and other TCP byte streams | Fixed public port → FRPS |
| UDP | Fixed UDP ports used by DNS, games, or media | Fixed public port → FRPS |

RTSP is not a separate tunnel type. If a camera serves RTSP on local `554/tcp`, an administrator can create a general TCP mapping from public `10554` to the camera's local port `554`, then force TCP in the player:

```sh
ffplay -rtsp_transport tcp rtsp://PUBLIC_HOST:10554/path
```

Native RTP/RTCP over UDP requires the camera to use fixed media ports and one UDP mapping for every port. Dynamically negotiated or randomly selected media ports are not guaranteed to work. Home Tunnel does not support raw IP, ICMP, broadcast, multicast, STCP, XTCP, SUDP, visitors, or arbitrary FRP plugins.

TCP and UDP are disabled by default. Only an administrator can assign an exact public port inside an enabled range, and the exposed application must provide its own authentication and encryption. These raw transports bypass Caddy and the Traffic Gateway, so gateway Basic Auth, IP allowlists, rate limits, traffic metering, and monthly quotas do not apply. For UDP, also restrict sources and rates in the host or cloud firewall and assess reflection/amplification risk. See the [self-hosting guide](docs/SELF_HOSTING.md) to enable them.

## Security evidence

- Complete WebSocket messages are capped at 64 KiB, with explicit fragment and buffered-chunk limits. Tests cover overload, authentication failure, abrupt disconnect, resource reclamation, and reconnect.
- CI audits production dependencies at Moderate severity and runs TypeScript, Go, .NET, Compose, contract, and documentation checks.
- CodeQL explicitly analyzes JavaScript/TypeScript, Go, C#, and Android Java/Kotlin. Secret Scanning and Push Protection should remain enabled.
- Stable releases must use one commit and one verified artifact set with checksums, SBOMs, provenance, and signature evidence. Windows additionally passes installer checks; Android APK/AAB assets must pass package, version, ABI, and persistent-certificate verification.

Never put vulnerability details, domains, IP addresses, tokens, passwords, or private log content in a public Issue. Use [GitHub private vulnerability reporting](https://github.com/ZHanry/home-tunnel/security/advisories/new) and read [SECURITY.md](SECURITY.md).

## Development

The repository baseline is Node.js 24 LTS, Go 1.26, .NET 10, and JDK 17 with the Android SDK. See [CONTRIBUTING.md](CONTRIBUTING.md) for complete commands and [Release process](docs/RELEASING.md) for artifact rules.

```powershell
Set-Location control-center
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm test

Set-Location ..\traffic-gateway
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm test

Set-Location ..
dotnet test .\windows-client-tests\HomeTunnel.Client.Tests.csproj -c Release
```

```sh
cd linux-client
go test -race ./...
go vet ./...
go build ./cmd/home-tunnel-client
```

Focused pull requests with tests and an explicit security rationale are easiest to review. Report a real deployment outcome through the [deployment feedback form](https://github.com/ZHanry/home-tunnel/issues/new?template=deployment_feedback.yml); you never need to disclose a domain, IP address, or credential.

## License

Home Tunnel is licensed under [Apache License 2.0](LICENSE). The embedded Agent is based on FRP; its license and notices are in `windows-agent/FRP-LICENSE.txt` and `windows-agent/THIRD-PARTY-NOTICES.txt`.
