# Self-hosting

This guide describes the portable root-level `compose.yaml`. The scripts under `deploy/` also contain an ARM64 production profile for the original Home Tunnel installation; that profile assumes an existing Caddy deployment and is not the general quick-start path.

## Requirements

- A Linux server with Docker Engine and Docker Compose v2
- An `amd64` or `arm64` CPU, at least 2 GiB RAM and 5 GiB free disk space
- A public IPv4 or IPv6 address reachable on TCP 80, 443 and 7000; UDP 443 is optional for HTTP/3
- A domain you control
- A Windows 10/11 x64 machine to run the current desktop client

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

The command creates an ignored `.env` file and five ignored secret files under `deploy/secrets/`. It refuses to overwrite existing configuration unless the PowerShell command is explicitly given `-Force`. Do not commit or share these files.

## 2. Validate and start the server

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Caddy obtains certificates after DNS is active and the hostname is requested. The control center authorizes the console hostname and assigned connection hostnames before issuance.

Read the one-time administrator password locally:

```sh
cat deploy/secrets/bootstrap_admin_password
```

Open `https://console.tunnel.example.com/admin`, sign in as `admin`, and change the password immediately. Do not paste the password into an issue, log or shell history.

## 3. Install and connect the Windows client

Download the versioned Windows x64 installer from GitHub Releases. On first launch, enter the control-center root address, for example `https://console.tunnel.example.com`, then sign in with a user created by the administrator. The client retrieves the public FRPS host, port and tunnel suffix from that same HTTPS origin.

To build the generic installer yourself, use Windows with .NET 8, Inno Setup 6, Windows SDK signing tools and `windres`:

```powershell
.\windows-client\packaging\build-exe.ps1 `
  -AppId "{{11111111-2222-3333-4444-555555555555}}"
```

Use a new App ID for your fork so it does not overwrite a different Home Tunnel distribution. The development script creates a temporary self-signed Authenticode certificate. Public distribution should use a trusted code-signing certificate and a protected signing workflow.

The official client checks this project's GitHub Releases directly, so a self-hosted server does not need to store or serve the installer. You may copy only `latest.json` into `deploy/downloads/` if you want the landing page to show the current version, size and SHA-256; its download button still points to GitHub.

## Operations

View status and logs:

```sh
docker compose ps
docker compose logs --tail 100 control-center traffic-gateway frps caddy
```

Upgrade source images without deleting data:

```sh
git pull --ff-only
docker compose build --pull
docker compose up -d
```

Back up PostgreSQL before upgrades and retain the generated secret files in an encrypted backup. Never use `docker compose down -v` unless you intentionally want to delete the database and Caddy state.

## Current scope

- Windows 10/11 x64 client
- HTTP and HTTPS local targets
- One public tunnel domain per server deployment
- Source-built `amd64` and `arm64` server containers

Raw TCP/UDP forwarding, macOS/Linux clients and a single-binary server are not part of the current release.
