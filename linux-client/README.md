# Home Tunnel Linux/macOS Client

This directory is the Home Tunnel desktop and NAS client. Windows, macOS, and
Linux desktops all run `home-tunnel-gui`. Headless NAS hosts keep using
`home-tunnel-client` as a systemd/launchd service.

It uses two processes:

- `home-tunnel-client` owns control-center authentication, device registration, configuration sync, lease renewal, heartbeat reporting, state persistence, and process supervision.
- `home-tunnel-agent` is built from the same restricted FRP 0.70.1 source and
  `windows-agent/main.go` validation surface as the Windows release. It accepts
  only issued HTTP connections and administrator-authorized exact TCP/UDP
  ports, and rejects generic FRP commands, cross-protocol port reuse, visitors,
  and arbitrary plugins.

The service supports Linux `amd64`/`arm64` and macOS (darwin) `amd64`/`arm64`.
It publishes HTTP or HTTPS targets reachable from the host, general TCP byte
streams, and fixed-port UDP services when those advanced transports are
explicitly enabled. It is not a general-purpose VPN: raw IP, ICMP, broadcast,
multicast, STCP, XTCP, SUDP, visitor configurations, dynamic UDP media-port
negotiation, and arbitrary FRP plugins are unsupported.

## Build a package

Install Go 1.26.6, `curl`, `tar`, `sha256sum` (the macOS script also accepts `shasum`), and either `unzip` or Python 3, then run:

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

On the target Linux machine, download the archive from GitHub Release `v3.2.0`.
The tarball is still named `3.2.0-rc.3` because Stable promotes the RC assets
without rebuilding:

```sh
tar -xzf home-tunnel-linux-3.2.0-rc.3-amd64.tar.gz
cd home-tunnel-linux-3.2.0-rc.3-amd64
sudo ./install.sh
sudo home-tunnel-enroll
```

The enrollment helper reads passwords without echoing them, writes them only to temporary mode-`0600` files, registers the device, removes the temporary files, and enables the systemd service. If the administrator supplied a temporary password, enter a compliant new password at the second prompt. Otherwise leave the second prompt empty.

The permanent device credential and cached configuration are stored in `/var/lib/home-tunnel/state.json`, owned by the dedicated `home-tunnel` account with mode `0600`. Passwords and access/refresh tokens are not persisted.

## Install and enroll (macOS)

On the target Mac:

```sh
tar -xzf home-tunnel-macos-3.2.0-rc.3-arm64.tar.gz
cd home-tunnel-macos-3.2.0-rc.3-arm64
sudo ./install.sh
sudo home-tunnel-enroll
```

`install.sh` creates the hidden `_hometunnel` service account, installs the binaries to `/usr/local/bin` and `/usr/local/lib/home-tunnel/`, places the `com.hometunnel.client` LaunchDaemon in `/Library/LaunchDaemons/`, and creates the mode-`0700` state directory `/usr/local/var/lib/home-tunnel` plus the log directory `/usr/local/var/log/home-tunnel`. It intentionally does not load the daemon: `home-tunnel-enroll` bootstraps it once a device credential exists, mirroring the Linux flow. Use `sudo ./install.sh --upgrade` to replace binaries (a previously loaded daemon is reloaded) and `sudo ./install.sh --uninstall` to unload the daemon and remove the binaries while keeping the state directory and service account.

The device credential is stored in `/usr/local/var/lib/home-tunnel/state.json`, owned by `_hometunnel` with mode `0600`. The state and Agent paths can be overridden with the `--state`/`--agent` flags or the `HOME_TUNNEL_STATE_PATH`/`HOME_TUNNEL_AGENT_PATH` environment variables on both platforms.

## Graphical client (Linux / macOS / Windows desktop)

The shared GUI is `home-tunnel-gui`, a native window on Windows (WebView2),
Linux (GTK + WebKitGTK) and macOS (WKWebView), plus a system tray on all three.
Closing the window hides it to the tray; tunnels keep running until you quit
from the tray or the window. A second launch restores the existing window.
Linux/macOS GUI builds need CGO and the desktop WebKit libraries. Release
tarballs ship this binary; `install.sh` puts it on `PATH` as `home-tunnel-gui`.

Linux GUI build needs GTK 3 and WebKitGTK 4.1 (or 4.0 with `-tags webkit2gtk4.0`). macOS GUI needs CGO and the system WebKit framework.

```sh
# Linux
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev
CGO_ENABLED=1 go build ./cmd/home-tunnel-gui

# macOS
CGO_ENABLED=1 go build ./cmd/home-tunnel-gui

# Windows x64 (WebView2, no CGO)
#   powershell ./linux-client/packaging/windows/build-gui.ps1
```

Headless connection commands:

```sh
home-tunnel-client connection ls
home-tunnel-client connection add --name nas --subdomain alice-nas --local-port 5001
home-tunnel-client connection set --id <id> --enabled=false
home-tunnel-client connection delete --id <id>
```

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

For RTSP, create a general TCP connection rather than looking for a separate
RTSP type. A typical mapping is public `10554/tcp` to the camera's local
`554/tcp`, used as follows:

```sh
ffplay -rtsp_transport tcp rtsp://PUBLIC_HOST:10554/path
```

Native RTP/RTCP over UDP requires fixed camera media ports and one managed UDP
mapping per port; dynamically selected ports are not guaranteed to work. Raw
TCP/UDP bypass Caddy and the Traffic Gateway, so the target application must
provide its own authentication and encryption. Operators must enforce source
and rate limits in the host/cloud firewall, especially for UDP reflection and
amplification risks.

Upgrade the server/control center and all clients before enabling UDP. This
client declares `supported_proxy_types` during sync. A legacy client that omits
the field receives UDP connections as `disabled` and cannot start them. On its
first post-upgrade launch, the current client requests one full sync before
persisting the new sync-capability marker, so a compatibility-disabled cached
UDP record is refreshed.

The headless client does not yet implement the Windows client's automatic package updater. While the WebSocket channel is unavailable, configuration changes still arrive within three minutes through the safety poll.
