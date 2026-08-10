# Security policy

Home Tunnel exposes services from a private network to the public Internet. Treat every deployment as security-sensitive and keep the control center, gateway, FRPS, Caddy and Windows client on supported versions.

## Supported versions

Security fixes are provided for the latest published minor release only. Older builds should be upgraded before reporting a problem.

| Version | Supported |
| --- | --- |
| 2.2.x | Yes |
| Earlier versions | No |

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities, leaked credentials or bypasses. Use GitHub's **Private vulnerability reporting** feature on the repository Security page. Include the affected version, deployment topology, reproduction steps and expected impact. Remove passwords, tokens, private keys, user data and public server addresses that are not necessary to reproduce the issue.

The maintainers will acknowledge a complete report as soon as practical, validate the impact, prepare a fix and coordinate disclosure. There is currently no paid bug-bounty program.

## Deployment responsibilities

- Replace every value marked `CHANGE_ME` before starting a public deployment.
- Never commit `.env`, `secrets/`, signing keys, deployment handoff files or administrator credentials.
- Use a unique administrator password and rotate any credential that may have entered Git history or a shared artifact.
- Restrict TCP port 7000 to the clients that need it where practical, and keep ports 80/443 behind a maintained Caddy instance.
- Use a publicly trusted Authenticode certificate for distributed Windows installers. The development signing workflow is not a substitute for publisher trust.
- Review logs before sharing them; Home Tunnel attempts to redact secrets, but diagnostics can still reveal hostnames and network topology.

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for trust boundaries and operational assumptions.
