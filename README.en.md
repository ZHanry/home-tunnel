# 栖云桥 / NestLink

Warm Hearth interfaces, authenticated encrypted direct P2P remote control, and complete independent tunneling.

[中文](README.md) · [Downloads](docs/DOWNLOADS.md) · [Architecture](docs/ARCHITECTURE.md) · [Upgrade](docs/UPGRADING.md)

The current development line is a candidate: Server 12.0.0-RC1 and Client / Android / distribution 12.0.0-RC1. It imports the Hearth Web and native Rust/Flutter client branches. Windows ships the native NestLink installer; Android pins the same Client source. Cross-network NAT, sustained media, physical Android devices and installed two-peer remote acceptance are pending. The stable channel retains the original Server / Client 10.1.0 and Android 10.0.0 bytes and historical evidence.

Remote control requires authenticated, encrypted direct P2P. hbbs provides only ID/NAT signaling; there is no hbbr, TURN, FRP, HTTP/WSS, VPN or vendor fallback. A failed secure direct connection terminates. The Web console launches the installed client using an ID-only `homedesk://` URL. Device-directory ownership does not bypass remote passwords or approval.

HTTP/HTTPS and governed TCP/UDP tunnels, port pools, authorization, ACLs, traffic governance, diagnostics and independent CLI/NAS/background Agents remain available. Node/SQLite, Caddy, traffic-gateway and FRPS retain their roles. The only new resident server process is hbbs, capped at 64 MB; a one-time volume initializer uses the existing pinned FRPS image. Failed remote sessions do not stop tunnels.

Release attachment limits are Server 3, Client 4, Android 3 and distribution 2. Sources, exact submodules, dependency notices, build evidence and Sigstore workflow signatures are bundled in materials ZIPs. Windows remains unsigned by Authenticode. Android retains its original application ID and certificate. Native macOS/Linux GUIs are not released; the CLI/Agent bundle covers Windows x64, Linux amd64/arm64 and macOS amd64/arm64. Original Agent 10.1.0 and FRP 0.70.1 bytes remain pinned.

Back up SQLite, deployment secrets, client state and the separate hbbs identity before upgrading. Configure your own HTTPS console, hbbs address and its public key; generic builds contain no server, key or account. Retire legacy remote media overlays while preserving independent tunnels. `distribution.json` is the sole channel source; published candidate hashes are recorded only after downloading and verifying real component releases. Legacy evidence is never relabeled as 12.x acceptance.

Imported RustDesk code follows [AGPL-3.0](https://github.com/ZHanry/home-tunnel-client/blob/main/LICENSE-RUSTDESK); corresponding source is included. This documentation/distribution repository retains [Apache-2.0](LICENSE).
