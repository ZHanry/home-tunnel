# Home Tunnel Linux Client

This directory contains the headless Linux client. It uses two processes:

- `home-tunnel-client` owns control-center authentication, device registration, configuration sync, lease renewal, heartbeat reporting, state persistence, and process supervision.
- `home-tunnel-agent` is built from the same restricted FRP 0.62.1 source and `windows-agent/main.go` validation surface as the Windows release. It still rejects generic FRP commands, TCP/UDP proxies, visitors, and arbitrary plugins.

The service supports Linux `amd64` and `arm64`. It publishes HTTP or HTTPS targets reachable from the Linux host; it is not a general-purpose VPN or TCP/UDP tunnel.

## Build a package

Install Go 1.23.12, `curl`, `sha256sum`, `tar`, and either `unzip` or Python 3, then run:

```sh
ARCH=amd64 ./linux-client/packaging/build-release.sh
ARCH=arm64 ./linux-client/packaging/build-release.sh
```

The script downloads the pinned FRP source archive, verifies its SHA-256, builds both static binaries, embeds the Agent hash into the controller, and writes a versioned archive under `outputs/linux/`.

## Install and enroll

On the target Linux machine:

```sh
tar -xzf home-tunnel-linux-2.3.0-amd64.tar.gz
cd home-tunnel-linux-2.3.0-amd64
sudo ./install.sh
sudo home-tunnel-enroll
```

The enrollment helper reads passwords without echoing them, writes them only to temporary mode-`0600` files, registers the device, removes the temporary files, and enables the systemd service. If the administrator supplied a temporary password, enter a compliant new password at the second prompt. Otherwise leave the second prompt empty.

The permanent device credential and cached configuration are stored in `/var/lib/home-tunnel/state.json`, owned by the dedicated `home-tunnel` account with mode `0600`. Passwords and access/refresh tokens are not persisted.

## Operations

```sh
sudo systemctl status home-tunnel-client
sudo journalctl -u home-tunnel-client -n 100 --no-pager
sudo -u home-tunnel home-tunnel-client status
sudo -u home-tunnel home-tunnel-client status --json
```

Connections are currently created and assigned through the control-center administrator UI. The daemon fetches configuration through a three-minute safety poll, sends heartbeats every 30 seconds, renews leases before expiry, stops an expired tunnel, and restarts a crashed Agent up to five times with exponential backoff.

The first Linux release does not yet implement the Windows client's WebSocket change notification or automatic package updater. Configuration changes therefore take up to three minutes to arrive unless the service is restarted.
