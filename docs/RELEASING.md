# Release process

Release artifacts are built once from a protected RC tag and uploaded by `.github/workflows/release-images.yml`; they are never committed to the source tree. The workflow accepts stable `vX.Y.Z` and release-candidate `vX.Y.Z-rc.N` tags only, requires the tagged commit to already be on `main`, and rejects version drift. RC tags are the only build path: they create signed/attested multi-architecture images, four Linux/macOS packages, one Windows x64 Experimental EXE, one Android 8.0+ `arm64-v8a` Experimental APK, one non-installable Android AAB, a machine-readable image-digest manifest, and release-smoke evidence without moving image `latest`. A stable tag must resolve to the same commit as an already published matching RC. It downloads and verifies that prerelease, then promotes the exact signed image digests and identical assets without rebuilding or re-signing. Manual dispatch cannot publish or promote a release.

> **v3.2 rule:** `v3.2.0-rc.2` is the accepted build path. `v3.2.0`
> must reuse its exact commit, image digests, and complete asset set.

## Version update

Use one semantic version across:

- `control-center/package.json`
- `traffic-gateway/package.json`
- `control-center/src/version.ts`
- `windows-client/HomeTunnel.Client.csproj`
- `linux-client/internal/model/model.go`
- `linux-client/packaging/build-release.sh`
- `android-client/gradle.properties` (`HOME_TUNNEL_VERSION_NAME` and the
  monotonic `HOME_TUNNEL_VERSION_CODE`)
- installer packaging metadata

The embedded Windows Agent follows the product version. Its build-script
version, resource version, client-reported version, and release tag base version
must agree. Rebuild it in the pinned toolchain and update the client's expected
Agent SHA-256 in the same review; never bump Agent resources without
regenerating and verifying that binary.

Update `CHANGELOG.md` and verify that dependency pins and third-party notices still match the embedded FRP version.

The Android application ID is `io.github.zhanry.hometunnel`. Its first release
uses `versionName=3.2.0` and `versionCode=3002000`, calculated as
`major*1,000,000 + minor*1,000 + patch`. The version name intentionally omits
the RC suffix because Stable promotes the exact accepted RC binary. Never reuse
a version code after an AAB has been uploaded to a store.

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

Set-Location .\android-client
$env:ANDROID_AGENT_ABIS = "arm64-v8a,x86_64"
.\scripts\build-agent.ps1
.\gradlew.bat --no-daemon test lint assembleDebug
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

The Windows x64 EXE is Experimental and uses an ephemeral self-signed
Authenticode certificate because no trusted signing secret is configured. The
release job must run Defender scanning, silent install, embedded Agent identity,
signature-consistency, and uninstall checks, then publish the EXE, update
manifest, checksum, SPDX SBOM, Sigstore bundles, and GitHub attestations. Release
notes and user-facing docs must warn that Windows will show an unknown publisher.

The Android APK/AAB are Experimental but must use one persistent release key.
The protected `android-release` environment supplies only
`ANDROID_RELEASE_KEYSTORE_BASE64`, `ANDROID_RELEASE_STORE_PASSWORD`,
`ANDROID_RELEASE_KEY_ALIAS`, and `ANDROID_RELEASE_KEY_PASSWORD`. A missing
secret, missing reviewed certificate fingerprint, unsigned artifact, debug key,
unexpected application ID/version/ABI, or signer mismatch fails the RC. The
keystore is decoded only under the runner temporary directory and must never be
cached or uploaded. Verify the APK with `apksigner`, the AAB with `bundletool`
and `jarsigner`, and compare both signer fingerprints with
`android-client/release-signing-cert.sha256`.

## GitHub release

1. Confirm the protected `main` commit passed `Quality Gate` and all CodeQL jobs, then tag that exact commit as `vMAJOR.MINOR.PATCH-rc.N`. After owner acceptance, create `vMAJOR.MINOR.PATCH` on that same commit. The RC tag, Stable tag, and published RC Release target must resolve to one SHA.
2. The RC workflow stages a draft only after the complete artifact matrix and release smoke succeed, then publishes it as a prerelease without touching `latest`. The Stable workflow downloads that published RC, verifies aggregate and digest-manifest Sigstore bundles, checks all assets/evidence, stages the identical set, promotes the signed image digests to the stable version and `latest`, and publishes the Stable Release. It never invokes a build action. A promotion or publication failure restores the prior `latest` pointers.
3. Every release contains Linux `amd64`/`arm64` Stable packages, macOS `amd64`/`arm64` headless Beta packages, the Windows x64 Experimental EXE, and the Android 8.0+ `arm64-v8a` Experimental APK plus non-installable AAB. Each package has a checksum, SPDX JSON SBOM, keyless Sigstore bundle, and GitHub artifact attestation. Android additionally publishes signed machine-readable evidence binding its application ID, version name/code, min/target SDK, ABI, APK/AAB hashes, embedded Agent hash, repository revision, and persistent certificate fingerprint. `SHA256SUMS.txt` and `image-digests.json` are separately signed and attested. Images carry BuildKit provenance/SBOM attestations, a GitHub attestation, and a keyless Cosign signature over their immutable digest. The manifest also embeds the independently signed FRPS dependency record. Release smoke covers authenticated bootstrap/admin/user APIs, HTTP and HTTPS backends, SSE, WebSocket, unknown-host denial, live policy revocation, component health, migration `008`, non-root UIDs, and encrypted backup/restore verification. Its managed L4 path additionally creates TCP `11000`, UDP `11001`, and RTSP-over-TCP `11002` connections; verifies binary TCP and UDP echoes plus RTSP interleaved media through the issued Agent configuration; disables the echo connections while HTTPS and RTSP remain available; requires TCP failure plus UDP timeout; then deletes the device and requires FRPS `Ping` authorization to deny complete RTSP application traffic within the heartbeat window. The local Compose smoke separately validates the FRPS allow-port range and both protocol bindings. A missing platform or evidence file fails the release.
4. Never upload `.env`, secret files, administrator handoff files, keystores,
   private certificates, signing passwords, or deployment audit material
   containing infrastructure details.
5. RC releases are always GitHub prereleases and never move image `latest`; only complete stable promotions may become latest. Keep `.env.example` on the accepted RC version until the matching Stable promotion completes, because it records the exact artifact set being promoted rather than requesting another build.
6. Scan source history and unpacked artifacts for personal email addresses, real deployment domains/IPs, absolute user paths and credentials. Every generic client, including Android, must prompt for a server address rather than embedding an operator endpoint. Android release notes must disclose that the APK is GitHub-sideloaded Experimental software, the AAB cannot be installed directly and is not declared Play-ready, and foreground-service/OEM battery restrictions may interrupt background tunnels.

Stable promotion additionally requires both application repositories to already have a readable `latest` digest. This makes rollback deterministic if publication fails. For a brand-new registry, bootstrap and verify the initial `latest` pointers through the documented owner-only security-hotfix procedure before using the stable workflow; the workflow refuses to create an unrollable first pointer.

The pinned FRPS `0.70.1-r2` image is an independently reviewed dependency artifact built with Go 1.26.6. A Home Tunnel application release must not rebuild or overwrite that tag; rebuild it only under a new image revision through the dedicated dependency workflow, recording the upstream source commit, archive hash, protected workflow revision and resulting digest in `deploy/frps/dependency.json`.

Server/offline deployment archives contain only the Linux server images, deployment scripts, SBOMs and optional release metadata. Do not copy Windows installers or Linux client archives into a server archive or server download directory; public clients download them from GitHub Releases.

For a release that changes transport capabilities, the release notes must tell
operators to upgrade the server/control center and every client before enabling
the new type. Verify that clients declare `supported_proxy_types`, that omitted
capabilities force UDP connections to `disabled`, and that a legacy
`TCP_TUNNEL_ENABLED` deployment does not implicitly expose UDP. Verify the
post-upgrade one-time full sync refreshes any cached compatibility-disabled UDP
record before persisting the new sync-capability marker. Document the separate
`deploy/compose.tcp.yaml`, `deploy/compose.udp.yaml`, and
`deploy/compose.l4.yaml` choices and their matching environment-variable
ranges.
