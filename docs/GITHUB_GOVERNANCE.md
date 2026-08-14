# GitHub repository governance runbook

Repository settings are part of the security boundary. Code changes alone do not enable these controls. Record an owner-visible Settings screenshot or API response after each section is complete.

> **Status (2026-08-13):** the items below are owner-only remote actions and remain unverified/incomplete in this local audit. Do not infer completion from the presence of workflow or documentation files.

## Immediate security settings

- Enable Private vulnerability reporting. It returned `enabled: false` when audited on 2026-08-13.
- Enable Dependency graph before opening the quality-gate PR; Dependency Review otherwise returns 403.
- Enable Dependabot alerts, Dependabot security updates, and grouped security updates.
- Retain Secret Scanning and Push Protection.
- After every workflow uses a full immutable commit SHA, require SHA pinning in the Actions policy.

## Main ruleset

Configure only after the checks have succeeded on `main` at least once so their exact contexts exist:

- Require pull requests.
- Require one approval, dismiss stale approvals, and require Code Owner review where applicable.
- Require every conversation to be resolved.
- Require the observed stable `Quality Gate`, each language CodeQL result, Secret Scan, and `Build and validate Pages`. The Pages deploy job is intentionally absent on pull requests and must not be required.
- Require linear history.
- Block force pushes and branch deletion.
- Add `merge_group` triggers to every required workflow before enabling merge queue.

One approval is practical only after a second trusted reviewer exists. A solo owner cannot approve their own pull request; do not normalize routine administrator bypasses.

## Tag ruleset

- Protect `v*` against update and deletion.
- Test the RC and stable workflows before enabling the rule.
- Restrict bypass to the documented emergency-security process.
- Never move an existing release tag. Rebuilds use a new version.

## Repository presentation

- Description: `面向个人与家庭服务的自托管内网穿透平台 · Self-hosted tunnels for home services`
- Homepage: `https://zhanry.github.io/home-tunnel/`
- Topics: `self-hosted`, `homelab`, `reverse-proxy`, `nat-traversal`, `tunnel`, `frp`, `ngrok-alternative`, `home-assistant`, `nas`, `docker`, `https`, `windows`, `linux`
- Disable unused Wiki and Projects.
- Upload `docs/site/assets/social-preview.jpg` as the repository social preview.
- Enable Pages through GitHub Actions and set `GOATCOUNTER_ENDPOINT` only after the owner creates the site.
- Add unsupported/old/self-signed/unknown-publisher warnings to historical Windows Release notes without deleting assets.

## Labels and milestone

Verify or create at least:

- `bug`, `triage`, `enhancement`
- `security`, `documentation`, `dependencies`, `maintenance`
- `feature`, `fix`, `ignore-for-release`
- `deployment-feedback`

Create the real `v2.5.0` milestone and focused Issues for release trust, quality gates, backend split, frontend modules, Windows xUnit/services, contracts/migrations, Pages/presentation, and the 30-day validation campaign. Issue Forms may reference a label only after it exists.

## Emergency security bypass

1. Confirm an active vulnerability or release-blocking incident privately.
2. Create the smallest patch branch from the current supported stable commit.
3. Run the complete security, compatibility, and artifact-integrity matrix.
4. Obtain review from the designated trusted reviewer whenever available.
5. If a ruleset bypass is unavoidable, record the actor, reason, advisory, affected checks, exact commit, and timestamp in the private advisory.
6. Publish a new patch version. Never rewrite or delete an existing stable tag.
7. Backfill the normal PR and post-incident review immediately after containment.
