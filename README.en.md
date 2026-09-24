<img src="docs/site/assets/HomeTunnel.svg" alt="" width="64" height="64">

# Home Tunnel 9.0.0

**Self-hosted access to home services and remote desktops**

[![Version 9.0.0](https://img.shields.io/badge/version-9.0.0-595AD7)](https://github.com/ZHanry/home-tunnel/releases/tag/v9.0.0) [![License Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

[简体中文](README.md) · [Website](https://zhanry.github.io/home-tunnel/en/) · [Downloads](docs/DOWNLOADS.md) · [Quick start](docs/GETTING_STARTED.md) · [9.0 scope and limits](docs/RELEASE_NOTES.md)

Reach your NAS, Home Assistant, Immich, Jellyfin and other local services through
your own public server. A desktop/NAS Agent runs the tunnels; Web and Android
manage them. Supports HTTP/HTTPS, TCP/UDP and SSH/RDP/RTSP presets.
Version 9.0 separates remote desktop from tunnels and adds three connection modes:
host-approved request, fixed password and single-use temporary password. Remote
payloads use direct UDP P2P and fail explicitly without a direct path.

| Start here | Link |
| --- | --- |
| Deploy a public Linux server | [Server guide](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/SELF_HOSTING.md) · [Server 9.0.0](https://github.com/ZHanry/home-tunnel-server/releases/tag/v9.0.0) |
| Connect a computer or NAS | [Desktop/CLI 9.0.0](https://github.com/ZHanry/home-tunnel-client/releases/tag/v9.0.0) · [NAS template](https://github.com/ZHanry/home-tunnel-client/tree/main/packaging/nas) |
| Manage several deployments from your phone | [Android 9.0.0 APK](https://github.com/ZHanry/home-tunnel-android/releases/tag/v9.0.0) |
| Configure a home application | [Scenario guide](docs/SCENARIOS.md) |

## What's included in 9.0.0

- **Windows and browsers:** separate remote window; host-approved requests, fixed passwords and single-use temporary passwords; signed authorization, leases and immediate revocation. Consult the component Release for exact final-package video, input and file evidence.
- **Linux x64 X11:** view, keyboard and pointer only. Isolated Xvfb checks passed; physical desktops and lock/unlock remain unverified. Text, clipboard and files are unavailable in this profile. Linux arm64, NAS and CLI packages continue to provide tunnels.
- **Android:** existing multi-server management, three connection modes and a separate remote viewer. API 35 x86_64 emulator checks do not validate the arm64 APK or a physical phone. Clipboard interoperability remains unverified; audio and files are unavailable.
- **Existing management and operations:** one-time enrollment, TOTP/recovery codes, session revocation, tags/favorites, batch operations, deployment preflight, redacted diagnostics, encrypted off-host backup and monitoring.
- **Shared interfaces and evidence:** REST remains at `/api/v1`; the contract is pinned to `api-v1.3.0`. Component Releases retain actual packages, checksums and verification records.

Windows pre-login, locked-screen and UAC secure-desktop control are incomplete.
Audio, macOS/Wayland hosting and AV1/HEVC are not delivered. Clipboard
interoperability, arm64 APK runtime, cross-network traversal, full upgrade/restore
drills and long-running acceptance remain outstanding.

**A stable version number does not mean every remote-control feature has passed acceptance.**
Read the [release notes](docs/RELEASE_NOTES.md) and component Release evidence.
The [8.0 acceptance record](docs/8.0/ACCEPTANCE.md) is historical, not 9.0 artifact verification.

All four repositories and the managed Agent use **9.0.0**. Upstream FRP stays at
**0.70.1**. Windows/macOS packages have no Authenticode / Developer ID
release signature; SHA-256 and Sigstore build evidence are provided. Android
preserves its application ID and established release certificate.
[Verification details](https://github.com/ZHanry/home-tunnel-client/blob/main/docs/PLATFORM_SECURITY.md).

## Connect in three steps

1. Deploy the server on a public Linux host with your domain and Docker Compose.
2. Install the client on a home host and enroll with an account or one-time code.
3. Add a reachable local service and verify its public address from another network.

Android does not run the home tunnels; keep the home Agent running. Administrators
enable TCP/UDP pools and permissions; the server assigns public ports. Raw
transports rely on the target application's authentication and encryption.

Remote desktop requires both parties to sign in to the same server. The host can
approve a request, enable a fixed password in advance, or generate a one-use
temporary password. The server handles identity, authorization and signaling; session video,
input and files travel directly between peers over UDP with no TURN or tunnel
fallback. See the [quick start](docs/GETTING_STARTED.md).

The image below is the original 7.0.0 console with sample data, retained as a
historical screenshot. It is not a 9.0 remote-desktop demonstration.

![Home Tunnel 7.0.0 console, historical screenshot with sample data](docs/site/assets/admin-dashboard-7.jpg)

[Downloads/compatibility](docs/DOWNLOADS.md) · [API](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/API.md) · [Recovery](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/disaster-recovery.md) · [Monitoring](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/MONITORING.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

Historical 7.0.0 and 8.0.0 packages remain available. Back up before upgrading; older servers do not provide the 9.0 remote-access modes.

Help with a reproducible issue, a real deployment story, documentation or code.
Never publish credentials or private network details in an issue.
