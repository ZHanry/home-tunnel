<div align="center">
  <img src="docs/site/assets/HomeTunnel.svg" alt="Home Tunnel" width="72" height="72">
  <h1>Home Tunnel</h1>
  <p><strong>Self-hosted access to services at home</strong></p>
  <p><a href="https://github.com/ZHanry/home-tunnel/releases/latest"><img src="https://img.shields.io/badge/release-6.0.0-176653" alt="Release 6.0.0"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0"></a></p>
  <p><a href="README.md">简体中文</a> · <a href="https://zhanry.github.io/home-tunnel/">Website</a></p>
</div>

Home Tunnel 6.0 is the official release of a self-hosted platform for reaching your NAS, photos, Home Assistant and other home services through your own public server. Each app has been rebuilt around its role.

## Choose your component

| Component | Purpose | Download and source |
| --- | --- | --- |
| Server | Deploy the console and tunnel services on public Linux infrastructure | [Release](https://github.com/ZHanry/home-tunnel-server/releases/latest) · [Repository](https://github.com/ZHanry/home-tunnel-server) |
| Desktop / CLI | Run tunnels on Windows, macOS, Linux or a NAS | [Packages](https://github.com/ZHanry/home-tunnel-client/releases/latest) · [Repository](https://github.com/ZHanry/home-tunnel-client) |
| Android | Remotely manage your devices and services | [APK](https://github.com/ZHanry/home-tunnel-android/releases/latest) · [Repository](https://github.com/ZHanry/home-tunnel-android) |
| Project hub | Website, shared documentation and release overview | This repository |

## What is new in 6.0

- New top navigation in the console, a local service workspace on desktop, and four destinations on Android.
- Registered desktop and CLI sessions are restricted to their own device. Web and Android sessions manage devices owned by the account.
- One administrator per deployment. Deleting a regular user revokes sessions and device credentials, removes connections and preserves audit history.
- Service search, explicit target device selection, recoverable form conflicts and clear deletion confirmation.
- Focused downloads: APK on Android, platform packages on desktop, and a deployment archive for the server. Build and signing evidence remains in Actions.

## Get connected

1. [Deploy the server](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/SELF_HOSTING.md).
2. Install the client on a home computer or NAS and sign in to register it.
3. Add a connection using an address reachable from that device, then copy its public address.
4. Sign in on Android or the Web console to manage your devices remotely.

Android is a management app. Tunnels run on computers or NAS devices. Users can create HTTP / HTTPS connections; administrators assign public TCP and fixed UDP ports. Raw applications provide their own authentication and encryption.

![6.0 server overview](docs/site/assets/admin-dashboard.jpg)

[Downloads](docs/DOWNLOADS.md) · [Getting started](docs/GETTING_STARTED.md) · [Upgrading](https://github.com/ZHanry/home-tunnel-server/blob/main/docs/UPGRADING.md) · [Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)
