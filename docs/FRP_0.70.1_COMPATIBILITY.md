# FRP 0.70.1 compatibility decision

Status: **validated candidate; rollout blocked; production remains on 0.62.1**.

Review date: 2026-08-13

FRP release: `v0.70.1` (2026-07-23)

Resolved source commit: `fa3bcca2b0c4753cd4f0e2ab189dd6a5a6a15708`
GitHub API source archive SHA-256: `9c6b0188a8f74e982069dc89218cc3d79bada8663cedf3b514b98847530cbf7d`

## Decision

The compatibility surface passed, but the version pin is intentionally **not**
changed. The currently trusted Windows Agent 2.4.0 executable and
`AgentExpectedSha256` were produced from FRP 0.62.1. Switching the source pin
without rebuilding the Windows artifact in the protected release environment
would either make CI fail or weaken the binary-integrity check. Neither outcome
is acceptable.

Promote this candidate only after the protected Windows build/signing job has
produced a new Agent, its SHA-256 has been reviewed and committed, and the
Windows 10/11 install/upgrade VM matrix has passed. That rollout is separate
from publishing an official Windows installer.

## Isolated validation evidence

The validation used fresh temporary directories and local-only Docker ports;
it did not overwrite the repository Agent executable or its trusted hash.

| Gate | Result | Evidence |
| --- | --- | --- |
| Official tag and source identity | Pass | Annotated tag resolves to `fa3bcca2…`; downloaded archive hash recorded above. |
| Restricted Agent source build | Pass after API adaptation | Linux amd64 and Windows amd64 binaries built with Go 1.26.5; the native Windows candidate reported FRP 0.70.1, accepted the managed render shape and rejected a UDP mutation. |
| Managed whitelist tests | Pass | 20/20 tests: HTTP/TCP allowlists, visitor/plugin/common-field rejection, client render shapes and CA checks. |
| Linux/Windows config render shapes | Pass | HTTP direct, HTTPS `http2https`, managed CA and authorized TCP shapes accepted. |
| Managed CA pinning | Pass | Valid certificate accepted; wrong SHA-256 rejected. |
| FRPS TLS | Pass | `transport.tls.force=true` with an isolated certificate. |
| Authorization plugin | Pass | `Login`, `NewProxy` and `CloseProxy` HTTP plugin flow completed. |
| HTTP tunnel | Pass | Host-routed request returned the isolated local HTTP payload. |
| TCP tunnel | Pass | Authorized remote port completed a byte-for-byte echo round trip. |
| Unauthorized TCP port | Pass | Agent rejected a port outside the server-provided allowlist. |

## Required source adaptations

FRP 0.70.1 is not a pin-only upgrade:

1. `client.ServiceOptions` no longer accepts `ProxyCfgs`/`VisitorCfgs`. The
   restricted Agent must create a `source.ConfigSource`, populate it with the
   already-validated proxies, wrap it in `source.Aggregator`, and pass an empty
   `security.UnsafeFeatures` set.
2. `ProxyConfigurer.Complete` no longer accepts a user argument. User prefixes
   are now applied explicitly at the wire layer; the local whitelist compares
   unprefixed config names while the FRPS plugin still sees the prefixed wire
   name.
3. `validation.ValidateAllClientConfig` now requires an unsafe-feature policy.
   Home Tunnel must pass `security.NewUnsafeFeatures(nil)`.
4. A fresh FRP checkout lacks built web assets. Build FRPS with `-tags noweb`;
   otherwise Go embed fails with `web/frps/embed.go: pattern dist: no matching
   files found`. Home Tunnel does not expose the FRPS dashboard.

## Promotion checklist

- [ ] Apply the reviewed candidate Agent API patch and `-tags noweb` FRPS build change.
- [ ] Update every 0.62.1 pin atomically: Dockerfiles, Compose images, Linux and
      macOS packaging, Windows build script, CodeQL source pin and third-party notices.
- [ ] Build the Windows Agent in the protected Windows environment with pinned
      Go/windres inputs; record the new SHA-256 and signer identity.
- [ ] Update `AgentExpectedSha256` in the same change as the Agent binary.
- [ ] Re-run the full repository CI and real Compose HTTP/HTTPS/WebSocket,
      policy-revocation and TCP tunnel matrix.
- [ ] Pass Windows 10/11 source build, install and upgrade VM verification.
- [ ] Publish FRPS/Linux/macOS artifacts only after their SBOM, provenance,
      checksum and signature steps succeed.

The exact reviewed Agent API adaptation is preserved in
`docs/frp-0.70.1-agent-candidate.patch`. It deliberately excludes version pins,
the trusted executable and `AgentExpectedSha256`; apply it only as part of the
atomic promotion change described above.

## Issue draft

Title: `Promote validated FRP 0.70.1 candidate after protected Agent rebuild`

Body:

> The isolated FRP 0.70.1 compatibility matrix passed on 2026-08-13. The
> rollout remains blocked because the trusted Windows Agent 2.4.0 binary and
> `AgentExpectedSha256` are still the reviewed FRP 0.62.1 artifact. Apply the
> API adaptation documented in `docs/FRP_0.70.1_COMPATIBILITY.md`, rebuild and
> sign the Agent in the protected Windows environment, update the binary/hash
> atomically, then run the full release and Windows 10/11 VM matrices. Do not
> change production pins before those gates pass.
