<img src="docs/site/assets/HomeTunnel.svg" alt="" width="64" height="64">

# Home Tunnel 8.0.0

**Self-hosted access to home services and remote desktops**

[![Version 8.0.0](https://img.shields.io/badge/version-8.0.0-176653)](https://github.com/ZHanry/home-tunnel/releases/tag/v8.0.0) [![License Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

[简体中文](README.md) · [Website](https://zhanry.github.io/home-tunnel/en/) · [Downloads](docs/DOWNLOADS.md) · [Quick start](docs/GETTING_STARTED.md) · [8.0 scope and limits](docs/RELEASE_NOTES.md)

Reach your NAS, Home Assistant, Immich, Jellyfin and other local services through
your own public server. A desktop/NAS Agent runs the tunnels; Web and Android
manage them. Supports HTTP/HTTPS, TCP/UDP and SSH/RDP/RTSP presets.
Version 8.0 adds separately authorized remote desktop sessions from a browser to
a Windows host. Video, input and files use direct UDP P2P; connection fails explicitly when no direct path is available.

| Start here | Link |
| --- | --- |
| Deploy a public Linux server | [Server guide](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/SELF_HOSTING.md) · [Server 8.0.0](https://github.com/ZHanry/home-tunnel-server/releases/tag/v8.0.0) |
| Connect a computer or NAS | [Desktop/CLI 8.0.0](https://github.com/ZHanry/home-tunnel-client/releases/tag/v8.0.0) · [NAS template](https://github.com/ZHanry/home-tunnel-client/tree/main/packaging/nas) |
| Manage several deployments from your phone | [Android 8.0.0 APK](https://github.com/ZHanry/home-tunnel-android/releases/tag/v8.0.0) |
| Configure a home application | [Scenario guide](docs/SCENARIOS.md) |

## What's included in 8.0.0

- **Windows and browsers:** endpoint identities, pairing and local approval; H.264/VP8 video, keyboard/pointer and Unicode text input, and bidirectional streaming file transfers with SHA-256 checks. Actual video, input and files passed same-machine checks of the final Windows package; consult Release evidence for final-package results.
- **Linux x64 X11:** view, keyboard and pointer only. Isolated Xvfb checks passed; physical desktops and lock/unlock remain unverified. Text, clipboard and files are unavailable in this profile. Linux arm64, NAS and CLI packages continue to provide tunnels.
- **Android:** existing multi-server management plus the shared controller, JNI and Surface integration. Physical-device decoding and input remain unverified. Audio, microphone return, clipboard/file delivery, multi-session UI and optional codecs are unavailable.
- **Existing management and operations:** one-time enrollment, TOTP/recovery codes, session revocation, tags/favorites, batch operations, deployment preflight, redacted diagnostics, encrypted off-host backup and monitoring.
- **Shared interfaces and evidence:** REST remains at `/api/v1`; the contract is pinned to `api-v1.2.0`. Component Releases retain actual packages, checksums and verification records.

macOS and Wayland hosting, native desktop viewing windows, system audio, microphone
return, virtual microphones and AV1/HEVC are not delivered. Windows text clipboard
code is implemented, but actual system clipboard interoperability is unverified.
Current H.264/VP8 evidence uses software encoding and does not establish hardware
acceleration. Concurrent media windows, cross-network traversal, complete upgrade/
restore drills and long-running acceptance remain outstanding.

**The 8.0.0 version does not mean the full plan has passed acceptance.** Read the
[release notes](docs/RELEASE_NOTES.md), [scope](docs/8.0/SCOPE.md) and
[acceptance record](docs/8.0/ACCEPTANCE.md) before choosing a remote-desktop platform.

All four repositories and the managed Agent use **8.0.0**. Upstream FRP stays at
**0.70.1**. Windows/macOS 8.0.0 packages have no Authenticode / Developer ID
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

Remote desktop requires separate pairing, code confirmation and approval on the
host. The server handles identity, authorization and signaling; session video,
input and files travel directly between peers over UDP with no TURN or tunnel
fallback. See the [quick start](docs/GETTING_STARTED.md).

The image below is the original 7.0.0 console with sample data, retained as a
historical screenshot. It is not an 8.0 remote-desktop demonstration.

![Home Tunnel 7.0.0 console, historical screenshot with sample data](docs/site/assets/admin-dashboard-7.jpg)

[Downloads/compatibility](docs/DOWNLOADS.md) · [API](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/API.md) · [Recovery](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/disaster-recovery.md) · [Monitoring](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/MONITORING.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

Historical 7.0.0 packages remain available: [Server](https://github.com/ZHanry/home-tunnel-server/releases/tag/v7.0.0), [Client](https://github.com/ZHanry/home-tunnel-client/releases/tag/v7.0.0), [Android](https://github.com/ZHanry/home-tunnel-android/releases/tag/v7.0.0). Back up before upgrading. An 8.0 client connected to an older server cannot use the new remote-desktop service.

Help with a reproducible issue, a real deployment story, documentation or code.
Never publish credentials or private network details in an issue.
