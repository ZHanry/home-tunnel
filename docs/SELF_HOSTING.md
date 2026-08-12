# Self-hosting

This guide describes the portable root-level `compose.yaml`. The scripts under `deploy/` also contain an ARM64 production profile for the original Home Tunnel installation; that profile assumes an existing Caddy deployment and is not the general quick-start path.

## Requirements

- A Linux server with Docker Engine and Docker Compose v2
- An `amd64` or `arm64` CPU, at least 1 GiB RAM (with swap on small hosts) and 2 GiB free disk space
- A public IPv4 or IPv6 address reachable on TCP 80, 443 and 7000; UDP 443 is optional for HTTP/3
- A domain you control
- A Windows 10/11 x64 machine for the graphical client, or an `amd64`/`arm64` Linux machine for the headless systemd client

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

The command creates an ignored `.env` file and four ignored secret files under `deploy/secrets/`. It refuses to overwrite existing configuration unless the PowerShell command is explicitly given `-Force`. Do not commit or share these files.

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

Download the versioned Windows x64 installer from GitHub Releases. On first launch, enter the control-center root address, for example `https://console.tunnel.example.com`, then sign in with a user created by the administrator. The client retrieves the public FRPS host, port and tunnel suffix from that same HTTPS origin.

To build the generic installer yourself, use Windows with .NET 8, Inno Setup 6, Windows SDK signing tools and `windres`:

```powershell
.\windows-client\packaging\build-exe.ps1 `
  -AppId "{{11111111-2222-3333-4444-555555555555}}"
```

Use a new App ID for your fork so it does not overwrite a different Home Tunnel distribution. The development script creates a temporary self-signed Authenticode certificate. Public distribution should use a trusted code-signing certificate and a protected signing workflow.

The official client checks this project's GitHub Releases directly, so a self-hosted server does not need to store or serve the installer. You may copy only `latest.json` into `deploy/downloads/` if you want the landing page to show the current version, size and SHA-256; its download button still points to GitHub.

### Linux

Build a headless `amd64` or `arm64` package on a Linux build machine with Go 1.23.12:

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

The managed updater also detects deployments created by older releases with PostgreSQL and exits before changing containers or data. Export or migrate that database before switching profiles.

## Current scope

- Windows 10/11 x64 graphical client
- Linux `amd64`/`arm64` headless systemd client
- HTTP and HTTPS local targets
- One public tunnel domain per server deployment
- Prebuilt and source-buildable `amd64` and `arm64` server containers

Raw TCP/UDP forwarding, a macOS client and a single-binary server are not part of the current release.
