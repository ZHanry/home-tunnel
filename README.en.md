<div align="center">
  <img src="docs/site/assets/HomeTunnel.svg" alt="Home Tunnel" width="80" height="80">
  <h1>Home Tunnel</h1>
  <p><strong>Self-hosted tunnels for your home services</strong></p>
  <p>
    <img src="https://img.shields.io/badge/status-internal_testing-92400e" alt="Status: internal testing">
    <a href="https://github.com/ZHanry/home-tunnel/actions/workflows/pages.yml"><img src="https://github.com/ZHanry/home-tunnel/actions/workflows/pages.yml/badge.svg" alt="CI"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0 license"></a>
  </p>
  <p><a href="README.md">简体中文</a> · <a href="https://zhanry.github.io/home-tunnel/">Project website</a></p>
</div>

Reach a NAS, photo library, Home Assistant or another home service through your own public server. Home Tunnel adds account, device, connection and policy management around FRP.

> **Status: internal testing.** The project is under active development. There is no production-stable release or long-term compatibility commitment yet. APIs, configuration and installation steps may change.

## Components

| Repository | Responsibility |
| --- | --- |
| [home-tunnel-server](https://github.com/ZHanry/home-tunnel-server) | REST / WebSocket API, web console, HTTP gateway and Caddy / FRPS deployment |
| [home-tunnel-client](https://github.com/ZHanry/home-tunnel-client) | Shared Windows / macOS / Linux GUI, CLI, client core and managed Agent |
| [home-tunnel-android](https://github.com/ZHanry/home-tunnel-android) | Android app for managing devices and connections remotely |
| This repository | Project overview, website, shared documentation and planning |

GUI and CLI share a core. Android manages tunnels running on home computers or NAS hosts; forwarding takes place on those hosts.

## Capabilities

- Publish HTTP / HTTPS services, general TCP streams and fixed-port UDP services.
- Manage accounts, devices, connections and their runtime state centrally.
- Apply access and traffic policy to the HTTP path, with short-lived device authorization.
- Use a desktop window, a headless service or a mobile management interface as appropriate.

HTTP traffic passes through Caddy and the gateway. Raw TCP / UDP uses administrator-assigned ports and requires application-level authentication and encryption. See the [architecture](docs/ARCHITECTURE.md).

## Try a development build

1. Prepare a public Linux server and DNS, then build the [server](https://github.com/ZHanry/home-tunnel-server#readme) from source.
2. Build a complete [client package](https://github.com/ZHanry/home-tunnel-client#readme), sign in and register a home computer.
3. Publish a simple HTTP test service and verify access, pause/resume and reconnect behavior. Use the [Android app](https://github.com/ZHanry/home-tunnel-android#readme) for remote management.

Source builds are the primary testing path. Component READMEs contain their prerequisites and commands. Automated CI does not establish reliability on every device or network.

![Development web console, using test data](docs/site/assets/admin-dashboard.jpg)

## Contribute

See [getting started](docs/GETTING_STARTED.md), [repository ownership](docs/REPOSITORIES.md), [testing](docs/TESTING.md), [roadmap](docs/ROADMAP.md) and [contributing](CONTRIBUTING.md). Component-specific issues belong in their code repositories. Report suspected vulnerabilities [privately](SECURITY.md).

Licensed under [Apache-2.0](LICENSE). FRP licensing is maintained with the client Agent source.
