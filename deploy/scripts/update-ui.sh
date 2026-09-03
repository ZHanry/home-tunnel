#!/bin/sh
set -eu
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "update-ui.sh must run as root" >&2
  exit 1
fi

stage="${1:-}"
version="${2:-}"
expected_images_sha="${3:-}"
expected_caddy_sha="${4:-}"
expected_caddy_inode="${5:-}"

[ -n "$stage" ] && [ -n "$version" ] && [ -n "$expected_images_sha" ] \
  && [ -n "$expected_caddy_sha" ] && [ -n "$expected_caddy_inode" ] || {
    echo "usage: update-ui.sh STAGE VERSION IMAGES_SHA CADDY_SHA CADDY_INODE" >&2
    exit 1
  }

is_sha256() {
  [ "${#1}" -eq 64 ] && ! printf '%s' "$1" | grep -Eq '[^0-9a-f]'
}

printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$' || { echo "Invalid version" >&2; exit 1; }
source_version="${version%%-rc.*}"
is_sha256 "$expected_images_sha" || { echo "Invalid image archive SHA-256" >&2; exit 1; }
is_sha256 "$expected_caddy_sha" || { echo "Invalid Caddy SHA-256" >&2; exit 1; }
printf '%s' "$expected_caddy_inode" | grep -Eq '^[0-9]+$' || { echo "Invalid Caddy inode" >&2; exit 1; }

stage="$(readlink -m "$stage")"
case "$stage" in /tmp/home-tunnel-ui-*) ;; *) echo "Unsafe deployment stage" >&2; exit 1 ;; esac
[ -d "$stage" ] || { echo "Deployment stage is missing" >&2; exit 1; }

root="/opt/home-tunnel"
compose="$root/compose.yaml"
downloads="$root/downloads"
caddyfile="${CADDYFILE_PATH:-/opt/caddy/Caddyfile}"
image_archive="$stage/home-tunnel-ui-images.tar"
new_image_tag="home-tunnel/control-center:$version-arm64"
new_gateway_image_tag="home-tunnel/traffic-gateway:$version-arm64"
compose_backup="$stage/compose.rollback.yaml"
compose_candidate="$stage/compose.candidate.yaml"
compose_new="$root/compose.yaml.new"
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
rollback_ready=0
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

rollback() {
  [ "$rollback_ready" -eq 1 ] || return 0
  echo "UI deployment failed; restoring the previous Compose file and images." >&2
  if [ -n "$old_image" ] && [ -n "$old_compose_image" ]; then
    docker tag "$old_image" "$old_compose_image" >/dev/null 2>&1 || true
  fi
  if [ -n "$old_gateway_image" ] && [ -n "$old_gateway_compose_image" ]; then
    docker tag "$old_gateway_image" "$old_gateway_compose_image" >/dev/null 2>&1 || true
  fi
  if [ -n "$target_tag_before" ]; then docker tag "$target_tag_before" "$new_image_tag" >/dev/null 2>&1 || true; fi
  if [ -n "$gateway_target_tag_before" ]; then docker tag "$gateway_target_tag_before" "$new_gateway_image_tag" >/dev/null 2>&1 || true; fi
  if [ "$compose_changed" -eq 1 ] && [ -f "$compose_backup" ]; then
    install -m 0640 "$compose_backup" "$compose_new"
    mv -f "$compose_new" "$compose"
  fi
  if [ "$container_changed" -eq 1 ]; then
    docker compose -f "$compose" up -d --no-deps --force-recreate control-center >/dev/null 2>&1 || true
    wait_healthy home-tunnel-control-center || true
    docker compose -f "$compose" up -d --no-deps --force-recreate traffic-gateway >/dev/null 2>&1 || true
    wait_healthy home-tunnel-traffic-gateway || true
  fi
  if [ -z "$target_tag_before" ]; then docker image rm "$new_image_tag" >/dev/null 2>&1 || true; fi
  if [ -z "$gateway_target_tag_before" ]; then docker image rm "$new_gateway_image_tag" >/dev/null 2>&1 || true; fi
  cleanup_new_dangling
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ]; then rollback || true; fi
  rm -f -- "$compose_new"
  [ -n "$rollback_tag" ] && docker image rm "$rollback_tag" >/dev/null 2>&1 || true
  [ -n "$gateway_rollback_tag" ] && docker image rm "$gateway_rollback_tag" >/dev/null 2>&1 || true
  case "$stage" in /tmp/home-tunnel-ui-*) rm -rf -- "$stage" ;; esac
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

[ "$(uname -m)" = "aarch64" ] || { echo "ARM64 server required" >&2; exit 1; }
for required in "$image_archive" "$compose" "$caddyfile" "$root/scripts/probe-existing.sh" "$root/scripts/backup.sh" "$root/scripts/verify-backup.sh"; do
  [ -f "$required" ] || { echo "Required deployment input is missing: $required" >&2; exit 1; }
done
[ "$(sha256sum "$image_archive" | cut -d' ' -f1)" = "$expected_images_sha" ] || { echo "Image archive hash mismatch" >&2; exit 1; }
[ "$(sha256sum "$caddyfile" | cut -d' ' -f1)" = "$expected_caddy_sha" ] || { echo "Caddy hash changed" >&2; exit 1; }
[ "$(stat -c '%i' "$caddyfile")" = "$expected_caddy_inode" ] || { echo "Caddy inode changed" >&2; exit 1; }

archive_kb="$(du -k "$image_archive" | awk '{print $1}')"
required_kb=$((archive_kb * 3 + 262144))
[ "$required_kb" -ge 1048576 ] || required_kb=1048576
[ "$(df -Pk / | awk 'NR==2 {print $4}')" -gt "$required_kb" ] || { echo "Not enough free disk space for a rollback-safe update" >&2; exit 1; }

if docker ps -a --format '{{.Names}}' | grep -qx home-tunnel-postgres || grep -Eq '^  postgres:' "$compose"; then
  echo "Legacy PostgreSQL deployment detected. Export or migrate it before installing the SQLite release; no changes were made." >&2
  exit 78
fi
grep -q 'SQLITE_PATH: /data/home-tunnel.db' "$compose" || { echo "Existing deployment is not SQLite-based" >&2; exit 78; }
grep -q 'sqlite-data:/data' "$compose" || { echo "Existing SQLite volume mapping is missing" >&2; exit 78; }

python3 - "$image_archive" "$new_image_tag" "$new_gateway_image_tag" <<'PY'
import json
import sys
import tarfile

archive, control_tag, gateway_tag = sys.argv[1:]
with tarfile.open(archive, "r") as bundle:
    for member in bundle.getmembers():
        if member.name.startswith("/") or ".." in member.name.split("/"):
            raise SystemExit("unsafe image archive path")
    try:
        manifest = json.load(bundle.extractfile("manifest.json"))
    except Exception as error:
        raise SystemExit(f"invalid Docker image archive: {error}")
tags = sorted(tag for entry in manifest for tag in (entry.get("RepoTags") or []))
if tags != sorted([control_tag, gateway_tag]):
    raise SystemExit(f"unexpected image archive tags: {tags}")
PY

for name in home-tunnel-control-center home-tunnel-frps home-tunnel-traffic-gateway; do
  [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name")" = "healthy" ] || {
    echo "$name is not healthy before deployment" >&2
    exit 1
  }
done
docker inspect -f '{{.Name}}|{{.Id}}|{{.Image}}|{{.State.StartedAt}}' home-tunnel-frps > "$stage/untouched.pre"
"$root/scripts/probe-existing.sh" "$stage/existing.pre.tsv"
"$root/scripts/backup.sh" >/dev/null
"$root/scripts/verify-backup.sh" >/dev/null

cp -p "$compose" "$compose_backup"
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
[ "$(docker image inspect -f '{{.Id}}' "$old_compose_image")" = "$old_image" ] || { echo "Compose and running control image differ" >&2; exit 1; }
[ "$(docker image inspect -f '{{.Id}}' "$old_gateway_compose_image")" = "$old_gateway_image" ] || { echo "Compose and running gateway image differ" >&2; exit 1; }
target_tag_before="$(docker image inspect -f '{{.Id}}' "$new_image_tag" 2>/dev/null || true)"
gateway_target_tag_before="$(docker image inspect -f '{{.Id}}' "$new_gateway_image_tag" 2>/dev/null || true)"
[ -z "$target_tag_before" ] || [ "$target_tag_before" = "$old_image" ] || { echo "Target control image tag conflicts with another image" >&2; exit 1; }
[ -z "$gateway_target_tag_before" ] || [ "$gateway_target_tag_before" = "$old_gateway_image" ] || { echo "Target gateway image tag conflicts with another image" >&2; exit 1; }
docker compose --project-directory "$root" -f "$compose_candidate" config --quiet

docker image ls --filter dangling=true --quiet --no-trunc | sort -u > "$dangling_before"
docker tag "$old_image" "$rollback_tag"
docker tag "$old_gateway_image" "$gateway_rollback_tag"
rollback_ready=1
docker load --input "$image_archive" > "$stage/docker-load.txt"

new_image="$(docker image inspect -f '{{.Id}}' "$new_image_tag")"
new_gateway_image="$(docker image inspect -f '{{.Id}}' "$new_gateway_image_tag")"
[ "$(docker image inspect -f '{{.Architecture}}' "$new_image_tag")" = "arm64" ] || { echo "New control image is not ARM64" >&2; exit 1; }
[ "$(docker image inspect -f '{{.Config.User}}' "$new_image_tag")" = "10001:10001" ] || { echo "New control image user is invalid" >&2; exit 1; }
[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$new_image_tag")" = "$version" ] || { echo "New control image version label is invalid" >&2; exit 1; }
[ "$(docker image inspect -f '{{.Architecture}}' "$new_gateway_image_tag")" = "arm64" ] || { echo "New gateway image is not ARM64" >&2; exit 1; }
[ "$(docker image inspect -f '{{.Config.User}}' "$new_gateway_image_tag")" = "10001:10001" ] || { echo "New gateway image user is invalid" >&2; exit 1; }
[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$new_gateway_image_tag")" = "$version" ] || { echo "New gateway image version label is invalid" >&2; exit 1; }

install -m 0640 "$compose_candidate" "$compose_new"
mv -f "$compose_new" "$compose"
compose_changed=1
docker compose -f "$compose" config --quiet
container_changed=1
docker compose -f "$compose" up -d --no-deps --force-recreate control-center >/dev/null
wait_healthy home-tunnel-control-center
[ "$(docker inspect -f '{{.Image}}' home-tunnel-control-center)" = "$new_image" ] || { echo "Control container did not adopt the new image" >&2; exit 1; }
docker exec home-tunnel-control-center node -e \
  "fetch('http://127.0.0.1:8080/healthz').then(async r=>{const b=await r.json();if(!r.ok||b.version!=='$source_version')process.exit(1)}).catch(()=>process.exit(1))"
schema_version="$(docker exec home-tunnel-control-center node --input-type=module -e \
  "import { DatabaseSync } from 'node:sqlite';const db=new DatabaseSync(process.env.SQLITE_PATH,{readOnly:true});console.log(db.prepare('SELECT max(version) AS version FROM schema_migrations').get().version);db.close()")"
[ "$schema_version" -ge 2 ] || { echo "SQLite migration version is invalid" >&2; exit 1; }

docker compose -f "$compose" up -d --no-deps --force-recreate traffic-gateway >/dev/null
wait_healthy home-tunnel-traffic-gateway
[ "$(docker inspect -f '{{.Image}}' home-tunnel-traffic-gateway)" = "$new_gateway_image" ] || { echo "Gateway did not adopt the new image" >&2; exit 1; }
docker exec home-tunnel-traffic-gateway node -e \
  "const fs=require('node:fs');const key=fs.readFileSync('/run/secrets/internal_service_key','utf8').trim();const c=new AbortController();const t=setTimeout(()=>c.abort(),10000);fetch('http://home-tunnel-control-center:8080/internal/policies/events',{headers:{'x-home-tunnel-key':key,accept:'text/event-stream'},signal:c.signal}).then(async r=>{if(!r.ok||!r.body)process.exit(1);const reader=r.body.getReader();const part=await reader.read();const body=new TextDecoder().decode(part.value);await reader.cancel();clearTimeout(t);if(!body.includes('event: ready'))process.exit(1)}).catch(()=>process.exit(1))"

public_base_url="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' home-tunnel-control-center | sed -n 's/^PUBLIC_BASE_URL=//p' | sed -n '1p')"
public_base_url="${public_base_url%/}"
curl --fail --silent --show-error --max-time 20 --output "$stage/homepage.html" "$public_base_url/"
grep -q '/v2.css' "$stage/homepage.html"
grep -q 'https://github.com/ZHanry/home-tunnel/releases/latest' "$stage/homepage.html"

"$root/scripts/probe-existing.sh" "$stage/existing.post.tsv"
cmp "$stage/existing.pre.tsv" "$stage/existing.post.tsv" >/dev/null || { echo "Existing domain regression detected" >&2; exit 1; }
docker inspect -f '{{.Name}}|{{.Id}}|{{.Image}}|{{.State.StartedAt}}' home-tunnel-frps > "$stage/untouched.post"
cmp "$stage/untouched.pre" "$stage/untouched.post" >/dev/null || { echo "FRPS changed during the UI update" >&2; exit 1; }
[ "$(sha256sum "$caddyfile" | cut -d' ' -f1)" = "$expected_caddy_sha" ] || { echo "Caddy hash changed after update" >&2; exit 1; }
[ "$(stat -c '%i' "$caddyfile")" = "$expected_caddy_inode" ] || { echo "Caddy inode changed after update" >&2; exit 1; }

evidence_tmp="$root/evidence/.ui-update.$$.tmp"
{
  printf 'completed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'release_version=%s\nold_compose_image=%s\nnew_compose_image=%s\n' "$version" "$old_compose_image" "$new_image_tag"
  printf 'old_gateway_compose_image=%s\nnew_gateway_compose_image=%s\n' "$old_gateway_compose_image" "$new_gateway_image_tag"
  printf 'old_image=%s\nnew_image=%s\n' "$old_image" "$new_image"
  printf 'old_gateway_image=%s\nnew_gateway_image=%s\n' "$old_gateway_image" "$new_gateway_image"
  printf 'combined_image_archive_sha256=%s\nsqlite_schema_version=%s\n' "$expected_images_sha" "$schema_version"
  printf 'caddy_inode=%s\ncaddy_sha256=%s\n' "$expected_caddy_inode" "$expected_caddy_sha"
  docker inspect -f 'container={{.Name}} image={{.Image}} health={{.State.Health.Status}}' home-tunnel-control-center
  docker inspect -f 'container={{.Name}} image={{.Image}} health={{.State.Health.Status}}' home-tunnel-traffic-gateway
} > "$evidence_tmp"
chmod 0600 "$evidence_tmp"
mv "$evidence_tmp" "$root/evidence/ui-update-$(date -u +%Y%m%dT%H%M%SZ).txt"

# Official installers live on GitHub; remove any legacy server-side copies after all checks pass.
find "$downloads" -maxdepth 1 -type f -name 'HomeTunnel-Windows-*-x64.zip' -delete
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
cleanup_new_dangling
printf 'Home Tunnel update completed: version=%s control_image=%s gateway_image=%s\n' "$version" "$new_image" "$new_gateway_image"
