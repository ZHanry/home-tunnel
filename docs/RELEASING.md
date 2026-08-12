# Release process

Release artifacts are generated locally or by a protected release workflow and uploaded to GitHub Releases. They are never committed to the source tree.

## Version update

Use one semantic version across:

- `control-center/package.json`
- `traffic-gateway/package.json`
- `control-center/src/version.ts`
- `windows-client/HomeTunnel.Client.csproj`
- `linux-client/internal/model/model.go`
- `linux-client/packaging/build-release.sh`
- Windows Agent build/version resources
- installer packaging metadata

Update `CHANGELOG.md` and verify that dependency pins and third-party notices still match the embedded FRP version.

## Required checks

```powershell
Set-Location control-center
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm test
pnpm run test:public
pnpm run test:integration

Set-Location ..\traffic-gateway
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm test

Set-Location ..
dotnet run --project .\windows-client-tests\HomeTunnel.Client.Tests.csproj -c Release
docker compose config --quiet
```

On Linux with Go 1.23.12:

```sh
cd linux-client
go test ./...
go build ./cmd/home-tunnel-client
cd ..
ARCH=amd64 ./linux-client/packaging/build-release.sh
ARCH=arm64 ./linux-client/packaging/build-release.sh
```

Build the Windows installer with the intended deployment profile, a stable App ID and a trusted production signing certificate. Verify Authenticode, SHA-256, install, launch, update, repair and uninstall behavior on a clean Windows machine.

## GitHub release

1. Tag the reviewed commit as `vMAJOR.MINOR.PATCH`.
2. Create a GitHub Release using `.github/release.yml`.
3. Upload every client artifact that was actually built and verified for the release. A full cross-platform release contains the versioned Windows installer, Linux `amd64`/`arm64` archives and checksums, `latest.json`, `SHA256SUMS.txt`, signature information and relevant SBOM files. If a platform cannot be built and verified, omit its stale artifacts and call out that limitation in the release notes.
   The `latest.json` `download_url` must be the matching versioned asset under `https://github.com/ZHanry/home-tunnel/releases/download/`; clients fetch the manifest through `releases/latest/download/latest.json`.
4. Never upload `.env`, secret files, administrator handoff files, private certificates or deployment audit material containing infrastructure details.
5. Mark pre-release builds clearly and do not point stable update metadata at them.
6. Scan source history and unpacked artifacts for personal email addresses, real deployment domains/IPs, absolute user paths and credentials. The generic client must prompt for a server address rather than embedding an operator endpoint.

Server/offline deployment archives contain only the Linux server images, deployment scripts, SBOMs and optional release metadata. Do not copy Windows installers or Linux client archives into a server archive or server download directory; public clients download them from GitHub Releases.
