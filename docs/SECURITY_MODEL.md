# Security model

Home Tunnel is intended for personal and small trusted-user deployments. It reduces configuration mistakes and limits the managed Agent's capabilities, but it does not make an exposed local application safe by itself.

## Trust boundaries

- **Public Internet → Caddy:** Caddy terminates public TLS and only requests on-demand certificates after consulting the control center.
- **Public Internet → raw TCP/UDP ports:** optional administrator-assigned TCP
  and UDP ports terminate at FRPS and bypass Caddy and the Traffic Gateway.
  FRPS authorization still checks the signed lease, proxy type, and exact port,
  but there is no per-request gateway. Host/cloud firewall policy and the
  exposed application's own security are therefore the public-edge controls on
  this path.
- **FRPS → control center authorization:** `Login`, `NewProxy`, `CloseProxy`,
  and `Ping` are authenticated through the authorization plugin. Each Ping
  rechecks lease expiry plus user, device, token, and configuration status.
  Revocation therefore stops raw forwarding within the FRPS heartbeat window
  (about 90 seconds). A control-center/plugin outage lasting past that window
  also fails raw tunnels closed; this is an intentional security tradeoff.
- **Caddy → gateway/control center:** clear HTTP is carried on isolated Docker networks on the same host.
- **Managed Agent → FRPS:** FRP TLS is required. The user selects a control-center HTTPS origin; the client discovers its public FRPS address and tunnel suffix, and the Agent requires the generated configuration to match that profile. When the deployment provides the generated self-signed FRPS certificate, the control center serves its public part over HTTPS, the client writes it to the runtime directory and pins `transport.tls.trustedCaFile`/`serverName`, and the Agent independently re-verifies the pinned file's SHA-256 against the client-supplied `--tls-ca-sha256` value, so the FRP connection authenticates the server instead of only encrypting the stream. Deployments without the certificate keep the previous encrypt-only behavior.
- **FRPS/gateway → control center:** service calls use generated high-entropy keys and are not published as host ports.
- **Control center → SQLite:** the single database file is stored in a private Docker volume with mode `0600`; WAL and foreign-key checks are enabled, and no database network listener exists.
- **Client local state:** the Windows device credential uses Windows Credential Manager. Linux uses a dedicated system account and a mode-`0600` state file under `/var/lib/home-tunnel`; macOS Beta uses the launchd service state directory documented by its package. Enrollment passwords and access/refresh tokens are not persisted.
- **Web console tenancy:** a deployment has a single administrator. `role=user` sessions sign in at the same console origin. Client APIs are scoped by the verified session `user_id`; `/api/v1/admin/*` remains 403. A user cannot list, bind, or mutate another tenant's devices or connections. Subdomain occupancy is global; availability suggestions do not reveal the occupying username except to the administrator.

## Agent restrictions

The managed Agent is built from pinned FRP 0.70.1 source and rejects generic FRP command-line operation. It validates, among other things:

- the FRPS host and port returned by the user-selected HTTPS control center;
- a signed Home Tunnel lease and a single metadata field;
- HTTP proxies with exactly one hostname under the selected server's tunnel suffix plus only server-verified custom domains;
- TCP and UDP proxies only when the control center has assigned the exact
  protocol and remote port and passed it through the protocol-specific
  `--allow-tcp-ports` or `--allow-udp-ports` trust argument; a TCP authorization
  cannot authorize UDP, or vice versa;
- direct TCP transport with required TLS and heartbeat values;
- no raw IP, ICMP, broadcast, multicast, STCP, XTCP, SUDP, visitors, virtual
  networking, external includes, local web UI, or arbitrary plugins;
- bounded local targets and connection count.

These checks are defense in depth. A user who can replace both the installed client and its embedded hash metadata already controls that local installation.

## Raw transport boundary

General TCP and fixed-port UDP are optional direct FRPS paths. Both are off by
default, require administrator authorization, and accept only an exact public
port inside the deployment's configured range. RTSP is not a separate proxy
type: RTSP-over-TCP uses a TCP mapping, while native RTP/RTCP over UDP requires
fixed camera media ports and one UDP mapping for each port. Dynamic UDP media
ports are not guaranteed to work.

Raw transports do not pass through Caddy or the Traffic Gateway. Consequently,
gateway Basic Auth, IP allowlists, hierarchical rate limits, traffic samples,
bandwidth accounting, and monthly quotas do not apply. The local application
must provide authentication and encryption appropriate to its protocol. The
operator must also restrict the published protocol/ports in the host or cloud
firewall. UDP should be limited by source and rate, and services with
reflection/amplification behavior should not be exposed without specific
mitigations.

## Update trust

The Experimental Windows client keeps server discovery and software updates
separate. It accepts server configuration only from the HTTPS origin explicitly
entered by the user. Windows release metadata is optional: a missing
`latest.json` safely disables update discovery without affecting tunnels.
Metadata and installers may come only from this project's GitHub Releases; the
client validates every redirect and rejects unexpected repositories, tags, file
names, sizes, and SHA-256 hashes. The release also provides aggregate and
Sigstore evidence, but the current ephemeral self-signed Authenticode
certificate does not establish publisher trust. Trusted Windows distribution
still requires a public certificate and protected signing environment.

## What Home Tunnel does not protect against

- Vulnerabilities or weak authentication in the local application being published
- A compromised server host, Docker daemon, administrator account or signing key
- Malicious software running with the same Windows user privileges
- Traffic inspection inside a fully compromised server
- Denial-of-service attacks that saturate the public host before application rate limits apply

Use application-level authentication on exposed services, apply operating-system updates, restrict administrative access, monitor logs and keep recoverable backups.
