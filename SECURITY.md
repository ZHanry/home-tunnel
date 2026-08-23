# Security policy

Home Tunnel exposes services from a private network to the public Internet. Treat every deployment as security-sensitive and keep the control center, gateway, FRPS, Caddy, and every managed client on supported versions.

## Supported versions

Security fixes are provided for the latest published minor release only.
Release candidates are intended for validation and are not supported production
versions. Older builds should be upgraded before reporting a problem.

| Version | Supported |
| --- | --- |
| 3.2.x | Yes |
| 3.2.0 RC builds | Prerelease testing only |
| Earlier versions | No |

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities, leaked credentials or bypasses. Use GitHub's [private vulnerability reporting form](https://github.com/ZHanry/home-tunnel/security/advisories/new). Include the affected version, deployment topology, reproduction steps and expected impact. Remove passwords, tokens, private keys, user data and public server addresses that are not necessary to reproduce the issue.

Repository owners must keep Private vulnerability reporting enabled. If the form is unavailable, do not publish the details; contact a maintainer privately through their verified GitHub profile and ask for a private reporting channel.

The maintainers will acknowledge a complete report as soon as practical, validate the impact, prepare a fix and coordinate disclosure. There is currently no paid bug-bounty program.

## Deployment responsibilities

- Replace every value marked `CHANGE_ME` before starting a public deployment.
- Never commit `.env`, `secrets/`, signing keys, deployment handoff files or administrator credentials.
- Use a unique administrator password and rotate any credential that may have entered Git history or a shared artifact.
- Restrict TCP port 7000 to the clients that need it where practical, and keep ports 80/443 behind a maintained Caddy instance.
- Keep general TCP and fixed-port UDP tunnels disabled unless they are needed.
  When enabling them, publish only a narrow range, let administrators assign
  exact ports, and restrict the same protocol/port pairs in the host or cloud
  firewall.
- Treat raw TCP/UDP as direct public exposure. These transports bypass Caddy
  and the Traffic Gateway, so gateway Basic Auth, IP allowlists, rate limits,
  traffic metering, and monthly quotas do not protect them. Require the local
  application to authenticate users and encrypt sensitive traffic.
- Restrict UDP by source and rate wherever possible, and do not expose a UDP
  service until its reflection/amplification behavior has been assessed.
- Do not attempt to use Home Tunnel for raw IP, ICMP, broadcast, multicast,
  STCP, XTCP, SUDP, visitor configurations, or arbitrary FRP plugins; those
  surfaces are intentionally rejected by the managed Agent.
- Treat the current Windows EXE as self-signed Experimental software. Verify its
  Release SHA-256 and Sigstore evidence; the ephemeral Authenticode certificate
  is not a substitute for publisher trust.
- Treat the Android 8.0+ `arm64-v8a` APK as Experimental software. Verify its
  Release SHA-256, Sigstore evidence, application ID
  `io.github.zhanry.hometunnel`, and persistent signing-certificate SHA-256.
  Never install a build signed by an unexpected certificate. The AAB is not
  directly installable and is not a statement of Google Play readiness.
- Android foreground-service notifications, battery optimization, and OEM
  background limits can interrupt long-running tunnels. Keep the notification
  enabled, review device-specific restrictions, and do not treat Experimental
  background operation as an availability guarantee.
- Review logs before sharing them; Home Tunnel attempts to redact secrets, but diagnostics can still reveal hostnames and network topology.

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for trust boundaries and operational assumptions.
