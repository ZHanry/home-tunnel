# D5 awesome-tunneling submission draft

## Owner review gate

Do not open a third-party pull request until the owner has reviewed the live target repository, its contribution rules, category, ordering, branch, diff, title, and body. If the list does not accept projects at Home Tunnel's maturity or support level, do not submit.

## Proposed list entry

Use the target list's existing punctuation and ordering. The proposed content is:

> [Home Tunnel](https://zhanry.github.io/home-tunnel/en/?utm_source=awesome_tunneling&utm_medium=listing&utm_campaign=launch_2026_08) - Self-hosted tunnels for personal and family services with an auditable control plane, capability-restricted managed FRP agents, access policies, rate limiting, traffic accounting, short-lived leases, and immediate revocation. Linux server/client Stable; macOS headless Beta; Windows source-only/Experimental. Apache-2.0.

## Pull request title

Add Home Tunnel

## Pull request body

### Summary

This adds Home Tunnel, an Apache-2.0 self-hosted tunneling platform for personal and family services.

Home Tunnel separates its control plane from application traffic and uses a capability-restricted managed Agent rather than exposing arbitrary FRP configuration. Its current public support matrix is Linux server/client Stable, macOS headless Beta, and Windows x64 source-only/Experimental. It does not offer a public dynamic demo or an official Windows binary.

### Project evidence

- Project: <https://zhanry.github.io/home-tunnel/en/?utm_source=awesome_tunneling&utm_medium=listing&utm_campaign=launch_2026_08>
- Source: <https://github.com/ZHanry/home-tunnel?utm_source=awesome_tunneling&utm_medium=listing&utm_campaign=launch_2026_08>
- License: Apache-2.0
- Security model: <https://github.com/ZHanry/home-tunnel/blob/main/docs/SECURITY_MODEL.md?utm_source=awesome_tunneling&utm_medium=listing&utm_campaign=launch_2026_08>

Production remains pinned to FRP 0.62.1. FRP 0.70.1 is a validated but blocked compatibility candidate and is not represented as the production version.

### Checklist

- [ ] I re-read the target repository's current contribution rules.
- [ ] I placed the entry in the required category and order.
- [ ] I verified every claim against the live README, support matrix, and Release.
- [ ] I ran the target repository's required formatting and link checks.
- [ ] The Home Tunnel owner approved this exact diff and PR message immediately before submission.
