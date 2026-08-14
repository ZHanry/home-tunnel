<div align="center">
  <img src="control-center/public/HomeTunnel.svg" alt="Home Tunnel" width="92" height="92">
  <h1>Home Tunnel</h1>
  <p><strong>Self-hosted tunnels for home services</strong></p>
  <p><a href="https://zhanry.github.io/home-tunnel/en/">Website</a> · <a href="README.md">中文</a> · <a href="docs/SELF_HOSTING.md">Self-hosting</a> · <a href="SECURITY.md">Security</a></p>
</div>

Home Tunnel is a self-hosted tunneling platform for personal and family services. Publish NAS, Home Assistant, and development services through an auditable, rate-limited control plane that you can revoke at any time.

![The real Home Tunnel management dashboard showing connections, traffic, and component health](docs/site/assets/admin-dashboard.jpg)

> `v3.0.0` is promoted from the same commit and immutable artifact set as `v3.0.0-rc.2`. Linux server `amd64`/`arm64` and the Linux client are Stable. macOS headless is Beta. The Windows x64 EXE is self-signed Experimental software and displays an unknown-publisher warning.

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

The Windows EXE is built with the same RC artifact set later promoted unchanged to Stable and includes SHA-256, an SPDX SBOM, Sigstore bundles, and GitHub provenance. Self-signing proves only artifact-set consistency, not a trusted publisher identity. Trusted distribution still requires a public Authenticode certificate and protected signing environment.

[Download the latest Windows x64 EXE](https://github.com/ZHanry/home-tunnel/releases/latest/download/HomeTunnel-Setup-3.0.0-x64.exe), verify its published SHA-256, and expect an unknown-publisher or SmartScreen prompt.

## Why not raw FRP?

- A capability-restricted Agent accepts only issued HTTP/HTTPS, verified custom-domain, and administrator-authorized TCP configurations. It rejects arbitrary FRP commands, UDP, visitors, and plugins.
- Users, devices, connections, short-lived leases, bandwidth, and runtime state are controlled centrally. Revocation closes active streams.
- Caddy is the only public Web entry point and issues certificates only for authorized names.
- IP allowlists, Basic Auth, hierarchical rate limits, traffic aggregation, and monthly quotas are built in.
- Audit events, component health, verified backups, restore, and rollback tools support operations.
- SQLite and internal services expose no host ports by default; containers use read-only filesystems and minimal capabilities.

## Architecture

```text
Remote browser ─HTTPS→ Caddy ─→ Traffic Gateway ─→ FRPS ═managed tunnel═→ home device
Administrator  ─HTTPS→ Caddy ─→ Control Center ─→ SQLite
Windows/Linux/macOS clients ─REST + WebSocket→ Control Center
```

Control traffic and application traffic are separated. See [Architecture](docs/ARCHITECTURE.md) and the [Security Model](docs/SECURITY_MODEL.md). The project intentionally provides no public dynamic demo. Screenshots are generated from the current UI Preview and production frontend using local fixture domains and data.

## Security evidence

- Complete WebSocket messages are capped at 64 KiB, with explicit fragment and buffered-chunk limits. Tests cover overload, authentication failure, abrupt disconnect, resource reclamation, and reconnect.
- CI audits production dependencies at Moderate severity and runs TypeScript, Go, .NET, Compose, contract, and documentation checks.
- CodeQL explicitly analyzes JavaScript/TypeScript, Go, and C#. Secret Scanning and Push Protection should remain enabled.
- Stable releases must use one commit and one verified artifact set with checksums, SBOMs, provenance, and signature evidence. The Windows EXE must also pass install, version, self-signature consistency, and uninstall checks.

Never put vulnerability details, domains, IP addresses, tokens, passwords, or private log content in a public Issue. Use [GitHub private vulnerability reporting](https://github.com/ZHanry/home-tunnel/security/advisories/new) and read [SECURITY.md](SECURITY.md).

## Development

The repository baseline is Node.js 24 LTS, Go 1.26, and .NET 10. See [CONTRIBUTING.md](CONTRIBUTING.md) for complete commands and [Release process](docs/RELEASING.md) for artifact rules.

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
