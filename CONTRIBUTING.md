# Contributing to Home Tunnel

Thanks for helping improve Home Tunnel. Small, focused changes with tests and a clear security impact are easiest to review.

## Development setup

Requirements:

- Node.js 24.19.0 LTS and pnpm 11
- .NET 10 LTS SDK on Windows for the desktop client
- Docker with Compose for integration and container checks
- Go 1.26.6 for the Linux client; `windres` is additionally required when rebuilding the managed Windows Agent

Install and verify the TypeScript services:

```powershell
Set-Location control-center
pnpm install --frozen-lockfile
pnpm run check
pnpm run lint
pnpm run format:check
pnpm run build
pnpm test
pnpm run test:coverage
pnpm run test:public

Set-Location ..\traffic-gateway
pnpm install --frozen-lockfile
pnpm run check
pnpm run lint
pnpm run format:check
pnpm run build
pnpm test
pnpm run test:coverage
```

Verify the Windows client logic on Windows:

```powershell
dotnet format .\windows-client-tests\HomeTunnel.Client.Tests.csproj --verify-no-changes --no-restore
dotnet test .\windows-client-tests\HomeTunnel.Client.Tests.csproj -c Release
```

Verify the headless Linux client:

```sh
cd linux-client
gofmt -w .
go vet ./...
go test -race ./...
staticcheck ./...
govulncheck ./...
go build ./cmd/home-tunnel-client
```

## Pull requests

1. Create a branch from `main` and keep the change scoped to one concern.
2. Do not commit generated output, downloaded toolchains, executables, credentials or production-only configuration.
3. Add or update tests for behavior changes.
4. Run the relevant checks locally and describe the results in the pull request.
5. Update `CHANGELOG.md` when a user-visible behavior or compatibility boundary changes.

Changes to authentication, lease validation, FRPS authorization, update trust, Caddy routing or secret handling require an explicit security rationale in the pull request.

By submitting a contribution, you agree that it is licensed under the Apache License 2.0 used by this repository.
