# Self-hosting

This guide describes the portable root-level `compose.yaml`. The scripts under `deploy/` also contain an ARM64 production profile for the original Home Tunnel installation; that profile assumes an existing Caddy deployment and is not the general quick-start path.

## Requirements

- A Linux server with Docker Engine and Docker Compose v2
- An `amd64` or `arm64` CPU, at least 1 GiB RAM (with swap on small hosts) and 2 GiB free disk space
- A public IPv4 or IPv6 address reachable on TCP 80, 443 and 7000; UDP 443 is optional for HTTP/3. Optional raw TCP/UDP tunnels also require their explicitly configured port ranges.
- A domain you control
- An `amd64`/`arm64` Linux machine for the Stable headless systemd client; Windows x64 EXE is Experimental and macOS headless is Beta

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

## Optional general TCP and fixed-port UDP

The base `compose.yaml` does not publish raw application ports. Choose only one
of these overrides after deciding which protocol and narrow port range you
need:

| Override | Enables | Matching `.env` settings |
| --- | --- | --- |
| `deploy/compose.tcp.yaml` | General TCP | `HOME_TUNNEL_TCP_BIND_ADDRESS`, `HOME_TUNNEL_TCP_PORT_START`, `HOME_TUNNEL_TCP_PORT_END` |
| `deploy/compose.udp.yaml` | Fixed-port UDP | `HOME_TUNNEL_UDP_BIND_ADDRESS`, `HOME_TUNNEL_UDP_PORT_START`, `HOME_TUNNEL_UDP_PORT_END` |
| `deploy/compose.l4.yaml` | Both with one numeric range | `HOME_TUNNEL_L4_BIND_ADDRESS`, `HOME_TUNNEL_L4_PORT_START`, `HOME_TUNNEL_L4_PORT_END` |

TCP and UDP have separate port namespaces. The same numeric port may be
assigned once for TCP and once for UDP when both protocols are enabled.
Do not include deployment-reserved ports in a raw range: TCP `80`, `443`,
internal `7000`/`8080`, or the configured `HOME_TUNNEL_FRPS_PORT`; UDP `443`
is also reserved. Caddy owns host `80/443`, while FRPS owns its control and
Web-vhost listeners. The control center and FRPS entrypoint reject these ranges
before starting a misleading configuration.

For example, to make public port `10554/tcp` available for an administrator to
assign, set the TCP range to include it, restrict the same TCP port in the host
and cloud firewalls, validate the merged configuration, and start the stack:

```dotenv
HOME_TUNNEL_TCP_BIND_ADDRESS=0.0.0.0
HOME_TUNNEL_TCP_PORT_START=10554
HOME_TUNNEL_TCP_PORT_END=10554
```

```sh
docker compose -f compose.yaml -f deploy/compose.tcp.yaml config --quiet
docker compose -f compose.yaml -f deploy/compose.tcp.yaml up -d
```

Use `deploy/compose.udp.yaml` with the `HOME_TUNNEL_UDP_*` range for UDP only,
or `deploy/compose.l4.yaml` with the `HOME_TUNNEL_L4_*` range to publish both
protocols. When running the ARM64 profile from the `deploy/` directory, use the
corresponding local filename such as `compose.udp.yaml` or `compose.l4.yaml`.
If both protocols need different ranges, intentionally combine the TCP and UDP
profiles and set both protocol-specific groups. Do not combine profiles unless
you have checked the merged Compose port bindings and environment values.
Before removing an overlay or narrowing a range, disable every connection
outside the new range while the old configuration is still active. After the
Compose change, re-apply affected connections so clients receive a fresh full
configuration; FRPS rejects any stale out-of-range proxy in the meantime.

After the deployment is healthy, an administrator can create a connection and
assign one exact public port inside the enabled range. TCP carries an arbitrary
TCP byte stream; RTSP is not a separate tunnel type. A camera listening on
local `554/tcp` can be published as public `10554/tcp`, then opened with:

```sh
ffplay -rtsp_transport tcp rtsp://PUBLIC_HOST:10554/path
```

Replace `PUBLIC_HOST` with the reachable host or address configured as
`HOME_TUNNEL_FRPS_PUBLIC_HOST`.
For an IPv6 literal, keep the configuration value unbracketed and bracket it
in application URLs, for example
`rtsp://[2001:db8::10]:10554/path`; API `public_endpoint` values are formatted
this way automatically.

For native RTP/RTCP over UDP, configure the camera to use fixed media ports and
create one UDP connection for each port. Dynamic or randomly negotiated media
ports are not guaranteed to work. Raw IP, ICMP, broadcast, multicast, STCP,
XTCP, SUDP, visitor configurations, and arbitrary FRP plugins are not
supported.

TCP and UDP traffic go directly to FRPS and bypass Caddy and the Traffic
Gateway. Gateway Basic Auth, IP allowlists, rate limits, traffic metering, and
monthly quotas therefore do not apply. Require the target application to
authenticate users and encrypt sensitive traffic. Apply protocol/port source
restrictions and rate limits in the host or cloud firewall. UDP services can
be abused for reflection/amplification; assess the protocol and limit sources
and rates before exposing it.

## 3. Install and connect a client

### Windows

Download `HomeTunnel-Setup-3.1.0-x64.exe` from the latest GitHub Release and
verify its published SHA-256 before installation. The Windows x64 package is
Experimental and self-signed, so Windows can show an unknown-publisher or
SmartScreen warning. On first launch, enter the control-center root address,
for example `https://console.tunnel.example.com`, and sign in with a user
created by the administrator. The client retrieves the public FRPS host, port,
and tunnel suffix from that same HTTPS origin.

To build the generic installer yourself, use Windows with .NET 10 LTS, Inno Setup 6, Windows SDK signing tools and `windres`:

```powershell
.\windows-client\packaging\build-exe.ps1 `
  -AppId "{{11111111-2222-3333-4444-555555555555}}"
```

Use a new App ID for your fork so it does not overwrite a different Home Tunnel distribution. The development script creates a temporary self-signed Authenticode certificate. Do not describe it as a trusted publisher signature; trusted distribution requires a public code-signing certificate and a protected signing workflow.

`latest.json` is a Windows-only update manifest promoted unchanged from the
verified RC asset set. A missing manifest safely degrades to “updates
unavailable” without affecting tunnels.

### Linux

Build a headless `amd64` or `arm64` package on a Linux build machine with Go 1.26.6:

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

For the transport upgrade, back up SQLite, upgrade the server/control center
and FRPS first, then upgrade every Windows, Linux, and macOS client before
enabling UDP. Updated clients declare
`supported_proxy_types = ["http", "tcp", "udp"]`. A legacy client that omits
`supported_proxy_types` receives a UDP record with `enabled=false` and must not
start it. On first launch after upgrading, a current client requests one full
sync before recording the new sync-capability marker, replacing any cached
compatibility-disabled UDP state. An existing deployment that only sets
`TCP_TUNNEL_ENABLED` stays TCP-only; the upgrade does not implicitly open UDP.
Re-apply the selected TCP, UDP, or L4 override on every later Compose update.
For an application rollback to 3.0, first disable or delete every UDP
connection while 3.1 is still running, then restore the pre-`008` database
backup together with the old images. Do not let a 3.0 writer reinterpret a UDP
compatibility mirror as TCP; schema `008` rejects that protocol drift.
FRPS authorizes `Ping` as well as login and proxy creation. Every heartbeat
rechecks the lease and subject status, so deleting/revoking a device removes
raw listeners within roughly the 90-second heartbeat window. A control-center
or authorization-plugin outage that lasts beyond the same window also stops
raw tunnels; restore the control plane and clients reconnect with valid leases.
Use the host firewall or restart FRPS when an immediate cutoff is required.

The database is `/data/home-tunnel.db` in the `sqlite-data` volume and uses WAL mode. The managed production profile includes online encrypted SQLite backup and integrity-verification scripts. Back it up before upgrades and retain the generated secret files in an encrypted backup. Never use `docker compose down -v` unless you intentionally want to delete SQLite and Caddy state.

The control center also snapshots its own database. Shortly after startup and then every 24 hours it runs SQLite `VACUUM INTO` and writes `control-center-<UTC timestamp>.sqlite3` into `/data/backups/` inside the same `sqlite-data` volume, keeping the newest seven snapshots. Adjust this with the `BACKUP_INTERVAL_HOURS` (set `0` to disable), `BACKUP_RETENTION_COUNT` and `BACKUP_DIRECTORY` environment variables on the `control-center` service. To restore a snapshot, stop the stack, replace `/data/home-tunnel.db` with the chosen backup file (and delete any leftover `home-tunnel.db-wal` and `home-tunnel.db-shm` files), then start the stack again.

The managed updater also detects deployments created by older releases with PostgreSQL and exits before changing containers or data. Export or migrate that database before switching profiles.

### Traffic quotas and alerts

Each user can be given a monthly traffic quota (upload + download, per UTC calendar month) from the admin console. When a user reaches the quota the control center suspends them at the gateway layer: their connections stop serving public traffic and on-demand certificates are no longer authorized, but the connection and device configuration are left untouched, so no tunnel is reconfigured or restarted. Usage resets at the start of each month and suspended users are restored automatically; lowering usage or raising the quota also restores them on the next check (which runs about once a minute). Clearing a user's quota removes the limit and lifts any active suspension.

Optional alerts are delivered to an outbound webhook and/or Telegram. Set `HOME_TUNNEL_ALERT_WEBHOOK_URL`, `HOME_TUNNEL_ALERT_TELEGRAM_BOT_TOKEN` and `HOME_TUNNEL_ALERT_TELEGRAM_CHAT_ID` in `.env` (blank disables a channel; Telegram needs both the token and the chat id). Alerts fire on quota warning (80%), suspension and restoration, and on device offline (no heartbeat for five minutes) and recovery. Deliveries have a five-second timeout, retry once, are de-duplicated per subject within a ten-minute window, and never block or fail control-center operations — failures are only logged. Use the admin console's "test alert" action to verify channel configuration. Certificate-issuance failures happen inside Caddy and are not covered by these alerts.

## Current scope

- Linux `amd64`/`arm64` server and headless systemd client: Stable
- macOS `amd64`/`arm64` headless launchd client: Beta
- Windows 10/11 x64 graphical client: self-signed Experimental EXE plus source
- HTTP and HTTPS local targets
- Administrator-managed general TCP and fixed-port UDP targets
- One public tunnel domain per server deployment
- Prebuilt and source-buildable `amd64` and `arm64` server containers

A single-binary server, raw IP/ICMP, broadcast/multicast transport, FRP
STCP/XTCP/SUDP, visitors, and arbitrary plugins are outside the supported
scope. TCP and UDP are administrator-only advanced features and remain disabled
unless their matching Compose override is explicitly added.

Disabling a TCP or UDP connection pushes a stop configuration to the managed
client. For an immediate hard cutoff of a disconnected or hostile client, also
block the assigned protocol/port in the host firewall or restart FRPS without
the raw-transport override.
