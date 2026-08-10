# Changelog

All notable changes to Home Tunnel are documented in this file. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
