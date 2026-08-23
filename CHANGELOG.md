# Changelog

All notable changes to Home Tunnel are documented in this file. The project follows [Semantic Versioning](https://semver.org/).

## [3.2.0] - 2026-08-23

### Added

- Added an Experimental native Android 8.0+ client for `arm64-v8a`, distributed
  as a GitHub-sideloadable APK plus a non-installable AAB audit/upload artifact.
- Added Android Agent, Gradle test/lint/build, Java/Kotlin CodeQL, package
  identity, version, ABI, signature, and binary-repository gates to CI.

### Security

- Android release candidates now fail closed unless the protected persistent
  keystore secrets are present and its signer matches the reviewed certificate
  SHA-256. Debug or ephemeral signing keys are never accepted for releases.
- Added per-package SHA-256, SPDX SBOMs, keyless Sigstore bundles, GitHub
  attestations, and signed machine-readable Android release evidence. Stable
  releases verify and promote the exact RC APK/AAB without rebuilding or
  re-signing them.

### Known limitations

- Android remains Experimental while Android 8–16 real-device coverage and OEM
  foreground-service, notification, battery-optimization, and reconnect
  behavior are expanded. The published AAB is not a claim of Google Play
  readiness and cannot be installed directly.

## [3.1.0] - 2026-08-21

### Added

- Extended the existing administrator-managed TCP forwarding with fixed-port
  UDP, and documented that TCP already carries RTSP-over-TCP, SSH, RDP, MQTT,
  databases, and other TCP byte streams.
- Added protocol-neutral `remote_port` and `supported_proxy_types` contracts,
  while retaining the legacy TCP fields needed for rolling compatibility.
- Added opt-in `deploy/compose.tcp.yaml`, `deploy/compose.udp.yaml`, and
  `deploy/compose.l4.yaml` profiles with independent TCP, UDP, and shared L4
  bind/range settings.
- Added unit and integration coverage for exact TCP/UDP authorization and
  legacy-client fallback, plus a reproducible release smoke that drives the
  managed Agent through a 128 KiB+ binary TCP echo, a 1 KiB+ UDP datagram echo,
  RTSP-over-TCP `OPTIONS`/`SETUP`/`PLAY` with an interleaved media frame, and
  TCP/UDP revocation checks. The local Compose smoke also checks migration
  `008`, the FRPS allow-port range, and both protocol bindings.

### Security

- Published the independently reviewed FRPS `0.70.1-r2` wrapper from the same
  upstream `fa3bcca` source, with the L4/Ping entrypoint baked into a signed,
  attested `amd64`/`arm64` image pinned at
  `sha256:0ca230caa4c3c71932efd9bd5b9024a6fdc289886b97a1db827eaf3f8b6de759`.
- Kept TCP and UDP disabled by default and administrator-only. The managed
  Agent accepts only the exact protocol and remote port issued by the control
  center, with separate TCP and UDP allowlists, and continues to reject raw IP,
  ICMP, broadcast, multicast, STCP, XTCP, SUDP, visitors, and arbitrary
  plugins.
- Documented that raw TCP/UDP bypass Caddy and the Traffic Gateway, so gateway
  Basic Auth, IP allowlists, rate limits, traffic metering, and monthly quotas
  do not apply. Exposed applications must provide their own authentication and
  encryption.
- Added explicit UDP guidance to restrict sources and rates at the host or
  cloud firewall and to assess reflection/amplification risk before enabling a
  public port.
- Enabled FRPS `Ping` authorization so lease expiry and user/device/token/
  configuration revocation stop raw forwarding within the roughly 90-second
  heartbeat window; a prolonged control-plane outage intentionally fails raw
  tunnels closed.

### Upgrade notes

- Upgrade the control center/FRPS deployment and every managed client before
  enabling UDP. A client that omits `supported_proxy_types` still receives a
  UDP connection record for compatibility, but the server forces it to
  `disabled`, so the old client must not start it. Updated clients force one
  full sync on their first post-upgrade start before recording the new sync
  capability, which replaces any cached compatibility-disabled UDP state.
- Existing deployments that only set `TCP_TUNNEL_ENABLED` remain TCP-only;
  upgrading does not implicitly expose UDP. Review and explicitly select the
  TCP, UDP, or combined L4 Compose profile and its matching environment-variable
  range before opening firewall ports.
- Back up SQLite before the additive migration to schema `008`. Preserve the
  legacy TCP fields during mixed-version operation, then use the canonical
  `remote_port` field after all components have been upgraded.

## [3.0.0] - 2026-08-14

Home Tunnel 3.0.0 is the first release promoted from one fully verified RC
commit and one immutable cross-platform artifact set. Security maintenance
previously planned for an unpublished 2.4.1 patch is included here.

### Security

- Promoted the restricted Agent and FRPS dependency from FRP 0.62.1 to 0.70.1,
  eliminating the reachable vulnerabilities found in the previous pin. The
  FRPS `0.70.1-r1` image is built with Go 1.26.6 for `amd64`/`arm64`, audited,
  SBOM/provenance-attested and keyless-signed before its exact digest is pinned.
- Adapted the Agent to FRP's managed configuration-source and unsafe-feature
  policy APIs while preserving the HTTP/TCP allowlists and wire-level user
  prefix behaviour.
- Updated `ws` from 8.18.3 to 8.21.3 and bounded complete WebSocket messages,
  fragments, and buffered chunks with authenticated fragmentation, overload
  disconnect, and recovery regression coverage.

### Added

- Added bilingual README and static GitHub Pages, real desktop/mobile build screenshots, an architecture graphic, social preview metadata, privacy notice, and optional cookie-free GoatCounter event measurement.
- Added native browser ES modules, standard xUnit discovery, cross-component REST/WebSocket/configuration contract fixtures, and additive database upgrade/backup/rollback coverage.
- Added release-candidate and stable artifact workflows for Linux/macOS packages and multi-architecture images with checksums, SPDX SBOMs, GitHub attestations, and keyless Sigstore bundles.
- Added a Windows 10/11 x64 Experimental EXE to the immutable RC/Stable asset
  set. It is self-signed, visibly marked as an unknown-publisher build, tested
  for silent install/uninstall, and shipped with checksums, an SPDX SBOM,
  Sigstore bundles, and GitHub provenance.

### Changed

- Raised the Linux client and release toolchain to Go 1.26.6 for the latest
  standard-library security fixes, and initialized CodeQL after installing the
  pinned Go toolchain so manual Go builds are traced correctly.
- Added coarse IP rate limits around login and custom-domain DNS verification,
  in addition to the existing subject-aware login limiter.
- Split the control-center administration routes by users, devices, connections, health, and audit, and split the traffic gateway into policy, access-control, rate-limit, sampling, proxy, and lifecycle modules without changing the v1 protocol surface.
- Moved Windows update, session, realtime, and Agent coordination out of the main window into focused services while retaining Windows as source-only/Experimental.
- Raised the development baselines to Node.js 24 LTS, Go 1.26, and .NET 10 LTS; added ESLint, Prettier, Markdown/link, gofmt/vet/staticcheck, analyzer, audit, coverage, and Lighthouse gates.
- Corrected the supported-version policy and removed obsolete release-planning
  material from the source tree.

### Fixed

- Generate the aggregate RC checksum manifest with download-relative paths and
  verify it before signing or publishing, so direct downloads and later Stable
  promotion can both run `shasum -c SHA256SUMS.txt` successfully.
- Pinned GitHub Actions to immutable commits, added a stable CI quality gate,
  CodeQL, production dependency auditing, and a privacy-safe deployment
  feedback Issue Form.

## [2.4.0] - 2026-08-13

### Security

- Added FRPS TLS server identity verification: deployment scripts generate a persistent certificate, the control center distributes it over HTTPS discovery, clients pin it and the managed Agent enforces the pinned CA and server name before connecting.
- Rewrote the managed Agent validation as an allowlist: the parsed FRP configuration must match a template completed with FRP defaults field by field, so unknown or future FRP options are rejected by default (previously a blocklist).
- Verified the optional Authenticode signer thumbprint of the Windows Agent binary instead of only displaying it.
- Hardened secrets handling, container isolation (read-only Caddy), systemd sandboxing and the console Caddy site no longer depends on control-center availability for certificate issuance.

### Fixed

- Traffic gateway no longer crashes when a client resets the connection mid-upload; upstream requests now use keep-alive pooling with response-header timeouts.
- Control center no longer stalls all requests during data maintenance or device deletion; both now run in small batched transactions.
- Fixed WebSocket upgrade socket leaks, unbounded rate-limiter and traffic-sample buffers, timestamp comparison mismatches, and incomplete graceful shutdown.
- Fixed Windows client Agent supervision races that could spawn duplicate or orphaned Agent processes, restart tunnels after an explicit pause, or leave stale connection status.
- Fixed the `deploy/compose.yaml` secrets and FRPS environment variable drift that broke documented self-host deployments.
- Linux client persists state durably (directory fsync), retries transient startup failures with backoff, and reports Agent restart cool-downs.

### Added

- Verified custom domains with DNS TXT ownership proof and CNAME target checks, Caddy on-demand TLS authorization, exact gateway routing, and Windows/Linux Agent allowlists.
- Administrator-only TCP tunnels with a globally disabled default, a fixed FRPS allow-port range, per-connection port assignment, FRPS plugin enforcement, and Windows/Linux Agent allowlists.
- Persistent Simplified Chinese/English switching across the public page, sign-in flow, and administration console.
- Optional per-user monthly traffic quotas with automatic gateway-layer suspension and next-month restoration, plus outbound webhook and Telegram alerts for quota thresholds and device offline/recovery. Alerts are timed out, retried once, de-duplicated, and never block control-center operations.
- Optional per-connection gateway access control: an IP allowlist and HTTP Basic Auth gate enforced at the traffic gateway before proxying, configurable from the admin console. ACL-only edits take effect without restarting the tunnel.
- macOS support for the headless client (darwin `amd64`/`arm64`) with OS-aware paths, launchd packaging and a cross-compiling release script; the Linux systemd path is unchanged.
- WebSocket realtime sync for the Linux client (standard-library RFC 6455 client) with polling retained as fallback.
- Automatic daily SQLite snapshots with retention, plus Prometheus metrics endpoints on the control center (`/internal/metrics`) and traffic gateway (`/metrics`).
- Real per-connection tunnel status in the Windows client parsed from Agent logs, update download idle timeouts, and UI virtualization for large connection lists.
- End-to-end proxy tests for the traffic gateway and a CI job that builds the official Windows Agent baseline artifact.

### Changed

- Removed the runtime PostgreSQL-to-SQLite SQL translation layer; all queries are now native SQLite with cached prepared statements.

## [2.3.0] - 2026-08-12

- Added a headless `amd64`/`arm64` Linux client with secure enrollment, systemd hardening, lease renewal, heartbeats, restricted Agent supervision and pinned release packaging.
- Added `linux` control-center sessions while retaining the existing non-browser token and CSRF boundaries.
- Replaced the server-side PostgreSQL container with a WAL-backed SQLite database and online encrypted SQLite backups.
- Added authenticated push notifications for gateway policy changes, with a five-minute recovery sync instead of one-second polling.
- Serialized Argon2 password work with a bounded queue to prevent low-memory hosts from running concurrent 64 MiB hashes.
- Made prebuilt `amd64`/`arm64` images the default deployment path and moved runtime images to Alpine.
- Combined shared Node image layers into one offline archive and removed Windows installers from all server release packages.
- Redesigned the Web administration console and Windows client with unified light/dark themes, compact connection editors and scrollbar-free authentication layouts.

## [2.2.5] - 2026-08-10

- Increased the Windows login window height and removed the visible login-page scrollbar.
- Replaced device revocation in the administration UI with permanent device deletion, including associated sessions, connections, runtime state and traffic detail.
- Rejected missing or documentation-only public FRPS endpoints in production so new clients cannot receive an unusable placeholder address.

## [2.2.4] - 2026-08-10

- Prepared the source tree for public GitHub development.
- Added self-hosting configuration, security guidance and automated checks.
- Added user-selected server discovery so public clients no longer embed an operator domain or IP address.
- Moved Windows release checks and installer downloads to the official GitHub Releases page, independent of the selected self-hosted server.
- Added WebSocket configuration notifications with periodic fallback synchronization.
- Added incremental gateway policy updates, batched traffic writes, bad-sample isolation, hourly aggregation and retention cleanup.
- Added safe caching for static assets and release metadata.

## [2.2.3] - 2026-08-10

- Added explicit 30-second Agent heartbeat and 90-second timeout settings to prevent periodic FRPS reconnects.

## [2.2.2] - 2026-08-10

- Replaced the generic `frpc.exe` with a capability-restricted Home Tunnel Agent built from pinned FRP 0.62.1 source.
- Added Agent integrity checking and a repair workflow.

## [2.2.1] - 2026-08-09

- Refined the Windows client and administration interface.

## [2.2.0] - 2026-08-09

- Added the current Windows desktop experience and managed update flow.
