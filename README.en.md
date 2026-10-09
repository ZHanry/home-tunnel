# 栖云桥 / NestLink

The blue-and-white NestLink workspace, authenticated encrypted direct P2P remote control, and complete independent tunneling.

[中文](README.md) · [Downloads](docs/DOWNLOADS.md) · [Architecture](docs/ARCHITECTURE.md) · [Upgrade](docs/UPGRADING.md)

The current development line is **12.0.0-RC1** across Server, Client, Android and distribution. It retains the Rust/Flutter remote core and Go/FRP tunnel stack. Windows, macOS and Linux use the same NestLink workspace; Android pins the shared Client source and adapts navigation and screen-sharing permissions for mobile. The Chinese name is 栖云桥. Visible scrollbars are hidden while wheel, touch and keyboard scrolling remain available. Cross-network NAT, sustained media, physical Android devices and installed two-peer remote acceptance are pending. The stable channel retains the original Server / Client 10.1.0 and Android 10.0.0 bytes and historical evidence.

Remote control requires authenticated, encrypted direct P2P. hbbs provides only ID/NAT signaling; there is no hbbr, TURN, FRP, HTTP/WSS, VPN or vendor fallback. A failed secure direct connection terminates. The Web console launches the installed client using an ID-only `homedesk://` URL. Device-directory ownership does not bypass remote passwords or approval.

HTTP/HTTPS and governed TCP/UDP tunnels, port pools, authorization, ACLs, traffic governance, diagnostics and independent CLI/NAS/background Agents remain available. Node/SQLite, Caddy, traffic-gateway and FRPS retain their roles. The only new resident server process is hbbs, capped at 64 MB; a one-time volume initializer uses the existing pinned FRPS image. Failed remote sessions do not stop tunnels.

Release attachment limits are Server 3, Client 8, Android 3 and distribution 2. Client delivers a Windows x64 installer, macOS Intel and Apple Silicon DMGs, Linux x64 and ARM64 DEBs, and the five-platform CLI/Agent bundle. Android delivers one universal arm64/x86_64 APK. Sources, exact submodules, dependency notices, build evidence and Sigstore workflow signatures are bundled in materials ZIPs. Windows remains unsigned by Authenticode; macOS uses ad-hoc signing without Developer ID or notarization. Android retains its original application ID and certificate. Agents are built from the selected RC1 source; FRP remains pinned to 0.70.1.

Back up SQLite, deployment secrets, client state and the separate hbbs identity before upgrading. Sign in to your own HTTPS service; clients obtain the signaling configuration automatically. Generic builds contain no server, key or account. Every remote entry requires an active account and a short-lived server permit, followed by host approval or a remote password. Device-ID assistance can cross accounts on the same service, while each account keeps its own directory. The transactional upgrade removes MFA, recovery secrets and device access codes, invalidates old management sessions and preserves valid background device credentials and tunnel configuration. New authentication and remote permits use the frozen `api-v2.0.0` contract. Independent CLI/NAS tunnels use their own revocable credentials and leases.

`distribution.json` is the sole channel source; published candidate hashes are recorded only after downloading and verifying real component releases. Legacy evidence is never relabeled as 12.x acceptance. This release covers GitHub prereleases, images and the distribution site; production deployment upgrades are a separate operation.

Imported RustDesk code follows [AGPL-3.0](https://github.com/ZHanry/home-tunnel-client/blob/main/LICENSE-RUSTDESK); corresponding source is included. This documentation/distribution repository retains [Apache-2.0](LICENSE).
