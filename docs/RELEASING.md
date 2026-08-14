# Release process

Release artifacts are built once from a protected RC tag and uploaded by `.github/workflows/release-images.yml`; they are never committed to the source tree. The workflow accepts stable `vX.Y.Z` and release-candidate `vX.Y.Z-rc.N` tags only, requires the tagged commit to already be on `main`, and rejects version drift. RC tags are the only build path: they create signed/attested multi-architecture images, four client packages, a machine-readable image-digest manifest, and release-smoke evidence without moving `latest`. A stable tag must resolve to the same commit as an already published matching RC. It downloads and verifies that prerelease, then promotes the exact signed image digests and identical assets without rebuilding. Manual dispatch cannot publish or promote a release.

> **Status (2026-08-13):** local release validation is complete, but no tag, RC/Stable Release, registry promotion, `latest` change, or Windows binary has been published by this audit. Those operations require repository-owner confirmation and remote evidence.

## Version update

Use one semantic version across:

- `control-center/package.json`
- `traffic-gateway/package.json`
- `control-center/src/version.ts`
- `windows-client/HomeTunnel.Client.csproj`
- `linux-client/internal/model/model.go`
- `linux-client/packaging/build-release.sh`
- installer packaging metadata

The embedded Windows Agent has its own version. Its build-script version, resource version and client-reported version must agree with each other, but they change only when the Agent source or embedded FRP changes. When they change, rebuild the Agent in the pinned toolchain and update the client's expected Agent SHA-256 in the same review; never bump Agent resources without regenerating and verifying that binary.

Update `CHANGELOG.md` and verify that dependency pins and third-party notices still match the embedded FRP version.

## Required checks

```powershell
Set-Location control-center
pnpm install --frozen-lockfile
pnpm run check
pnpm run lint
pnpm run format:check
pnpm run build
pnpm test
pnpm run test:coverage
pnpm run test:coverage:realtime
pnpm run test:public
pnpm run test:integration

Set-Location ..\traffic-gateway
pnpm install --frozen-lockfile
pnpm run check
pnpm run lint
pnpm run format:check
pnpm run build
pnpm test
pnpm run test:coverage

Set-Location ..
dotnet test .\windows-client-tests\HomeTunnel.Client.Tests.csproj -c Release
docker compose config --quiet
```

On Linux with Go 1.26.6, Staticcheck 2026.1, and govulncheck 1.6.0:

```sh
cd linux-client
test -z "$(gofmt -l .)"
go test -race ./...
go vet ./...
staticcheck ./...
govulncheck ./...
go build ./cmd/home-tunnel-client
cd ..
ARCH=amd64 ./linux-client/packaging/build-release.sh
ARCH=arm64 ./linux-client/packaging/build-release.sh
```

Windows binary distribution is currently suspended. Do not build or upload a Windows installer or `latest.json` for current releases. It may resume only after a trusted Authenticode certificate, protected signing environment, and clean Windows 10/11 install/upgrade VM matrix are available.

## GitHub release

1. Confirm the protected `main` commit passed `Quality Gate` and all CodeQL jobs, then tag that exact commit as `vMAJOR.MINOR.PATCH-rc.N`. After owner acceptance, create `vMAJOR.MINOR.PATCH` on that same commit. The RC tag, Stable tag, and published RC Release target must resolve to one SHA.
2. The RC workflow stages a draft only after the complete artifact matrix and release smoke succeed, then publishes it as a prerelease without touching `latest`. The Stable workflow downloads that published RC, verifies aggregate and digest-manifest Sigstore bundles, checks all assets/evidence, stages the identical set, promotes the signed image digests to the stable version and `latest`, and publishes the Stable Release. It never invokes a build action. A promotion or publication failure restores the prior `latest` pointers.
3. Every release contains Linux `amd64`/`arm64` Stable packages and macOS `amd64`/`arm64` headless Beta packages. Each package has a checksum, SPDX JSON SBOM, keyless Sigstore bundle and GitHub artifact attestation. `SHA256SUMS.txt` and `image-digests.json` are separately signed and attested. Images carry BuildKit provenance/SBOM attestations, a GitHub attestation, and a keyless Cosign signature over their immutable digest. Release smoke covers authenticated bootstrap/admin/user APIs, HTTP and HTTPS backends, SSE, WebSocket, unknown-host denial, live policy revocation, component health, migration `007`, non-root UIDs, and encrypted backup/restore verification. A missing platform or evidence file fails the release.
4. Never upload `.env`, secret files, administrator handoff files, private certificates or deployment audit material containing infrastructure details.
5. RC releases are always GitHub prereleases and never move image `latest`; only complete stable promotions may become latest. Keep `.env.example` on the accepted RC version until the matching Stable promotion completes, because it records the exact artifact set being promoted rather than requesting another build.
6. Scan source history and unpacked artifacts for personal email addresses, real deployment domains/IPs, absolute user paths and credentials. The generic client must prompt for a server address rather than embedding an operator endpoint.

Stable promotion additionally requires both application repositories to already have a readable `latest` digest. This makes rollback deterministic if publication fails. For a brand-new registry, bootstrap and verify the initial `latest` pointers through the documented owner-only security-hotfix procedure before using the stable workflow; the workflow refuses to create an unrollable first pointer.

The pinned FRPS `0.62.1` image is an independently reviewed dependency artifact. A Home Tunnel application release must not rebuild or overwrite that tag; rebuild it only through a dedicated dependency-upgrade review that records its source commit and resulting digest.

Server/offline deployment archives contain only the Linux server images, deployment scripts, SBOMs and optional release metadata. Do not copy Windows installers or Linux client archives into a server archive or server download directory; public clients download them from GitHub Releases.
