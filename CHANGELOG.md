# Changelog

All notable changes to Home Tunnel are documented in this file. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

The source tree is versioned `2.5.0` for the `v2.5.0-rc.1` validation cycle. The
independent `v2.4.1` security maintenance patch must be reviewed and published
first; none of the entries below are part of that patch release.

### Added

- Added bilingual README and static GitHub Pages, real desktop/mobile build screenshots, an architecture graphic, social preview metadata, privacy notice, and optional cookie-free GoatCounter event measurement.
- Added native browser ES modules, standard xUnit discovery, cross-component REST/WebSocket/configuration contract fixtures, and additive database upgrade/backup/rollback coverage.
- Added release-candidate and stable artifact workflows for Linux/macOS packages and multi-architecture images with checksums, SPDX SBOMs, GitHub attestations, and keyless Sigstore bundles.

### Changed

- Raised the Linux client and release toolchain to Go 1.26.6 for the latest
  standard-library security fixes, and initialized CodeQL after installing the
  pinned Go toolchain so manual Go builds are traced correctly.
- Split the control-center administration routes by users, devices, connections, health, and audit, and split the traffic gateway into policy, access-control, rate-limit, sampling, proxy, and lifecycle modules without changing the v1 protocol surface.
- Moved Windows update, session, realtime, and Agent coordination out of the main window into focused services while retaining Windows as source-only/Experimental.
- Raised the development baselines to Node.js 24 LTS, Go 1.26, and .NET 10 LTS; added ESLint, Prettier, Markdown/link, gofmt/vet/staticcheck, analyzer, audit, coverage, and Lighthouse gates.

## [2.4.1] - 2026-08-13

### Security

- Updated `ws` from 8.18.3 to 8.21.3 to address GHSA-96hv-2xvq-fx4p and GHSA-58qx-3vcg-4xpx.
- Bounded complete WebSocket messages, fragments and buffered chunks, with authenticated fragmentation, overload disconnect and recovery regression tests.

### Changed

- Corrected the supported-version policy and removed unsupported Windows binary download calls to action. Windows x64 remains source-only/Experimental until trusted signing and VM verification are available.
- Pinned GitHub Actions to immutable commits, added a stable CI quality gate, CodeQL, production dependency auditing and Go Dependabot coverage.
- Added a privacy-safe deployment feedback Issue Form; repository labels must be configured by an owner before adding automatic labels.

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
