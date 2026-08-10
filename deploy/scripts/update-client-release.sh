#!/bin/sh
set -eu
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "update-client-release.sh must run as root" >&2
  exit 1
fi

stage="${1:-}"
version="${2:-}"
expected_metadata_sha="${3:-}"
expected_caddy_sha="${4:-}"
expected_caddy_inode="${5:-}"

[ -n "$stage" ] && [ -n "$version" ] && [ -n "$expected_metadata_sha" ] \
  && [ -n "$expected_caddy_sha" ] && [ -n "$expected_caddy_inode" ] || {
    echo "usage: update-client-release.sh STAGE VERSION METADATA_SHA CADDY_SHA CADDY_INODE" >&2
    exit 1
  }

is_sha256() {
  [ "${#1}" -eq 64 ] && ! printf '%s' "$1" | grep -Eq '[^0-9a-f]'
}

printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "Invalid version" >&2; exit 1; }
is_sha256 "$expected_metadata_sha" || { echo "Invalid metadata SHA-256" >&2; exit 1; }
is_sha256 "$expected_caddy_sha" || { echo "Invalid Caddy SHA-256" >&2; exit 1; }
printf '%s' "$expected_caddy_inode" | grep -Eq '^[0-9]+$' || { echo "Invalid Caddy inode" >&2; exit 1; }

stage="$(readlink -m "$stage")"
case "$stage" in /tmp/home-tunnel-client-*) ;; *) echo "Unsafe deployment stage" >&2; exit 1 ;; esac
[ -d "$stage" ] || { echo "Deployment stage is missing" >&2; exit 1; }

root="/opt/home-tunnel"
downloads="$root/downloads"
caddyfile="${CADDYFILE_PATH:-/opt/caddy/Caddyfile}"
metadata="$stage/latest.json"
metadata_backup="$stage/latest.rollback.json"
probe_before="$stage/existing.pre.tsv"
probe_after="$stage/existing.post.tsv"
metadata_preexisted=0
updated=0

rollback() {
  [ "$updated" -eq 1 ] || return 0
  rm -f -- "$downloads/latest.json.new"
  if [ "$metadata_preexisted" -eq 1 ] && [ -f "$metadata_backup" ]; then
    install -m 0644 "$metadata_backup" "$downloads/latest.json.rollback"
    mv -f "$downloads/latest.json.rollback" "$downloads/latest.json"
  else
    rm -f -- "$downloads/latest.json"
  fi
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ]; then rollback || true; fi
  rm -f -- "$downloads/latest.json.new" "$downloads/latest.json.rollback"
  case "$stage" in /tmp/home-tunnel-client-*) rm -rf -- "$stage" ;; esac
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

[ -f "$metadata" ] || { echo "Release metadata is missing" >&2; exit 1; }
[ "$(sha256sum "$metadata" | cut -d' ' -f1)" = "$expected_metadata_sha" ] || { echo "Metadata hash mismatch" >&2; exit 1; }
[ "$(sha256sum "$caddyfile" | cut -d' ' -f1)" = "$expected_caddy_sha" ] || { echo "Caddy baseline hash mismatch" >&2; exit 1; }
[ "$(stat -c '%i' "$caddyfile")" = "$expected_caddy_inode" ] || { echo "Caddy baseline inode mismatch" >&2; exit 1; }

python3 - "$metadata" "$version" <<'PY'
import json
import re
import sys

metadata_path, version = sys.argv[1:]
with open(metadata_path, encoding="utf-8") as handle:
    release = json.load(handle)
expected_name = f"HomeTunnel-Setup-{version}-x64.exe"
checks = {
    "version": version,
    "platform": "windows",
    "architecture": "x64",
    "file_name": expected_name,
    "download_url": f"https://github.com/ZHanry/home-tunnel/releases/download/v{version}/{expected_name}",
    "stable_download_url": "https://github.com/ZHanry/home-tunnel/releases/latest",
}
for key, value in checks.items():
    if release.get(key) != value:
        raise SystemExit(f"metadata mismatch: {key}")
if not isinstance(release.get("size_bytes"), int) or release["size_bytes"] <= 0:
    raise SystemExit("metadata size is invalid")
if not re.fullmatch(r"[0-9a-f]{64}", release.get("sha256", "")):
    raise SystemExit("metadata SHA-256 is invalid")
PY

old_image="$(docker inspect -f '{{.Image}}' home-tunnel-control-center)"
[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' home-tunnel-control-center)" = "healthy" ] || {
  echo "Control center is not healthy" >&2
  exit 1
}
"$root/scripts/probe-existing.sh" "$probe_before"
if [ -f "$downloads/latest.json" ]; then
  metadata_preexisted=1
  cp -p "$downloads/latest.json" "$metadata_backup"
fi

updated=1
install -m 0644 "$metadata" "$downloads/latest.json.new"
mv -f "$downloads/latest.json.new" "$downloads/latest.json"
[ "$(sha256sum "$downloads/latest.json" | cut -d' ' -f1)" = "$expected_metadata_sha" ]

"$root/scripts/probe-existing.sh" "$probe_after"
cmp "$probe_before" "$probe_after" >/dev/null || { echo "Existing domain regression detected" >&2; exit 1; }
[ "$(sha256sum "$caddyfile" | cut -d' ' -f1)" = "$expected_caddy_sha" ] || { echo "Caddy hash changed" >&2; exit 1; }
[ "$(stat -c '%i' "$caddyfile")" = "$expected_caddy_inode" ] || { echo "Caddy inode changed" >&2; exit 1; }
[ "$(docker inspect -f '{{.Image}}' home-tunnel-control-center)" = "$old_image" ] || { echo "Control-center image changed" >&2; exit 1; }
[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' home-tunnel-control-center)" = "healthy" ] || {
  echo "Control center became unhealthy" >&2
  exit 1
}

# Installers are hosted by GitHub Releases; keep only the small metadata document on the server.
find "$downloads" -maxdepth 1 -type f -name 'HomeTunnel-Setup-*-x64.exe' -delete
updated=0
printf 'CLIENT_RELEASE_METADATA_UPDATED version=%s sha256=%s\n' "$version" "$expected_metadata_sha"
