# Home Tunnel

Self-hosted tunnels for home services. This repository is the project hub, documentation
site and download directory. Source code is now maintained in three focused repositories:

| Repository | Responsibility |
| --- | --- |
| [home-tunnel-server](https://github.com/ZHanry/home-tunnel-server) | Control API, web console, traffic gateway and Caddy/FRPS deployment |
| [home-tunnel-client](https://github.com/ZHanry/home-tunnel-client) | Shared Windows/macOS/Linux GUI, CLI and managed tunnel Agent |
| [home-tunnel-android](https://github.com/ZHanry/home-tunnel-android) | Android remote-management app |

GUI and CLI share a core. Android manages devices at home and does not host a tunnel.
Existing 5.0.0 releases, issues, Git history and the project website remain available.
See [downloads](docs/DOWNLOADS.md), [repository boundaries](docs/REPOSITORIES.md),
and the [server self-hosting guide](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/SELF_HOSTING.md).
