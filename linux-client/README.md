# Home Tunnel Linux/macOS Client

This directory contains the headless client for Linux and macOS. It uses two processes:

- `home-tunnel-client` owns control-center authentication, device registration, configuration sync, lease renewal, heartbeat reporting, state persistence, and process supervision.
- `home-tunnel-agent` is built from the same restricted FRP 0.62.1 source and `windows-agent/main.go` validation surface as the Windows release. It still rejects generic FRP commands, TCP/UDP proxies, visitors, and arbitrary plugins.

The service supports Linux `amd64`/`arm64` and macOS (darwin) `amd64`/`arm64`. It publishes HTTP or HTTPS targets reachable from the host; it is not a general-purpose VPN or TCP/UDP tunnel.

## Build a package

Install Go 1.23.12, `curl`, `tar`, `sha256sum` (the macOS script also accepts `shasum`), and either `unzip` or Python 3, then run:

```sh
# Linux packages
ARCH=amd64 ./linux-client/packaging/build-release.sh
ARCH=arm64 ./linux-client/packaging/build-release.sh

# macOS packages (cross-compile from any build host)
ARCH=amd64 ./linux-client/packaging/macos/build-release.sh
ARCH=arm64 ./linux-client/packaging/macos/build-release.sh
```

Each script downloads the pinned FRP source archive, verifies its SHA-256, builds both static binaries for the target OS, embeds the Agent hash into the controller, and writes a versioned archive under `outputs/linux/` or `outputs/macos/`. The binary version self-check only runs when the build host matches the target OS and architecture; cross-builds skip it.

## Install and enroll (Linux)

On the target Linux machine:

```sh
tar -xzf home-tunnel-linux-2.3.0-amd64.tar.gz
cd home-tunnel-linux-2.3.0-amd64
sudo ./install.sh
sudo home-tunnel-enroll
```

The enrollment helper reads passwords without echoing them, writes them only to temporary mode-`0600` files, registers the device, removes the temporary files, and enables the systemd service. If the administrator supplied a temporary password, enter a compliant new password at the second prompt. Otherwise leave the second prompt empty.

The permanent device credential and cached configuration are stored in `/var/lib/home-tunnel/state.json`, owned by the dedicated `home-tunnel` account with mode `0600`. Passwords and access/refresh tokens are not persisted.

## Install and enroll (macOS)

On the target Mac:

```sh
tar -xzf home-tunnel-macos-2.3.0-arm64.tar.gz
cd home-tunnel-macos-2.3.0-arm64
sudo ./install.sh
sudo home-tunnel-enroll
```

`install.sh` creates the hidden `_hometunnel` service account, installs the binaries to `/usr/local/bin` and `/usr/local/lib/home-tunnel/`, places the `com.hometunnel.client` LaunchDaemon in `/Library/LaunchDaemons/`, and creates the mode-`0700` state directory `/usr/local/var/lib/home-tunnel` plus the log directory `/usr/local/var/log/home-tunnel`. It intentionally does not load the daemon: `home-tunnel-enroll` bootstraps it once a device credential exists, mirroring the Linux flow. Use `sudo ./install.sh --upgrade` to replace binaries (a previously loaded daemon is reloaded) and `sudo ./install.sh --uninstall` to unload the daemon and remove the binaries while keeping the state directory and service account.

The device credential is stored in `/usr/local/var/lib/home-tunnel/state.json`, owned by `_hometunnel` with mode `0600`. The state and Agent paths can be overridden with the `--state`/`--agent` flags or the `HOME_TUNNEL_STATE_PATH`/`HOME_TUNNEL_AGENT_PATH` environment variables on both platforms.

## Operations (Linux)

```sh
sudo systemctl status home-tunnel-client
sudo journalctl -u home-tunnel-client -n 100 --no-pager
sudo -u home-tunnel home-tunnel-client status
sudo -u home-tunnel home-tunnel-client status --json
```

## Operations (macOS)

```sh
sudo launchctl print system/com.hometunnel.client
sudo tail -n 100 /usr/local/var/log/home-tunnel/client.log
sudo -u _hometunnel home-tunnel-client status
sudo -u _hometunnel home-tunnel-client status --json
sudo launchctl kickstart -k system/com.hometunnel.client   # restart
sudo launchctl bootout system/com.hometunnel.client        # stop and unload
```

launchd restarts the daemon after a crash (`KeepAlive` with `SuccessfulExit=false`, at most one launch every 10 seconds through `ThrottleInterval`) but, unlike the systemd unit, provides no sandboxing directives: isolation relies on the unprivileged `_hometunnel` account and the directory permissions set by the installer. Logs append to `/usr/local/var/log/home-tunnel/client.log` without built-in rotation; add an `/etc/newsyslog.d/` entry if rotation is needed.

> **Verification status.** macOS support in this release was validated through darwin cross-compilation of the client and static checks of the packaging scripts and plist. The launchd runtime behaviour (service account creation, crash restarts, log paths, enrollment flow) has not yet been exercised on real macOS hardware.

## Behaviour common to both platforms

Connections are currently created and assigned through the control-center administrator UI. The daemon receives configuration changes within seconds over a WebSocket notification channel and keeps a three-minute safety poll as the fallback, sends heartbeats every 30 seconds, renews leases before expiry, stops an expired tunnel, and restarts a crashed Agent up to five times with exponential backoff.

The headless client does not yet implement the Windows client's automatic package updater. While the WebSocket channel is unavailable, configuration changes still arrive within three minutes through the safety poll.
