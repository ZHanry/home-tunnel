# Security policy

Home Tunnel exposes services from a private network to the public Internet. Treat every deployment as security-sensitive and keep the control center, gateway, FRPS, Caddy and Windows client on supported versions.

## Supported versions

Security fixes are provided for the latest published minor release only. The next security maintenance release is 2.4.1; this support entry becomes effective only when that independent patch is merged and published. The broader 2.5.0 source tree is a release candidate, not a supported stable release. Until 2.4.1 is published, deploy only a reviewed commit containing the security fix. Older builds should be upgraded before reporting a problem.

| Version | Supported |
| --- | --- |
| 2.4.x (`2.4.1` when published) | Yes |
| 2.5.0 RC builds | Prerelease testing only |
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
- Use a publicly trusted Authenticode certificate for distributed Windows installers. The development signing workflow is not a substitute for publisher trust.
- Review logs before sharing them; Home Tunnel attempts to redact secrets, but diagnostics can still reveal hostnames and network topology.

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for trust boundaries and operational assumptions.
