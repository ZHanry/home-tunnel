# FRP 0.70.1 compatibility and promotion record

Status: **approved for the supported release scope**. Production is pinned to
the reviewed `0.70.1-r1` FRPS image. Official Windows binary distribution
remains suspended and is not part of this promotion.

Review completed: 2026-08-14

| Input | Reviewed identity |
| --- | --- |
| FRP release | `v0.70.1` (2026-07-23) |
| Upstream commit | `fa3bcca2b0c4753cd4f0e2ab189dd6a5a6a15708` |
| GitHub API source archive SHA-256 | `9c6b0188a8f74e982069dc89218cc3d79bada8663cedf3b514b98847530cbf7d` |
| FRPS image tag | `ghcr.io/zhanry/home-tunnel-frps:0.70.1-r1` |
| FRPS multi-architecture digest | `sha256:cffde7b39698a5faba3828bb4a78b444d2d9c2cfea7385e28989728f5d73732f` |
| Protected FRPS workflow revision | `9b512cbc71b553a14e96cf02817a99d5e869c9a4` |
| Protected FRPS workflow | [run 31762807301](https://github.com/ZHanry/home-tunnel/actions/runs/31762807301) |

## Decision

FRP 0.70.1 is promoted atomically across the restricted Agent, FRPS,
Dockerfiles, Compose defaults, Linux/macOS packaging, CodeQL source analysis,
offline deployment inputs and third-party notices. The application deployment
pins the independently built FRPS image by both its revision tag and immutable
multi-architecture digest. The protected dependency workflow built it with Go
1.26.6, verified the upstream source identity, ran `go vet` and
`govulncheck`, required `linux/amd64` and `linux/arm64`, and published SBOM,
provenance, GitHub attestation and keyless Cosign evidence.

The restricted Agent is independently versioned `2.5.0`. Its source build is
reproduced from the same pinned FRP tree, and release automation publishes a
signed provenance record and GitHub attestation for that build. It deliberately
does not publish the Windows executable, EXE installer, MSIX package or Windows
`latest.json`.

The absence of clean Windows 10 and Windows 11 install/upgrade VM evidence does
not expand the supported release scope: Windows x64 remains Source /
Experimental. Official Windows binaries may resume only after trusted
Authenticode signing, a protected signing environment, and that VM matrix all
pass. A local Windows 11 host build and MSIX-signature check is diagnostic
evidence only and must not be described as the missing clean-VM gate.

## Compatibility evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Official tag and source identity | Pass | The tag resolves to `fa3bcca2…`; the downloaded API archive matches the recorded SHA-256. |
| Restricted Agent API adaptation | Pass | Agent 2.5.0 uses the 0.70.1 configuration-source, aggregation, validation and unsafe-feature policy APIs. |
| Managed whitelist tests | Pass | HTTP/TCP allowlists, visitor/plugin/common-field rejection, render shapes and CA checks pass. |
| Agent static and vulnerability checks | Pass | Go formatting, tests, `go vet` and `govulncheck` 1.6.0 report no reachable vulnerability. |
| Managed CA pinning | Pass | The expected certificate is accepted and an incorrect SHA-256 is rejected. |
| FRPS TLS and authorization plugin | Pass | Forced TLS and `Login`, `NewProxy` and `CloseProxy` authorization flows complete. |
| HTTP and authorized TCP tunnels | Pass | Host-routed HTTP and byte-for-byte TCP echo tests complete; an unassigned TCP port is rejected. |
| FRPS dependency supply chain | Pass | Protected run 31762807301 produced the signed, attested `amd64`/`arm64` digest recorded above. |
| Windows 10/11 clean install and upgrade VMs | Not run | Hyper-V management and Windows Sandbox are unavailable in the validation host session. Windows binary distribution remains suspended. |

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
- [x] Build, audit, sign and attest the protected `0.70.1-r1` FRPS dependency.
- [x] Pin the exact dependency manifest and immutable multi-architecture digest.
- [x] Make the Windows Agent resource build reproducible with
      `SOURCE_DATE_EPOCH=0` and keep its expected SHA-256 fail-closed.
- [x] Confirm the protected repository CI reproduces the committed Agent
      SHA-256; if the protected toolchain differs, commit that protected hash
      without weakening the comparison.
- [x] Pass the complete repository and release smoke matrices on the promoted
      commit.
- [ ] Pass clean Windows 10/11 install and upgrade VMs before restoring any
      official Windows binary distribution.
- [ ] Publish the RC only after package/image SBOM, provenance, checksum,
      signature and attestation gates succeed.

The original isolated API patch remains in
`docs/frp-0.70.1-agent-candidate.patch` for review provenance. The source tree,
not that historical patch file, is authoritative after promotion.
