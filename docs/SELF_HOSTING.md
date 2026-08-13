# Self-hosting

This guide describes the portable root-level `compose.yaml`. The scripts under `deploy/` also contain an ARM64 production profile for the original Home Tunnel installation; that profile assumes an existing Caddy deployment and is not the general quick-start path.

## Requirements

- A Linux server with Docker Engine and Docker Compose v2
- An `amd64` or `arm64` CPU, at least 1 GiB RAM (with swap on small hosts) and 2 GiB free disk space
- A public IPv4 or IPv6 address reachable on TCP 80, 443 and 7000; UDP 443 is optional for HTTP/3
- A domain you control
- An `amd64`/`arm64` Linux machine for the Stable headless systemd client; Windows x64 is source-only/Experimental and macOS headless is Beta

Create DNS records before starting:

| Record | Example | Target |
| --- | --- | --- |
| Console | `console.tunnel.example.com` | Public server address |
| Wildcard | `*.tunnel.example.com` | Public server address |

Do not proxy TCP port 7000 through an HTTP-only CDN.

## 1. Generate local configuration

On Linux:

```sh
./deploy/scripts/new-selfhost-config.sh \
  tunnel.example.com \
  203.0.113.10 \
  console.tunnel.example.com \
  admin@example.com
```

On Windows PowerShell:

```powershell
.\deploy\scripts\new-selfhost-config.ps1 `
  -TunnelDomain tunnel.example.com `
  -FrpsPublicHost 203.0.113.10 `
  -ConsoleHost console.tunnel.example.com `
  -AcmeEmail admin@example.com
```

The command creates an ignored `.env` file and the ignored secret files under `deploy/secrets/`: four generated keys plus a ten-year self-signed FRPS TLS certificate (`frps_tls_cert.pem`/`frps_tls_key.pem`, EC P-256, CN and SAN covering the FRPS host). FRPS serves this certificate on TCP 7000, the control center publishes the public part through `/api/v1/public/config`, and managed clients pin it so the Agent only completes the FRP TLS handshake with your real FRPS. If the certificate files already exist they are kept as-is. It refuses to overwrite existing configuration unless the PowerShell command is explicitly given `-Force`. Do not commit or share these files.

## 2. Validate and start the server

```sh
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
```

Caddy obtains certificates after DNS is active and the hostname is requested. The control center authorizes the console hostname and assigned connection hostnames before issuance.

The default path pulls prebuilt `amd64`/`arm64` images. To build from the checked-out source instead:

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

Read the one-time administrator password locally:

```sh
cat deploy/secrets/bootstrap_admin_password
```

Open `https://console.tunnel.example.com/admin`, sign in as `admin`, and change the password immediately. Do not paste the password into an issue, log or shell history.

## 3. Install and connect a client

### Windows

Home Tunnel does not currently distribute an official Windows installer. Build the Windows x64 client from source, then on first launch enter the control-center root address, for example `https://console.tunnel.example.com`, and sign in with a user created by the administrator. The client retrieves the public FRPS host, port and tunnel suffix from that same HTTPS origin.

To build the generic installer yourself, use Windows with .NET 10 LTS, Inno Setup 6, Windows SDK signing tools and `windres`:

```powershell
.\windows-client\packaging\build-exe.ps1 `
  -AppId "{{11111111-2222-3333-4444-555555555555}}"
```

Use a new App ID for your fork so it does not overwrite a different Home Tunnel distribution. The development script creates a temporary self-signed Authenticode certificate. Public distribution should use a trusted code-signing certificate and a protected signing workflow.

`latest.json` is a Windows-only update manifest. It is intentionally absent while official Windows distribution is suspended; the control center and existing clients must treat its 404 response as “updates unavailable” without affecting tunnels. Historical self-signed Windows assets remain in old Releases for traceability but are unsupported and may show an unknown publisher warning.

### Linux

Build a headless `amd64` or `arm64` package on a Linux build machine with Go 1.26.5:

```sh
ARCH=amd64 ./linux-client/packaging/build-release.sh
```

Copy the archive from `outputs/linux/` to the target, verify its adjacent SHA-256 file, extract it, and run:

```sh
sudo ./install.sh
sudo home-tunnel-enroll
```

The enrollment helper registers the device without persisting the account password, then enables `home-tunnel-client.service`. Connections for the Linux device are managed in the control-center administrator UI. See [`linux-client/README.md`](../linux-client/README.md) for status, logs, upgrades and current limitations.

## Operations

View status and logs:

```sh
docker compose ps
docker compose logs --tail 100 control-center traffic-gateway frps caddy
```

The following upgrade command is only for deployments that already use the `sqlite-data` volume. If your current Compose file still contains a PostgreSQL service, stop here: the new profile intentionally does not auto-convert that database.

Upgrade prebuilt images without deleting SQLite data:

```sh
git pull --ff-only
docker compose pull
docker compose up -d
```

The database is `/data/home-tunnel.db` in the `sqlite-data` volume and uses WAL mode. The managed production profile includes online encrypted SQLite backup and integrity-verification scripts. Back it up before upgrades and retain the generated secret files in an encrypted backup. Never use `docker compose down -v` unless you intentionally want to delete SQLite and Caddy state.

The control center also snapshots its own database. Shortly after startup and then every 24 hours it runs SQLite `VACUUM INTO` and writes `control-center-<UTC timestamp>.sqlite3` into `/data/backups/` inside the same `sqlite-data` volume, keeping the newest seven snapshots. Adjust this with the `BACKUP_INTERVAL_HOURS` (set `0` to disable), `BACKUP_RETENTION_COUNT` and `BACKUP_DIRECTORY` environment variables on the `control-center` service. To restore a snapshot, stop the stack, replace `/data/home-tunnel.db` with the chosen backup file (and delete any leftover `home-tunnel.db-wal` and `home-tunnel.db-shm` files), then start the stack again.

The managed updater also detects deployments created by older releases with PostgreSQL and exits before changing containers or data. Export or migrate that database before switching profiles.

### Traffic quotas and alerts

Each user can be given a monthly traffic quota (upload + download, per UTC calendar month) from the admin console. When a user reaches the quota the control center suspends them at the gateway layer: their connections stop serving public traffic and on-demand certificates are no longer authorized, but the connection and device configuration are left untouched, so no tunnel is reconfigured or restarted. Usage resets at the start of each month and suspended users are restored automatically; lowering usage or raising the quota also restores them on the next check (which runs about once a minute). Clearing a user's quota removes the limit and lifts any active suspension.

Optional alerts are delivered to an outbound webhook and/or Telegram. Set `HOME_TUNNEL_ALERT_WEBHOOK_URL`, `HOME_TUNNEL_ALERT_TELEGRAM_BOT_TOKEN` and `HOME_TUNNEL_ALERT_TELEGRAM_CHAT_ID` in `.env` (blank disables a channel; Telegram needs both the token and the chat id). Alerts fire on quota warning (80%), suspension and restoration, and on device offline (no heartbeat for five minutes) and recovery. Deliveries have a five-second timeout, retry once, are de-duplicated per subject within a ten-minute window, and never block or fail control-center operations — failures are only logged. Use the admin console's "test alert" action to verify channel configuration. Certificate-issuance failures happen inside Caddy and are not covered by these alerts.

## Current scope

- Linux `amd64`/`arm64` server and headless systemd client: Stable
- macOS `amd64`/`arm64` headless launchd client: Beta
- Windows 10/11 x64 graphical client: Source / Experimental; no official binary
- HTTP and HTTPS local targets
- One public tunnel domain per server deployment
- Prebuilt and source-buildable `amd64` and `arm64` server containers

Raw UDP forwarding and a single-binary server are not part of the current release. TCP tunnels are an administrator-only advanced feature and remain disabled unless `deploy/compose.tcp.yaml` is explicitly added. Before enabling it, choose `HOME_TUNNEL_TCP_PORT_START`/`HOME_TUNNEL_TCP_PORT_END`, restrict the same range in the host firewall, and start with `docker compose -f compose.yaml -f deploy/compose.tcp.yaml up -d`.

TCP traffic bypasses the HTTP gateway, so HTTP Basic Auth, IP allowlists, traffic accounting and bandwidth quotas do not apply to it. Disabling a TCP connection pushes a stop configuration to the managed client; for an immediate hard cutoff of a disconnected or hostile client, also block the assigned port in the host firewall or restart FRPS without the TCP override.
