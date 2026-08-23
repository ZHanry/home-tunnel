#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
client_dir=$(cd -- "$script_dir/.." && pwd)
workspace_dir=$(cd -- "$client_dir/.." && pwd)
build_root="$client_dir/.agent-build"
downloads_dir="$build_root/downloads"

go_version=1.26.6
ndk_version=27.2.12479018
frp_version=0.70.1
agent_version=3.2.0
frp_commit=fa3bcca2b0c4753cd4f0e2ab189dd6a5a6a15708
frp_archive_sha256=9c6b0188a8f74e982069dc89218cc3d79bada8663cedf3b514b98847530cbf7d
frp_archive="$downloads_dir/frp-$frp_commit.zip"
frp_extract_root="$build_root/frp-$frp_commit"

for command in go curl sha256sum; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done
actual_go_version=$(go version)
[[ "$actual_go_version" == "go version go$go_version "* ]] || {
  echo "Go $go_version is required; found: $actual_go_version" >&2
  exit 1
}

mkdir -p "$downloads_dir"
if [[ ! -f "$frp_archive" ]]; then
  curl --fail --location --proto '=https' --tlsv1.2 \
    --header 'Accept: application/vnd.github+json' \
    --header 'User-Agent: HomeTunnelAndroidBuild' \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    "https://api.github.com/repos/fatedier/frp/zipball/$frp_commit" \
    --output "$frp_archive"
fi
actual_archive_sha256=$(sha256sum "$frp_archive" | awk '{print $1}')
[[ "$actual_archive_sha256" == "$frp_archive_sha256" ]] || {
  echo "Pinned FRP source checksum mismatch: $actual_archive_sha256" >&2
  exit 1
}

if [[ ! -d "$frp_extract_root" ]]; then
  mkdir -p "$frp_extract_root"
  if command -v unzip >/dev/null; then
    unzip -q "$frp_archive" -d "$frp_extract_root"
  elif command -v python3 >/dev/null; then
    python3 -m zipfile -e "$frp_archive" "$frp_extract_root"
  else
    echo "unzip or python3 is required" >&2
    exit 1
  fi
fi
frp_source=$(find "$frp_extract_root" -mindepth 1 -maxdepth 1 -type d -name "fatedier-frp-${frp_commit:0:7}*" -print -quit)
[[ -n "$frp_source" && -f "$frp_source/go.mod" ]] || {
  echo "Pinned FRP source tree not found" >&2
  exit 1
}

temporary_command="$frp_source/cmd/home-tunnel-agent-android-build"
[[ ! -e "$temporary_command" ]] || {
  echo "Fixed Android Agent build directory is already in use: $temporary_command" >&2
  exit 1
}
cleanup() {
  if [[ -d "$temporary_command" ]]; then
    case "$(cd "$temporary_command" && pwd)" in
      "$(cd "$frp_source/cmd" && pwd)"/*) rm -rf -- "$temporary_command" ;;
      *) echo "Refusing unsafe Agent build cleanup" >&2 ;;
    esac
  fi
}
trap cleanup EXIT
mkdir -p "$temporary_command"
cp "$workspace_dir/windows-agent/main.go" "$temporary_command/main.go"

requested_abis=${ANDROID_AGENT_ABIS:-arm64-v8a,x86_64}
IFS=',' read -r -a abi_values <<< "$requested_abis"
[[ ${#abi_values[@]} -gt 0 ]] || { echo "ANDROID_AGENT_ABIS is empty" >&2; exit 1; }

for raw_abi in "${abi_values[@]}"; do
  abi=$(printf '%s' "$raw_abi" | tr -d '[:space:]')
  case "$abi" in
    arm64-v8a) go_arch=arm64 ;;
    x86_64) go_arch=amd64 ;;
    *) echo "Unsupported Android Agent ABI: $abi" >&2; exit 1 ;;
  esac
  output_dir="$client_dir/app/src/main/jniLibs/$abi"
  output="$output_dir/libhometunnel_agent.so"
  mkdir -p "$output_dir"
  cgo_enabled=0
  cc_value=
  cxx_value=
  if [[ "$abi" == "x86_64" ]]; then
    ndk_root=${ANDROID_NDK_ROOT:-${ANDROID_NDK_HOME:-${ANDROID_NDK_LATEST_HOME:-}}}
    if [[ -z "$ndk_root" ]]; then
      sdk_root=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
      [[ -n "$sdk_root" ]] && ndk_root="$sdk_root/ndk/$ndk_version"
    fi
    [[ -d "$ndk_root/toolchains/llvm/prebuilt" ]] || {
      echo "x86_64 requires Android NDK $ndk_version; set ANDROID_NDK_ROOT, ANDROID_NDK_HOME, or ANDROID_NDK_LATEST_HOME" >&2
      exit 1
    }
    case "$(uname -s)" in
      Linux) ndk_host=linux-x86_64 ;;
      Darwin) ndk_host=darwin-x86_64 ;;
      *) echo "Unsupported NDK build host: $(uname -s)" >&2; exit 1 ;;
    esac
    toolchain_bin="$ndk_root/toolchains/llvm/prebuilt/$ndk_host/bin"
    cc_value="$toolchain_bin/x86_64-linux-android26-clang"
    cxx_value="$toolchain_bin/x86_64-linux-android26-clang++"
    [[ -x "$cc_value" && -x "$cxx_value" ]] || {
      echo "NDK x86_64 API 26 clang wrappers not found under $toolchain_bin" >&2
      exit 1
    }
    cgo_enabled=1
  fi
  (
    cd "$frp_source"
    CGO_ENABLED="$cgo_enabled" GOOS=android GOARCH="$go_arch" GOFLAGS=-buildvcs=false \
      CC="$cc_value" CXX="$cxx_value" \
      go build -trimpath -buildmode=pie \
      -ldflags "-s -w -buildid= -X main.agentVersion=$agent_version -X main.frpVersion=$frp_version -X main.frpCommit=$frp_commit" \
      -o "$output" "./cmd/$(basename "$temporary_command")"
  )
  chmod 0755 "$output"
  if command -v file >/dev/null; then
    file "$output" | grep -Fq 'ELF 64-bit' || { echo "Agent output is not a 64-bit ELF: $output" >&2; exit 1; }
  fi
  agent_sha256=$(sha256sum "$output" | awk '{print $1}')
  echo "ANDROID_AGENT_ABI=$abi"
  echo "ANDROID_AGENT_SHA256=$agent_sha256"
  echo "ANDROID_AGENT_PATH=$(cd "$output_dir" && pwd)/$(basename "$output")"
done
