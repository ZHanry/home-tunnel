# Security model

Home Tunnel is intended for personal and small trusted-user deployments. It reduces configuration mistakes and limits the managed Agent's capabilities, but it does not make an exposed local application safe by itself.

## Trust boundaries

- **Public Internet → Caddy:** Caddy terminates public TLS and only requests on-demand certificates after consulting the control center.
- **Caddy → gateway/control center:** clear HTTP is carried on isolated Docker networks on the same host.
- **Managed Agent → FRPS:** FRP TLS is required. The user selects a control-center HTTPS origin; the client discovers its public FRPS address and tunnel suffix, and the Agent requires the generated configuration to match that profile. When the deployment provides the generated self-signed FRPS certificate, the control center serves its public part over HTTPS, the client writes it to the runtime directory and pins `transport.tls.trustedCaFile`/`serverName`, and the Agent independently re-verifies the pinned file's SHA-256 against the client-supplied `--tls-ca-sha256` value, so the FRP connection authenticates the server instead of only encrypting the stream. Deployments without the certificate keep the previous encrypt-only behavior.
- **FRPS/gateway → control center:** service calls use generated high-entropy keys and are not published as host ports.
- **Control center → SQLite:** the single database file is stored in a private Docker volume with mode `0600`; WAL and foreign-key checks are enabled, and no database network listener exists.
- **Client local state:** the Windows device credential uses Windows Credential Manager. Linux uses a dedicated system account and a mode-`0600` state file under `/var/lib/home-tunnel`; macOS Beta uses the launchd service state directory documented by its package. Enrollment passwords and access/refresh tokens are not persisted.

## Agent restrictions

The managed Agent is built from pinned FRP 0.70.1 source and rejects generic FRP command-line operation. It validates, among other things:

- the FRPS host and port returned by the user-selected HTTPS control center;
- a signed Home Tunnel lease and a single metadata field;
- HTTP proxies with exactly one hostname under the selected server's tunnel suffix plus only server-verified custom domains;
- TCP proxies only when the control center has assigned the exact remote port and passed it through the separate `--allow-tcp-ports` trust argument; UDP and all other proxy types remain forbidden;
- direct TCP transport with required TLS and heartbeat values;
- no visitors, virtual networking, external includes, local web UI or arbitrary plugins;
- bounded local targets and connection count.

These checks are defense in depth. A user who can replace both the installed client and its embedded hash metadata already controls that local installation.

## Update trust

The source-only Windows client keeps server discovery and software updates separate. It accepts server configuration only from the HTTPS origin explicitly entered by the user. Windows release metadata is optional: a missing `latest.json` safely disables update discovery without affecting tunnels. If official distribution is restored, metadata and installers may come only from this project's GitHub Releases; the client validates every redirect and rejects unexpected repositories, tags, file names, sizes and SHA-256 hashes. A SHA-256 value stored beside an installer is not an independent signature; future public binaries also require trusted Authenticode signing and protected VM verification.

## What Home Tunnel does not protect against

- Vulnerabilities or weak authentication in the local application being published
- A compromised server host, Docker daemon, administrator account or signing key
- Malicious software running with the same Windows user privileges
- Traffic inspection inside a fully compromised server
- Denial-of-service attacks that saturate the public host before application rate limits apply

Use application-level authentication on exposed services, apply operating-system updates, restrict administrative access, monitor logs and keep recoverable backups.
