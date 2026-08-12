# Changelog

All notable changes to Home Tunnel are documented in this file. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
