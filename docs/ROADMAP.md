# Roadmap

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
