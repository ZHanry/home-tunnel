# Roadmap

10.0.0 shipped on 2026-09-29 with incomplete verification. The unverified gates
are the first follow-up: host-to-viewer files, fixed password on final bytes,
Android controlling Windows, physical arm64 phones, multi-monitor/DPI,
9-to-10 installer upgrade and
restore, the 30-repeat/2-hour/24-hour soaks, the NAT/IPv6/blocked-UDP matrix,
performance, the tunnel runtime matrix, Linux/macOS runtime and a full UI review.
Lock screen, pre-login and UAC secure-desktop control and microphone return are
not available. No date is attached to that work.

7.0.0 ships the audit fixes, unified releases, API contract, diagnostics, host-only
recovery, encrypted backup/restore, preflight/NAS recipes, enrollment codes, MFA,
credential protection, signing workflow, monitoring and management improvements.
See the component changelogs for concrete behavior and the release checks for evidence.

Next items require separate design and acceptance:

- Obtain Windows/Apple publisher identities; accept only verified signatures and
  Apple Accepted notarization before advertising signed desktop releases.
- Add physical-device and real NAS hardware coverage beyond CI emulators/build hosts.
- Measure long-running large deployments and publish hardware, workload and failure
  conditions with results; do not turn local latency samples into capacity promises.
- Evaluate accessibility, more locales and application recipes from actual feedback.

No promised release dates or invented user/traffic counts. Propose changes through
an issue with the use case, scope and an observable acceptance test.
