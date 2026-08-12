#!/usr/bin/env bash
set -Eeuo pipefail

# Builds the macOS (darwin) release archive of the headless client. Mirrors
# ../build-release.sh: it cross-compiles both the client and the managed
# Agent (from the pinned FRP source plus windows-agent/main.go) for darwin,
# so it runs on any build host with Go; only the optional version self-check
# requires a matching macOS host.

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
client_dir=$(cd -- "$script_dir/../.." && pwd)
workspace_dir=$(cd -- "$client_dir/.." && pwd)
source_version=$(sed -n 's/^const Version = "\([^"]*\)"$/\1/p' "$client_dir/internal/model/model.go")
[[ -n "$source_version" ]] || { echo "unable to read Version from internal/model/model.go" >&2; exit 1; }
# The default comes straight from the source of truth so this script adds no
# hard-coded version that could drift; VERSION stays available as an override
# for release pipelines, which the check below validates.
version=${VERSION:-$source_version}
[[ "$source_version" == "$version" ]] || { echo "client source version $source_version does not match release version $version" >&2; exit 1; }
architecture=${ARCH:-$(go env GOARCH)}
case "$architecture" in
  amd64|arm64) ;;
  *) echo "ARCH must be amd64 or arm64" >&2; exit 2 ;;
esac
for command in go curl sed tar; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done
if ! command -v sha256sum >/dev/null && ! command -v shasum >/dev/null; then
  echo "sha256sum or shasum is required" >&2
  exit 1
fi
if ! command -v unzip >/dev/null && ! command -v python3 >/dev/null; then
  echo "unzip or python3 is required to extract the pinned FRP source" >&2
  exit 1
fi

# hash_file prints the SHA-256 of a file with whichever tool the host has
# (sha256sum on Linux, shasum on macOS).
hash_file() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

downloads_dir="$workspace_dir/.downloads"
output_dir="$workspace_dir/outputs/macos"
frp_version=0.62.1
frp_commit=b41d8f8e4074c4f633fb67d7d31b97db59472674
frp_archive="$downloads_dir/frp-$frp_commit.zip"
frp_archive_sha256=57f101128055899614535e608dd8aae46c3b779a9095c6050556da91fede0bda
frp_extract_root="$downloads_dir/frp-api-$frp_commit"
archive="$output_dir/home-tunnel-macos-$version-$architecture.tar.gz"
checksum_file="$output_dir/home-tunnel-macos-$version-$architecture.sha256"
[[ ! -e "$archive" && ! -e "$checksum_file" ]] || { echo "release output already exists: $archive" >&2; exit 1; }

mkdir -p "$downloads_dir" "$output_dir"
if [[ ! -f "$frp_archive" ]]; then
  curl --fail --location --proto '=https' --tlsv1.2 \
    --header 'Accept: application/vnd.github+json' \
    --header 'User-Agent: HomeTunnelBuild' \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    "https://api.github.com/repos/fatedier/frp/zipball/$frp_commit" --output "$frp_archive"
fi
actual_archive_hash=$(hash_file "$frp_archive")
[[ "$actual_archive_hash" == "$frp_archive_sha256" ]] || { echo "pinned FRP source checksum mismatch: $actual_archive_hash" >&2; exit 1; }
if [[ ! -d "$frp_extract_root" ]]; then
  mkdir -p "$frp_extract_root"
  if command -v unzip >/dev/null; then
    unzip -q "$frp_archive" -d "$frp_extract_root"
  else
    python3 -m zipfile -e "$frp_archive" "$frp_extract_root"
  fi
fi
frp_source=$(find "$frp_extract_root" -mindepth 1 -maxdepth 1 -type d -name "fatedier-frp-${frp_commit:0:7}*" -print -quit)
[[ -n "$frp_source" && -f "$frp_source/go.mod" ]] || { echo "pinned FRP source tree not found" >&2; exit 1; }

temporary_command="$frp_source/cmd/home-tunnel-agent-macos-build"
[[ ! -e "$temporary_command" ]] || { echo "fixed Agent build directory is already in use: $temporary_command" >&2; exit 1; }
mkdir "$temporary_command"
stage=$(mktemp -d "$output_dir/.stage.XXXXXX")
cleanup() {
  rm -rf -- "$temporary_command" "$stage"
}
trap cleanup EXIT INT TERM
cp "$workspace_dir/windows-agent/main.go" "$temporary_command/main.go"

package_dir="$stage/home-tunnel-macos-$version-$architecture"
mkdir -p "$package_dir/bin" "$package_dir/lib" "$package_dir/Library/LaunchDaemons" "$package_dir/libexec"
agent_output="$package_dir/lib/home-tunnel-agent"
(
  cd "$frp_source"
  CGO_ENABLED=0 GOOS=darwin GOARCH="$architecture" GOFLAGS=-buildvcs=false \
    go build -trimpath \
    -ldflags "-s -w -buildid= -X main.agentVersion=$version -X main.frpVersion=$frp_version -X main.frpCommit=$frp_commit" \
    -o "$agent_output" "./cmd/$(basename "$temporary_command")"
)
agent_hash=$(hash_file "$agent_output")
(
  cd "$client_dir"
  CGO_ENABLED=0 GOOS=darwin GOARCH="$architecture" GOFLAGS=-buildvcs=false \
    go build -trimpath \
    -ldflags "-s -w -buildid= -X main.version=$version -X main.agentVersion=$version -X main.expectedAgentSHA256=$agent_hash" \
    -o "$package_dir/bin/home-tunnel-client" ./cmd/home-tunnel-client
)
cp "$script_dir/com.hometunnel.client.plist" "$package_dir/Library/LaunchDaemons/"
cp "$script_dir/home-tunnel-enroll" "$package_dir/libexec/"
cp "$script_dir/install.sh" "$package_dir/install.sh"
cp "$client_dir/README.md" "$package_dir/README.md"
chmod 0755 "$package_dir/bin/home-tunnel-client" "$package_dir/lib/home-tunnel-agent" "$package_dir/libexec/home-tunnel-enroll" "$package_dir/install.sh"

# The self-check can only execute the darwin binaries when this script itself
# runs on macOS with the same architecture; cross-builds skip it.
if [[ "$(go env GOOS)" == "darwin" && "$architecture" == "$(go env GOARCH)" ]]; then
  client_version_output=$("$package_dir/bin/home-tunnel-client" version)
  agent_version_output=$("$package_dir/lib/home-tunnel-agent" version)
  [[ "$client_version_output" == "Home Tunnel macOS Client $version (Agent $version)" ]] || { echo "client version self-check failed: $client_version_output" >&2; exit 1; }
  [[ "$agent_version_output" == "Home Tunnel Agent $version (FRP $frp_version, $frp_commit)" ]] || { echo "Agent version self-check failed: $agent_version_output" >&2; exit 1; }
fi
tar -C "$stage" -czf "$archive" "$(basename "$package_dir")"
archive_hash=$(hash_file "$archive")
printf '%s  %s\n' "$archive_hash" "$(basename "$archive")" >"$checksum_file"
echo "CLIENT=$archive"
echo "CLIENT_SHA256=$archive_hash"
echo "AGENT_SHA256=$agent_hash"
