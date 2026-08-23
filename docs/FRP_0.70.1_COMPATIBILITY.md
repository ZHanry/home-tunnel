# FRP 0.70.1 compatibility and promotion record

Status: **approved for the supported release scope**. Production is pinned to
the reviewed `0.70.1-r2` FRPS image. The Windows EXE is distributed only as a
self-signed Experimental asset; it is not a trusted-publisher build.

Review completed: 2026-08-21

Managed TCP/UDP extension review: 2026-08-21

| Input | Reviewed identity |
| --- | --- |
| FRP release | `v0.70.1` (2026-07-23) |
| Upstream commit | `fa3bcca2b0c4753cd4f0e2ab189dd6a5a6a15708` |
| GitHub API source archive SHA-256 | `9c6b0188a8f74e982069dc89218cc3d79bada8663cedf3b514b98847530cbf7d` |
| FRPS image tag | `ghcr.io/zhanry/home-tunnel-frps:0.70.1-r2` |
| FRPS multi-architecture digest | `sha256:0ca230caa4c3c71932efd9bd5b9024a6fdc289886b97a1db827eaf3f8b6de759` |
| Protected FRPS workflow revision | `9e39c2b1aaa567c5ca3fda18f76b12dc2f77f52e` |
| Protected FRPS workflow | [run 32460680110](https://github.com/ZHanry/home-tunnel/actions/runs/32460680110) |

## Decision

FRP 0.70.1 is promoted atomically across the restricted Agent, FRPS,
Dockerfiles, Compose defaults, Linux/macOS packaging, CodeQL source analysis,
offline deployment inputs and third-party notices. The application deployment
pins the independently built FRPS image by both its revision tag and immutable
multi-architecture digest. The protected dependency workflow built it with Go
1.26.6, verified the upstream source identity, ran `go vet` and
`govulncheck`, required `linux/amd64` and `linux/arm64`, and published SBOM,
provenance, GitHub attestation and keyless Cosign evidence.

The restricted Agent is independently versioned `3.2.0`. Its source build is
reproduced from the same pinned FRP tree. Release automation bundles it into
the Experimental Windows EXE and publishes checksums, an SPDX SBOM, signed
provenance, and GitHub attestations. No MSIX package is published.

The absence of a trusted Authenticode certificate and clean Windows 10 and
Windows 11 upgrade VM evidence means Windows x64 remains Experimental. The
GitHub-hosted runner verifies build, Defender scan, silent install, embedded
Agent identity, signature consistency, and uninstall. Those checks do not
create trusted publisher identity or promote Windows to Stable.

## Compatibility evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Official tag and source identity | Pass | The tag resolves to `fa3bcca2…`; the downloaded API archive matches the recorded SHA-256. |
| Restricted Agent API adaptation | Pass | Agent 3.2.0 uses the 0.70.1 configuration-source, aggregation, validation and unsafe-feature policy APIs. |
| Managed whitelist tests | Pass | HTTP plus protocol-specific TCP/UDP allowlists, cross-protocol denial, visitor/plugin/common-field rejection, render shapes, and CA checks pass. |
| Agent static and vulnerability checks | Pass | Go formatting, tests, `go vet` and `govulncheck` 1.6.0 report no reachable vulnerability. |
| Managed CA pinning | Pass | The expected certificate is accepted and an incorrect SHA-256 is rejected. |
| FRPS TLS and authorization plugin | Pass | Forced TLS and `Login`, `NewProxy`, `CloseProxy`, and `Ping` authorization flows complete; Ping rechecks lease and subject state. |
| Managed L4 release smoke | Reproducible gate added | `tests/run-release-smoke.sh` drives the issued configuration through the managed Agent and verifies a 128 KiB+ binary TCP echo, a 1 KiB+ UDP datagram echo, RTSP-over-TCP `OPTIONS`/`SETUP`/`PLAY` with channel-0 interleaved media, raw disable while HTTPS remains available, and actual FRPS Ping revocation denying complete RTSP traffic within the heartbeat window. Static/helper checks pass locally; the complete Docker path runs with the RC images and package. |
| L4 Compose exposure | Pass | `tests/run-compose-smoke.ps1` applies `deploy/compose.l4.yaml`, checks migration `008`, the generated FRPS allow-port range, and both TCP and UDP host bindings. |
| FRPS dependency supply chain | Pass | Protected run 32460680110 produced and verified the signed, attested `amd64`/`arm64` digest recorded above. |
| Windows EXE build/install/uninstall | Pass in release workflow | GitHub-hosted Windows runner verifies the self-signed package; trusted certificate and clean OS upgrade coverage remain future gates. |

## Required source adaptations

FRP 0.70.1 is not a pin-only upgrade:

1. `client.ServiceOptions` no longer accepts `ProxyCfgs`/`VisitorCfgs`. The
   restricted Agent creates a `source.ConfigSource`, populates it with the
   already-validated proxies, wraps it in `source.Aggregator`, and passes an
   empty `security.UnsafeFeatures` set.
2. `ProxyConfigurer.Complete` no longer accepts a user argument. User prefixes
   are applied at the wire layer; the local whitelist compares unprefixed names
   while the FRPS plugin still sees the prefixed wire name.
3. `validation.ValidateAllClientConfig` requires an unsafe-feature policy.
   Home Tunnel passes `security.NewUnsafeFeatures(nil)`.
4. A fresh FRP checkout lacks built dashboard assets. FRPS is built with
   `-tags noweb`; Home Tunnel does not expose the FRPS dashboard.

## Promotion checklist

- [x] Apply the reviewed Agent API adaptation and `-tags noweb` FRPS build.
- [x] Update every active FRP pin, build input and third-party notice atomically.
- [x] Build, audit, test the baked L4/Ping entrypoint, sign, and attest the protected `0.70.1-r2` FRPS dependency.
- [x] Pin the exact dependency manifest and immutable multi-architecture digest.
- [x] Make the Windows Agent resource build reproducible with
      `SOURCE_DATE_EPOCH=0` and keep its expected SHA-256 fail-closed.
- [x] Confirm the protected repository CI reproduces the committed Agent
      SHA-256; if the protected toolchain differs, commit that protected hash
      without weakening the comparison.
- [x] Pass the complete repository and release smoke matrices on the promoted
      commit.
- [ ] Add a trusted Authenticode certificate and clean Windows 10/11 upgrade VM
      matrix before promoting Windows from Experimental to Stable.
- [ ] Publish the RC only after package/image SBOM, provenance, checksum,
      signature and attestation gates succeed.

The reviewed source tree and the immutable dependency record above are
authoritative after promotion.

## Managed L4 scope

The 2026-08-21 application extension keeps the reviewed FRP dependency and
restricts its additional surface to general TCP and fixed-port UDP proxies.
Both transports are disabled by default. The control center assigns an exact
protocol/port pair, clients declare `supported_proxy_types`, and the Agent
requires the same port to appear in the separate `--allow-tcp-ports` or
`--allow-udp-ports` trust argument. A legacy client that omits the capability
field receives UDP as `enabled=false`. Updated clients request one full sync on
their first post-upgrade start, replacing any cached compatibility-disabled UDP
record before persisting the new sync-capability marker.

RTSP is covered only as an application carried by general TCP, for example
public `10554` to local `554` with
`ffplay -rtsp_transport tcp rtsp://PUBLIC_HOST:10554/path`. Native RTP/RTCP over
UDP requires fixed media ports and one mapping per port; dynamic media ports
are not guaranteed. Raw IP, ICMP, broadcast, multicast, STCP, XTCP, SUDP,
visitors, and arbitrary plugins remain outside the managed whitelist.

The managed L4 gate is reproducible with release artifacts:

```sh
CONTROL_IMAGE=<digest> \
GATEWAY_IMAGE=<digest> \
FRPS_IMAGE=<digest> \
RC_VERSION=X.Y.Z-rc.N \
tests/run-release-smoke.sh
```

It explicitly syncs `supported_proxy_types: [http, tcp, udp]`, renders all
three proxy types, and starts the Agent with separate TCP ports `11000,11002`
and UDP port `11001`. Local validation covered Python compilation, shell
syntax, Compose rendering with placeholder digests, direct TCP/UDP/RTSP helper
round trips, and denial helpers. A complete local Docker run still requires
real immutable RC image digests and the matching Linux client package.
