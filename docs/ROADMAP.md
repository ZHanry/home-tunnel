# Roadmap

HomeDesk 11 is a release candidate. It adopts the shared Rust/Flutter remote
engine and Hearth UI, retains the independent Go/FRP tunneling stack, and requires
authenticated, encrypted P2P for every successful built-in remote session.
Failed direct connections terminate without a relay fallback. The server adds
hbbs rendezvous to the existing control plane, FRPS and traffic gateway.

Stable promotion requires acceptance on the exact published artifacts: two
separate computers across real NAT/CGNAT and blocked-UDP networks, Android
controlling Windows and physical arm64 phones, file/clipboard/audio behavior,
multi-monitor/DPI and privilege boundaries, installer upgrades and recovery,
repeated connections and 2-hour/24-hour soaks. Record actual network paths and
failure conditions. IPv6 and Linux/macOS desktop GUI are not part of this
candidate's claimed coverage; the cross-platform CLI/Agent remains available.
Server release smoke checks cover HTTP/TCP/UDP forwarding, while real NAS and
third-party application recipes require separate runtime acceptance. Measure
server resource use with the complete tunneling stack enabled. No dates or
unmeasured success-rate/capacity promises are attached to these gates.

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
