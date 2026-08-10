#!/bin/sh
set -eu
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "update-client-release.sh must run as root" >&2
  exit 1
fi

stage="${1:-}"
version="${2:-}"
expected_installer_sha="${3:-}"
expected_metadata_sha="${4:-}"
expected_caddy_sha="${5:-}"
expected_caddy_inode="${6:-}"
public_base_url="${HOME_TUNNEL_PUBLIC_BASE_URL:-https://console.tunnel.example.com}"

[ -n "$stage" ] && [ -n "$version" ] && [ -n "$expected_installer_sha" ] \
  && [ -n "$expected_metadata_sha" ] && [ -n "$expected_caddy_sha" ] \
  && [ -n "$expected_caddy_inode" ] || {
    echo "usage: update-client-release.sh STAGE VERSION INSTALLER_SHA METADATA_SHA CADDY_SHA CADDY_INODE" >&2
    exit 1
  }

is_sha256() {
  [ "${#1}" -eq 64 ] && ! printf '%s' "$1" | grep -Eq '[^0-9a-f]'
}

printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "Invalid version" >&2; exit 1; }
is_sha256 "$expected_installer_sha" || { echo "Invalid installer SHA-256" >&2; exit 1; }
is_sha256 "$expected_metadata_sha" || { echo "Invalid metadata SHA-256" >&2; exit 1; }
is_sha256 "$expected_caddy_sha" || { echo "Invalid Caddy SHA-256" >&2; exit 1; }
printf '%s' "$expected_caddy_inode" | grep -Eq '^[0-9]+$' || { echo "Invalid Caddy inode" >&2; exit 1; }

stage="$(readlink -m "$stage")"
case "$stage" in /tmp/home-tunnel-client-*) ;; *) echo "Unsafe deployment stage" >&2; exit 1 ;; esac
[ -d "$stage" ] || { echo "Deployment stage is missing" >&2; exit 1; }

root="/opt/home-tunnel"
downloads="$root/downloads"
caddyfile="${CADDYFILE_PATH:-/opt/caddy/Caddyfile}"
file_name="HomeTunnel-Setup-$version-x64.exe"
installer="$stage/$file_name"
github_repository_url="https://github.com/ZHanry/home-tunnel"
github_release_url="$github_repository_url/releases/download/v$version/$file_name"
metadata="$stage/latest.json"
metadata_backup="$stage/latest.rollback.json"
probe_before="$stage/existing.pre.tsv"
probe_after="$stage/existing.post.tsv"
public_metadata="$stage/public-release.json"
old_image=""
updated=0

rollback() {
  [ "$updated" -eq 1 ] || return 0
  rm -f -- "$downloads/$file_name.new" "$downloads/$file_name"
  if [ -f "$metadata_backup" ]; then
    cp -p "$metadata_backup" "$downloads/latest.json.rollback"
    mv -f "$downloads/latest.json.rollback" "$downloads/latest.json"
  fi
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ]; then rollback || true; fi
  case "$stage" in /tmp/home-tunnel-client-*) rm -rf -- "$stage" ;; esac
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

[ -f "$installer" ] && [ -f "$metadata" ] || { echo "Release files are missing" >&2; exit 1; }
[ ! -e "$downloads/$file_name" ] || { echo "Target release already exists" >&2; exit 1; }
[ "$(sha256sum "$installer" | cut -d' ' -f1)" = "$expected_installer_sha" ] || { echo "Installer hash mismatch" >&2; exit 1; }
[ "$(sha256sum "$metadata" | cut -d' ' -f1)" = "$expected_metadata_sha" ] || { echo "Metadata hash mismatch" >&2; exit 1; }
[ "$(sha256sum "$caddyfile" | cut -d' ' -f1)" = "$expected_caddy_sha" ] || { echo "Caddy baseline hash mismatch" >&2; exit 1; }
[ "$(stat -c '%i' "$caddyfile")" = "$expected_caddy_inode" ] || { echo "Caddy baseline inode mismatch" >&2; exit 1; }

python3 - "$metadata" "$installer" "$version" "$expected_installer_sha" <<'PY'
import hashlib
import json
import os
import sys

metadata_path, installer_path, version, expected_sha = sys.argv[1:]
with open(metadata_path, encoding="utf-8") as handle:
    release = json.load(handle)
expected_name = f"HomeTunnel-Setup-{version}-x64.exe"
checks = {
    "version": version,
    "platform": "windows",
    "architecture": "x64",
    "file_name": expected_name,
    "size_bytes": os.path.getsize(installer_path),
    "sha256": expected_sha,
    "download_url": f"https://github.com/ZHanry/home-tunnel/releases/download/v{version}/{expected_name}",
    "stable_download_url": "https://github.com/ZHanry/home-tunnel/releases/latest",
}
for key, value in checks.items():
    if release.get(key) != value:
        raise SystemExit(f"metadata mismatch: {key}")
digest = hashlib.sha256()
with open(installer_path, "rb") as handle:
    while True:
        chunk = handle.read(1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
actual_sha = digest.hexdigest()
if actual_sha != expected_sha:
    raise SystemExit("installer digest mismatch")
PY

old_image="$(docker inspect -f '{{.Image}}' home-tunnel-control-center)"
[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' home-tunnel-control-center)" = "healthy" ] || {
  echo "Control center is not healthy" >&2
  exit 1
}
"$root/scripts/probe-existing.sh" "$probe_before"
cp -p "$downloads/latest.json" "$metadata_backup"

updated=1
install -m 0644 "$installer" "$downloads/$file_name.new"
mv -f "$downloads/$file_name.new" "$downloads/$file_name"
install -m 0644 "$metadata" "$downloads/latest.json.new"
mv -f "$downloads/latest.json.new" "$downloads/latest.json"

[ "$(sha256sum "$downloads/$file_name" | cut -d' ' -f1)" = "$expected_installer_sha" ]
[ "$(sha256sum "$downloads/latest.json" | cut -d' ' -f1)" = "$expected_metadata_sha" ]
curl --fail --silent --show-error --max-time 20 \
  --output "$public_metadata" \
  "$public_base_url/api/v1/public/releases/latest"
python3 - "$public_metadata" "$metadata" "$github_release_url" <<'PY'
import json
import sys

public = json.load(open(sys.argv[1], encoding="utf-8"))
source = json.load(open(sys.argv[2], encoding="utf-8"))
for key in ("version", "platform", "architecture", "file_name", "size_bytes", "sha256"):
    if public.get(key) != source.get(key):
        raise SystemExit(f"public release mismatch: {key}")
if public.get("download_url") != sys.argv[3] or source.get("download_url") != sys.argv[3]:
    raise SystemExit("public download URL mismatch")
PY

[ "$(curl --location --proto '=https' --proto-redir '=https' --fail --silent --show-error --max-time 180 "$github_release_url" | sha256sum | cut -d' ' -f1)" = "$expected_installer_sha" ]

"$root/scripts/probe-existing.sh" "$probe_after"
cmp "$probe_before" "$probe_after" >/dev/null || { echo "Existing domain regression detected" >&2; exit 1; }
[ "$(sha256sum "$caddyfile" | cut -d' ' -f1)" = "$expected_caddy_sha" ] || { echo "Caddy hash changed" >&2; exit 1; }
[ "$(stat -c '%i' "$caddyfile")" = "$expected_caddy_inode" ] || { echo "Caddy inode changed" >&2; exit 1; }
[ "$(docker inspect -f '{{.Image}}' home-tunnel-control-center)" = "$old_image" ] || { echo "Control-center image changed" >&2; exit 1; }
[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' home-tunnel-control-center)" = "healthy" ] || {
  echo "Control center became unhealthy" >&2
  exit 1
}

printf 'CLIENT_RELEASE_UPDATED version=%s sha256=%s\n' "$version" "$expected_installer_sha"
