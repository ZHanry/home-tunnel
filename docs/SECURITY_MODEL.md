# Security model

Home Tunnel is intended for personal and small trusted-user deployments. It reduces configuration mistakes and limits the Windows Agent's capabilities, but it does not make an exposed local application safe by itself.

## Trust boundaries

- **Public Internet → Caddy:** Caddy terminates public TLS and only requests on-demand certificates after consulting the control center.
- **Caddy → gateway/control center:** clear HTTP is carried on isolated Docker networks on the same host.
- **Windows Agent → FRPS:** FRP TLS is required. The user selects a control-center HTTPS origin; the client discovers its public FRPS address and tunnel suffix, and the Agent requires the generated configuration to match that profile.
- **FRPS/gateway → control center:** service calls use generated high-entropy keys and are not published as host ports.
- **Control center → PostgreSQL:** database credentials are mounted as Docker secrets in the reference deployment.
- **Client local state:** device credentials use Windows Credential Manager; non-secret state and redacted logs are stored under the user's local application data directory.

## Agent restrictions

The managed Agent is built from pinned FRP 0.62.1 source and rejects generic FRP command-line operation. It validates, among other things:

- the FRPS host and port returned by the user-selected HTTPS control center;
- a signed Home Tunnel lease and a single metadata field;
- HTTP proxies only, with a hostname under the selected server's tunnel suffix;
- direct TCP transport with required TLS and heartbeat values;
- no visitors, virtual networking, external includes, local web UI or arbitrary plugins;
- bounded local targets and connection count.

These checks are defense in depth. A user who can replace both the installed client and its embedded hash metadata already controls that local installation.

## Update trust

The Windows client keeps server discovery and software updates separate. It accepts server configuration only from the HTTPS origin explicitly entered by the user, while release metadata and installers come only from this project's GitHub Releases. It manually validates every GitHub redirect, allows only GitHub's official release-asset hosts, and rejects unexpected repositories, tags, file names, sizes and SHA-256 hashes. A SHA-256 value stored beside the installer is not an independent signature; public releases should also be Authenticode-signed by a trusted certificate.

## What Home Tunnel does not protect against

- Vulnerabilities or weak authentication in the local application being published
- A compromised server host, Docker daemon, administrator account or signing key
- Malicious software running with the same Windows user privileges
- Traffic inspection inside a fully compromised server
- Denial-of-service attacks that saturate the public host before application rate limits apply

Use application-level authentication on exposed services, apply operating-system updates, restrict administrative access, monitor logs and keep recoverable backups.
