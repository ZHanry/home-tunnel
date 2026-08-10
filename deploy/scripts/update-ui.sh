#!/bin/sh
set -eu
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "update-ui.sh must run as root" >&2
  exit 1
fi

stage="${1:-}"
version="${2:-}"
expected_image_sha="${3:-}"
expected_gateway_image_sha="${4:-}"
expected_installer_sha="${5:-}"
expected_metadata_sha="${6:-}"
expected_caddy_sha="${7:-}"
expected_caddy_inode="${8:-}"
public_base_url="${HOME_TUNNEL_PUBLIC_BASE_URL:-}"
tunnel_suffix="${HOME_TUNNEL_TUNNEL_DOMAIN:-}"

[ -n "$stage" ] && [ -n "$version" ] && [ -n "$expected_image_sha" ] \
  && [ -n "$expected_gateway_image_sha" ] \
  && [ -n "$expected_installer_sha" ] && [ -n "$expected_metadata_sha" ] \
  && [ -n "$expected_caddy_sha" ] && [ -n "$expected_caddy_inode" ] || {
    echo "usage: update-ui.sh STAGE VERSION CONTROL_IMAGE_SHA GATEWAY_IMAGE_SHA INSTALLER_SHA METADATA_SHA CADDY_SHA CADDY_INODE" >&2
    exit 1
  }

is_sha256() {
  [ "${#1}" -eq 64 ] && ! printf '%s' "$1" | grep -Eq '[^0-9a-f]'
}

printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "Invalid version" >&2; exit 1; }
is_sha256 "$expected_image_sha" || { echo "Invalid image archive SHA-256" >&2; exit 1; }
is_sha256 "$expected_gateway_image_sha" || { echo "Invalid gateway image archive SHA-256" >&2; exit 1; }
is_sha256 "$expected_installer_sha" || { echo "Invalid installer SHA-256" >&2; exit 1; }
is_sha256 "$expected_metadata_sha" || { echo "Invalid metadata SHA-256" >&2; exit 1; }
is_sha256 "$expected_caddy_sha" || { echo "Invalid Caddy SHA-256" >&2; exit 1; }
printf '%s' "$expected_caddy_inode" | grep -Eq '^[0-9]+$' || { echo "Invalid Caddy inode" >&2; exit 1; }

stage="$(readlink -m "$stage")"
case "$stage" in /tmp/home-tunnel-ui-*) ;; *) echo "Unsafe deployment stage" >&2; exit 1 ;; esac
[ -d "$stage" ] || { echo "Deployment stage is missing" >&2; exit 1; }

root="/opt/home-tunnel"
compose="$root/compose.yaml"
downloads="$root/downloads"
caddyfile="${CADDYFILE_PATH:-/opt/caddy/Caddyfile}"
image_archive="$stage/control-center-image.tar"
gateway_image_archive="$stage/traffic-gateway-image.tar"
metadata="$stage/latest.json"
file_name="HomeTunnel-Setup-$version-x64.exe"
installer="$stage/$file_name"
github_repository_url="https://github.com/ZHanry/home-tunnel"
github_release_url="$github_repository_url/releases/download/v$version/$file_name"
new_image_tag="home-tunnel/control-center:$version-arm64"
new_gateway_image_tag="home-tunnel/traffic-gateway:$version-arm64"
compose_backup="$stage/compose.rollback.yaml"
compose_candidate="$stage/compose.candidate.yaml"
compose_new="$root/compose.yaml.new"
metadata_backup="$stage/latest.rollback.json"
installer_backup="$stage/installer.rollback.exe"
dangling_before="$stage/dangling.before"
rollback_tag="home-tunnel/control-center:rollback-ui-$(date -u +%Y%m%d%H%M%S)"
gateway_rollback_tag="home-tunnel/traffic-gateway:rollback-ui-$(date -u +%Y%m%d%H%M%S)"
old_compose_image=""
old_gateway_compose_image=""
old_image=""
old_gateway_image=""
new_image=""
new_gateway_image=""
target_tag_before=""
gateway_target_tag_before=""
installer_preexisted=0
rollback_ready=0
downloads_changed=0
compose_changed=0
container_changed=0

wait_healthy() {
  container="$1"
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
    [ "$state" = "healthy" ] && return 0
    [ "$state" = "exited" ] && { docker logs --tail 80 "$container" >&2 || true; return 1; }
    attempts=$((attempts + 1))
    sleep 2
  done
  docker logs --tail 80 "$container" >&2 || true
  return 1
}

cleanup_new_dangling() {
  [ -f "$dangling_before" ] || return 0
  dangling_after="$stage/dangling.after"
  docker image ls --filter dangling=true --quiet --no-trunc | sort -u > "$dangling_after" || return 0
  comm -13 "$dangling_before" "$dangling_after" | while IFS= read -r image_id; do
    [ -n "$image_id" ] && docker image rm "$image_id" >/dev/null 2>&1 || true
  done
  rm -f "$dangling_after"
}

restore_downloads() {
  [ "$downloads_changed" -eq 1 ] || return 0
  rm -f -- "$downloads/$file_name.new"
  if [ "$installer_preexisted" -eq 1 ] && [ -f "$installer_backup" ]; then
    install -m 0644 "$installer_backup" "$downloads/$file_name.rollback"
    mv -f "$downloads/$file_name.rollback" "$downloads/$file_name"
  else
    rm -f -- "$downloads/$file_name"
  fi
  if [ -f "$metadata_backup" ]; then
    install -m 0644 "$metadata_backup" "$downloads/latest.json.rollback"
    mv -f "$downloads/latest.json.rollback" "$downloads/latest.json"
  fi
}

rollback() {
  [ "$rollback_ready" -eq 1 ] || return 0
  echo "UI deployment failed; restoring the previous compose file, image, and downloads." >&2

  if [ -n "$old_image" ] && [ -n "$old_compose_image" ]; then
    docker tag "$old_image" "$old_compose_image" >/dev/null 2>&1 || true
  fi
  if [ -n "$old_gateway_image" ] && [ -n "$old_gateway_compose_image" ]; then
    docker tag "$old_gateway_image" "$old_gateway_compose_image" >/dev/null 2>&1 || true
  fi
  if [ -n "$target_tag_before" ]; then
    docker tag "$target_tag_before" "$new_image_tag" >/dev/null 2>&1 || true
  fi
  if [ -n "$gateway_target_tag_before" ]; then
    docker tag "$gateway_target_tag_before" "$new_gateway_image_tag" >/dev/null 2>&1 || true
  fi

  if [ "$compose_changed" -eq 1 ] && [ -f "$compose_backup" ]; then
    install -m 0640 "$compose_backup" "$compose_new"
    mv -f "$compose_new" "$compose"
  fi
  restore_downloads || true

  if [ "$container_changed" -eq 1 ]; then
    docker compose -f "$compose" up -d --no-deps --force-recreate control-center >/dev/null 2>&1 || true
    wait_healthy home-tunnel-control-center || true
    docker compose -f "$compose" up -d --no-deps --force-recreate traffic-gateway >/dev/null 2>&1 || true
    wait_healthy home-tunnel-traffic-gateway || true
  fi

  if [ -z "$target_tag_before" ]; then
    docker image rm "$new_image_tag" >/dev/null 2>&1 || true
  fi
  if [ -z "$gateway_target_tag_before" ]; then
    docker image rm "$new_gateway_image_tag" >/dev/null 2>&1 || true
  fi
  cleanup_new_dangling
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ]; then rollback || true; fi
  rm -f -- "$compose_new" "$downloads/$file_name.new" "$downloads/$file_name.rollback" \
    "$downloads/latest.json.new" "$downloads/latest.json.rollback"
  [ -n "$rollback_tag" ] && docker image rm "$rollback_tag" >/dev/null 2>&1 || true
  [ -n "$gateway_rollback_tag" ] && docker image rm "$gateway_rollback_tag" >/dev/null 2>&1 || true
  case "$stage" in /tmp/home-tunnel-ui-*) rm -rf -- "$stage" ;; esac
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

[ "$(uname -m)" = "aarch64" ] || { echo "ARM64 server required" >&2; exit 1; }
for required in "$image_archive" "$gateway_image_archive" "$metadata" "$installer" "$compose" "$caddyfile" "$root/scripts/probe-existing.sh"; do
  [ -f "$required" ] || { echo "Required deployment input is missing: $required" >&2; exit 1; }
done
[ "$(sha256sum "$image_archive" | cut -d' ' -f1)" = "$expected_image_sha" ] || { echo "Image archive hash mismatch" >&2; exit 1; }
[ "$(sha256sum "$gateway_image_archive" | cut -d' ' -f1)" = "$expected_gateway_image_sha" ] || { echo "Gateway image archive hash mismatch" >&2; exit 1; }
[ "$(sha256sum "$installer" | cut -d' ' -f1)" = "$expected_installer_sha" ] || { echo "Installer hash mismatch" >&2; exit 1; }
[ "$(sha256sum "$metadata" | cut -d' ' -f1)" = "$expected_metadata_sha" ] || { echo "Metadata hash mismatch" >&2; exit 1; }
[ "$(sha256sum "$caddyfile" | cut -d' ' -f1)" = "$expected_caddy_sha" ] || { echo "Caddy hash changed" >&2; exit 1; }
[ "$(stat -c '%i' "$caddyfile")" = "$expected_caddy_inode" ] || { echo "Caddy inode changed" >&2; exit 1; }
[ "$(df -Pk / | awk 'NR==2 {print $4}')" -gt 4194304 ] || { echo "Less than 4 GiB free disk space" >&2; exit 1; }

python3 - "$metadata" "$installer" "$version" "$expected_installer_sha" <<'PY'
import hashlib
import json
import os
import sys

metadata_path, installer_path, version, expected_sha = sys.argv[1:]
with open(metadata_path, encoding="utf-8") as handle:
    release = json.load(handle)
expected = {
    "version": version,
    "platform": "windows",
    "architecture": "x64",
    "file_name": f"HomeTunnel-Setup-{version}-x64.exe",
    "size_bytes": os.path.getsize(installer_path),
    "sha256": expected_sha,
    "download_url": f"https://github.com/ZHanry/home-tunnel/releases/download/v{version}/HomeTunnel-Setup-{version}-x64.exe",
    "stable_download_url": "https://github.com/ZHanry/home-tunnel/releases/latest",
}
for key, value in expected.items():
    if release.get(key) != value:
        raise SystemExit(f"release metadata mismatch: {key}")
digest = hashlib.sha256()
with open(installer_path, "rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
if digest.hexdigest() != expected_sha:
    raise SystemExit("installer digest mismatch")
PY

python3 - "$image_archive" "$new_image_tag" "$gateway_image_archive" "$new_gateway_image_tag" <<'PY'
import json
import tarfile
import sys

for archive, expected_tag in ((sys.argv[1], sys.argv[2]), (sys.argv[3], sys.argv[4])):
    with tarfile.open(archive, "r") as bundle:
        for member in bundle.getmembers():
            if member.name.startswith("/") or ".." in member.name.split("/"):
                raise SystemExit("unsafe image archive path")
        try:
            manifest = json.load(bundle.extractfile("manifest.json"))
        except Exception as error:
            raise SystemExit(f"invalid Docker image archive: {error}")
    tags = sorted(tag for entry in manifest for tag in (entry.get("RepoTags") or []))
    if tags != [expected_tag]:
        raise SystemExit(f"unexpected image archive tags: {tags}")
PY

read_control_center_env() {
  variable="$1"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' home-tunnel-control-center \
    | sed -n "s/^${variable}=//p" | sed -n '1p'
}

if [ -z "$public_base_url" ]; then
  public_base_url="$(read_control_center_env PUBLIC_BASE_URL)"
fi
if [ -z "$tunnel_suffix" ]; then
  tunnel_suffix="$(read_control_center_env TUNNEL_DOMAIN)"
fi
public_base_url="${public_base_url%/}"
python3 - "$public_base_url" "$tunnel_suffix" <<'PY'
import re
import sys
from urllib.parse import urlsplit

public_base_url, tunnel_suffix = sys.argv[1:]
parsed = urlsplit(public_base_url)
if (
    parsed.scheme != "https"
    or not parsed.hostname
    or parsed.username is not None
    or parsed.password is not None
    or parsed.query
    or parsed.fragment
    or parsed.path not in ("", "/")
):
    raise SystemExit("Invalid existing public base URL")
if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", tunnel_suffix):
    raise SystemExit("Invalid existing tunnel domain")
PY

for name in home-tunnel-postgres home-tunnel-control-center home-tunnel-frps home-tunnel-traffic-gateway; do
  [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name")" = "healthy" ] || {
    echo "$name is not healthy before deployment" >&2
    exit 1
  }
done
for name in home-tunnel-postgres home-tunnel-frps; do
  docker inspect -f '{{.Name}}|{{.Id}}|{{.Image}}|{{.State.StartedAt}}' "$name"
done > "$stage/untouched.pre"

"$root/scripts/probe-existing.sh" "$stage/existing.pre.tsv"
tunnel_domain="$(docker exec home-tunnel-postgres psql -U home_tunnel -d home_tunnel -Atqc \
  "SELECT subdomain || '.$tunnel_suffix' FROM connections WHERE enabled AND deleted_at IS NULL ORDER BY created_at LIMIT 1")"
if [ -n "$tunnel_domain" ]; then
  case "$tunnel_domain" in *.$tunnel_suffix) ;; *) echo "Invalid existing tunnel suffix" >&2; exit 1 ;; esac
  subdomain="${tunnel_domain%.$tunnel_suffix}"
  printf '%s' "$subdomain" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' || {
    echo "Invalid existing tunnel domain" >&2
    exit 1
  }
  tunnel_status="$(curl --silent --show-error --max-time 20 --output /dev/null --write-out '%{http_code}' "https://$tunnel_domain/")"
  tunnel_fingerprint="$(printf '\n' | openssl s_client -servername "$tunnel_domain" -connect "$tunnel_domain:443" 2>/dev/null | openssl x509 -noout -fingerprint -sha256 | cut -d= -f2)"
  [ "$tunnel_status" != "000" ] && [ -n "$tunnel_fingerprint" ] || { echo "Existing tunnel probe failed" >&2; exit 1; }
  printf '%s\t%s\t%s\n' "$tunnel_domain" "$tunnel_status" "$tunnel_fingerprint" > "$stage/tunnel.pre.tsv"
fi

cp -p "$compose" "$compose_backup"
cp -p "$downloads/latest.json" "$metadata_backup"
if [ -f "$downloads/$file_name" ]; then
  installer_preexisted=1
  cp -p "$downloads/$file_name" "$installer_backup"
fi
cp -p "$compose" "$compose_candidate"

old_compose_images="$(python3 - "$compose_candidate" "$new_image_tag" "$new_gateway_image_tag" <<'PY'
import re
import sys

path, control_replacement, gateway_replacement = sys.argv[1:]
with open(path, encoding="utf-8", newline="") as handle:
    lines = handle.readlines()

def replace_image(service, repository, replacement):
    starts = [index for index, line in enumerate(lines) if re.fullmatch(rf"  {re.escape(service)}:\s*\r?\n?", line)]
    if len(starts) != 1:
        raise SystemExit(f"{service} service is missing or ambiguous")
    start = starts[0]
    end = len(lines)
    for index in range(start + 1, len(lines)):
        if re.match(r"^  [A-Za-z0-9_-]+:\s*\r?\n?$", lines[index]):
            end = index
            break
    matches = []
    for index in range(start + 1, end):
        match = re.fullmatch(r"    image:\s*(\S+)\s*\r?\n?", lines[index])
        if match:
            matches.append((index, match.group(1)))
    if len(matches) != 1:
        raise SystemExit(f"{service} image is missing or ambiguous")
    index, previous = matches[0]
    if not re.fullmatch(rf"{re.escape(repository)}:[A-Za-z0-9][A-Za-z0-9._-]*", previous):
        raise SystemExit(f"unexpected {service} image reference")
    newline = "\r\n" if lines[index].endswith("\r\n") else "\n"
    lines[index] = f"    image: {replacement}{newline}"
    return previous

old_control = replace_image("control-center", "home-tunnel/control-center", control_replacement)
old_gateway = replace_image("traffic-gateway", "home-tunnel/traffic-gateway", gateway_replacement)
with open(path, "w", encoding="utf-8", newline="") as handle:
    handle.writelines(lines)
print(old_control)
print(old_gateway)
PY
)"
old_compose_image="$(printf '%s\n' "$old_compose_images" | sed -n '1p')"
old_gateway_compose_image="$(printf '%s\n' "$old_compose_images" | sed -n '2p')"
[ -n "$old_compose_image" ] && [ -n "$old_gateway_compose_image" ] || { echo "Previous image references are missing" >&2; exit 1; }
old_image="$(docker inspect -f '{{.Image}}' home-tunnel-control-center)"
old_gateway_image="$(docker inspect -f '{{.Image}}' home-tunnel-traffic-gateway)"
[ "$(docker image inspect -f '{{.Id}}' "$old_compose_image")" = "$old_image" ] || { echo "Compose and running image differ" >&2; exit 1; }
[ "$(docker image inspect -f '{{.Id}}' "$old_gateway_compose_image")" = "$old_gateway_image" ] || { echo "Gateway compose and running image differ" >&2; exit 1; }
target_tag_before="$(docker image inspect -f '{{.Id}}' "$new_image_tag" 2>/dev/null || true)"
gateway_target_tag_before="$(docker image inspect -f '{{.Id}}' "$new_gateway_image_tag" 2>/dev/null || true)"
[ -z "$target_tag_before" ] || [ "$target_tag_before" = "$old_image" ] || {
  echo "Target image tag exists but is not the running production image" >&2
  exit 1
}
[ -z "$gateway_target_tag_before" ] || [ "$gateway_target_tag_before" = "$old_gateway_image" ] || {
  echo "Gateway target image tag exists but is not the running production image" >&2
  exit 1
}
docker compose --project-directory "$root" -f "$compose_candidate" config --quiet

docker image ls --filter dangling=true --quiet --no-trunc | sort -u > "$dangling_before"
docker tag "$old_image" "$rollback_tag"
docker tag "$old_gateway_image" "$gateway_rollback_tag"
rollback_ready=1
docker load --input "$image_archive" > "$stage/docker-load.txt"
docker load --input "$gateway_image_archive" > "$stage/gateway-docker-load.txt"

new_image="$(docker image inspect -f '{{.Id}}' "$new_image_tag")"
new_gateway_image="$(docker image inspect -f '{{.Id}}' "$new_gateway_image_tag")"
[ "$new_image" != "$old_image" ] || { echo "Control-center image did not change" >&2; exit 1; }
[ "$new_gateway_image" != "$old_gateway_image" ] || { echo "Traffic-gateway image did not change" >&2; exit 1; }
[ "$(docker image inspect -f '{{.Architecture}}' "$new_image_tag")" = "arm64" ] || { echo "New image is not ARM64" >&2; exit 1; }
[ "$(docker image inspect -f '{{.Config.User}}' "$new_image_tag")" = "10001:10001" ] || { echo "New image user is invalid" >&2; exit 1; }
[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$new_image_tag")" = "$version" ] || {
  echo "New image version label is invalid" >&2
  exit 1
}
[ "$(docker image inspect -f '{{.Architecture}}' "$new_gateway_image_tag")" = "arm64" ] || { echo "New gateway image is not ARM64" >&2; exit 1; }
[ "$(docker image inspect -f '{{.Config.User}}' "$new_gateway_image_tag")" = "10001:10001" ] || { echo "New gateway image user is invalid" >&2; exit 1; }
[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$new_gateway_image_tag")" = "$version" ] || {
  echo "New gateway image version label is invalid" >&2
  exit 1
}

downloads_changed=1
install -m 0644 "$installer" "$downloads/$file_name.new"
mv -f "$downloads/$file_name.new" "$downloads/$file_name"
install -m 0644 "$metadata" "$downloads/latest.json.new"
mv -f "$downloads/latest.json.new" "$downloads/latest.json"

install -m 0640 "$compose_candidate" "$compose_new"
mv -f "$compose_new" "$compose"
compose_changed=1
docker compose -f "$compose" config --quiet
container_changed=1
docker compose -f "$compose" up -d --no-deps --force-recreate control-center >/dev/null
wait_healthy home-tunnel-control-center

[ "$(docker inspect -f '{{.Image}}' home-tunnel-control-center)" = "$new_image" ] || { echo "Container did not adopt the new image" >&2; exit 1; }
docker exec home-tunnel-control-center node -e \
  "fetch('http://127.0.0.1:8080/healthz').then(async r=>{const b=await r.json();if(!r.ok||b.version!=='$version')process.exit(1)}).catch(()=>process.exit(1))"
[ "$(docker exec home-tunnel-postgres psql -U home_tunnel -d home_tunnel -Atqc 'SELECT max(version) FROM schema_migrations')" = "2" ] || {
  echo "Database migration version is invalid" >&2
  exit 1
}

docker compose -f "$compose" up -d --no-deps --force-recreate traffic-gateway >/dev/null
wait_healthy home-tunnel-traffic-gateway
[ "$(docker inspect -f '{{.Image}}' home-tunnel-traffic-gateway)" = "$new_gateway_image" ] || { echo "Gateway did not adopt the new image" >&2; exit 1; }
docker exec home-tunnel-traffic-gateway node -e \
  "fetch('http://127.0.0.1:8080/healthz',{headers:{host:'127.0.0.1:8080'}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
docker exec home-tunnel-traffic-gateway node -e \
  "const fs=require('node:fs');const key=fs.readFileSync('/run/secrets/internal_service_key','utf8').trim();fetch('http://home-tunnel-control-center:8080/internal/policies/sync',{headers:{'x-home-tunnel-key':key}}).then(async first=>{const etag=first.headers.get('etag');if(!first.ok||!etag)process.exit(1);await first.arrayBuffer();const second=await fetch('http://home-tunnel-control-center:8080/internal/policies/sync',{headers:{'x-home-tunnel-key':key,'if-none-match':etag}});if(second.status!==304)process.exit(1)}).catch(()=>process.exit(1))"

curl --fail --silent --show-error --max-time 20 --output "$stage/homepage.html" "$public_base_url/"
python3 - "$stage/homepage.html" <<'PY'
import re
import sys
from urllib.parse import urlsplit

html = open(sys.argv[1], encoding="utf-8").read()
hrefs = re.findall(r'''href\s*=\s*["']([^"']+)["']''', html, flags=re.I)
styles = [urlsplit(value).path for value in hrefs if urlsplit(value).path.endswith(".css")]
downloads = [value for value in hrefs if value == "https://github.com/ZHanry/home-tunnel/releases/latest"]
if styles != ["/v2.css"]:
    raise SystemExit(f"production stylesheet mismatch: {styles}")
if len(downloads) != 1:
    raise SystemExit(f"expected one download CTA, found {len(downloads)}")
if "control-section" in html or "/styles.css" in html or "/landing.css" in html or "/prototype.css" in html:
    raise SystemExit("legacy landing content is still present")
if "让家里的服务" not in html or "登录后台" not in html:
    raise SystemExit("landing page content mismatch")
PY

curl --fail --silent --show-error --max-time 20 --output "$stage/admin.html" "$public_base_url/admin"
grep -q '/v2.css' "$stage/admin.html"
curl --fail --silent --show-error --max-time 20 --output "$stage/public-release.json" \
  "$public_base_url/api/v1/public/releases/latest"
python3 - "$stage/public-release.json" "$metadata" "$github_release_url" <<'PY'
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

"$root/scripts/probe-existing.sh" "$stage/existing.post.tsv"
cmp "$stage/existing.pre.tsv" "$stage/existing.post.tsv" >/dev/null || { echo "Existing domain regression detected" >&2; exit 1; }
if [ -n "$tunnel_domain" ]; then
  tunnel_status="$(curl --silent --show-error --max-time 20 --output /dev/null --write-out '%{http_code}' "https://$tunnel_domain/")"
  tunnel_fingerprint="$(printf '\n' | openssl s_client -servername "$tunnel_domain" -connect "$tunnel_domain:443" 2>/dev/null | openssl x509 -noout -fingerprint -sha256 | cut -d= -f2)"
  printf '%s\t%s\t%s\n' "$tunnel_domain" "$tunnel_status" "$tunnel_fingerprint" > "$stage/tunnel.post.tsv"
  cmp "$stage/tunnel.pre.tsv" "$stage/tunnel.post.tsv" >/dev/null || { echo "Existing tunnel regression detected" >&2; exit 1; }
fi
for name in home-tunnel-postgres home-tunnel-frps; do
  docker inspect -f '{{.Name}}|{{.Id}}|{{.Image}}|{{.State.StartedAt}}' "$name"
done > "$stage/untouched.post"
cmp "$stage/untouched.pre" "$stage/untouched.post" >/dev/null || { echo "An out-of-scope container changed" >&2; exit 1; }
[ "$(sha256sum "$caddyfile" | cut -d' ' -f1)" = "$expected_caddy_sha" ] || { echo "Caddy hash changed after update" >&2; exit 1; }
[ "$(stat -c '%i' "$caddyfile")" = "$expected_caddy_inode" ] || { echo "Caddy inode changed after update" >&2; exit 1; }

evidence_tmp="$root/evidence/.ui-update.$$.tmp"
{
  printf 'completed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'release_version=%s\nold_compose_image=%s\nnew_compose_image=%s\n' "$version" "$old_compose_image" "$new_image_tag"
  printf 'old_gateway_compose_image=%s\nnew_gateway_compose_image=%s\n' "$old_gateway_compose_image" "$new_gateway_image_tag"
  printf 'old_image=%s\nnew_image=%s\n' "$old_image" "$new_image"
  printf 'old_gateway_image=%s\nnew_gateway_image=%s\n' "$old_gateway_image" "$new_gateway_image"
  printf 'image_archive_sha256=%s\ngateway_image_archive_sha256=%s\ninstaller_sha256=%s\nmetadata_sha256=%s\n' \
    "$expected_image_sha" "$expected_gateway_image_sha" "$expected_installer_sha" "$expected_metadata_sha"
  printf 'caddy_inode=%s\ncaddy_sha256=%s\n' "$expected_caddy_inode" "$expected_caddy_sha"
  [ -z "$tunnel_domain" ] || printf 'verified_tunnel_domain=%s\n' "$tunnel_domain"
  docker inspect -f 'container={{.Name}} image={{.Image}} health={{.State.Health.Status}}' home-tunnel-control-center
  docker inspect -f 'container={{.Name}} image={{.Image}} health={{.State.Health.Status}}' home-tunnel-traffic-gateway
} > "$evidence_tmp"
chmod 0600 "$evidence_tmp"
mv "$evidence_tmp" "$root/evidence/ui-update-$(date -u +%Y%m%dT%H%M%SZ).txt"

rollback_ready=0
docker image rm "$rollback_tag" >/dev/null 2>&1 || true
rollback_tag=""
docker image rm "$gateway_rollback_tag" >/dev/null 2>&1 || true
gateway_rollback_tag=""
if [ "$old_compose_image" != "$new_image_tag" ]; then docker image rm "$old_compose_image" >/dev/null 2>&1 || true; fi
if [ "$old_gateway_compose_image" != "$new_gateway_image_tag" ]; then docker image rm "$old_gateway_compose_image" >/dev/null 2>&1 || true; fi
docker image rm "$old_image" >/dev/null 2>&1 || true
docker image rm "$old_gateway_image" >/dev/null 2>&1 || true
docker image ls --format '{{.Repository}}:{{.Tag}}' | grep '^home-tunnel/control-center:' | while IFS= read -r obsolete_tag; do
  [ "$obsolete_tag" = "$new_image_tag" ] || docker image rm "$obsolete_tag" >/dev/null 2>&1 || true
done
docker image ls --format '{{.Repository}}:{{.Tag}}' | grep '^home-tunnel/traffic-gateway:' | while IFS= read -r obsolete_tag; do
  [ "$obsolete_tag" = "$new_gateway_image_tag" ] || docker image rm "$obsolete_tag" >/dev/null 2>&1 || true
done
find "$downloads" -maxdepth 1 -type f -name 'HomeTunnel-Setup-*-x64.exe' ! -name "$file_name" -delete
! docker logs home-tunnel-traffic-gateway 2>&1 | grep -q '"event_code":"SAMPLE_UPLOAD_FAILED"'
cleanup_new_dangling
printf 'Home Tunnel update completed: version=%s control_image=%s gateway_image=%s\n' "$version" "$new_image" "$new_gateway_image"
