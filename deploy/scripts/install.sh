#!/bin/sh
set -eu
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "install.sh must run as root" >&2
  exit 1
fi

release="${1:-}"
[ -n "$release" ] || { echo "usage: install.sh RELEASE_DIRECTORY" >&2; exit 1; }
release="$(readlink -f "$release")"
case "$release" in /tmp/home-tunnel-release-*) ;; *) echo "Release must be staged under /tmp/home-tunnel-release-*" >&2; exit 1 ;; esac
preloaded_images="${HOME_TUNNEL_PRELOADED_IMAGES:-0}"
case "$preloaded_images" in 0|1) ;; *) echo "HOME_TUNNEL_PRELOADED_IMAGES must be 0 or 1" >&2; exit 1 ;; esac

for required in \
  compose.yaml manifest.sha256 release.json frpc \
  caddy/home-tunnel.caddy caddy/on-demand-global.caddy \
  scripts/backup.sh scripts/caddy-apply.sh scripts/e2e_smoke.py scripts/probe-existing.sh \
  scripts/render_caddy.py scripts/rollback.sh scripts/verify-backup.sh \
  systemd/home-tunnel-backup.service systemd/home-tunnel-backup.timer \
  systemd/home-tunnel-backup-verify.service systemd/home-tunnel-backup-verify.timer; do
  [ -f "$release/$required" ] || { echo "Release is missing $required" >&2; exit 1; }
done
release_version="$(python3 - "$release/release.json" <<'PY'
import json, re, sys
release = json.load(open(sys.argv[1], encoding="utf-8"))
value = release.get("version", "")
if not re.fullmatch(r"\d+\.\d+\.\d+", value):
    raise SystemExit("Invalid release version")
if release.get("target") != "linux/arm64" or release.get("database") != "sqlite":
    raise SystemExit("Invalid server release target")
print(value)
PY
)"
[ "$preloaded_images" -eq 1 ] || [ -f "$release/images/home-tunnel-images.tar" ] || { echo "Release is missing images/home-tunnel-images.tar" >&2; exit 1; }
(cd "$release" && sha256sum -c manifest.sha256 >/dev/null)
chmod 0750 "$release/frpc"

root="/opt/home-tunnel"
caddyfile="${CADDYFILE_PATH:-/opt/caddy/Caddyfile}"
caddy_container="caddy"
expected_caddy_sha="${EXPECTED_CADDY_SHA256:-}"
[ -n "$expected_caddy_sha" ] || { echo "EXPECTED_CADDY_SHA256 is required" >&2; exit 1; }
[ "$(sha256sum "$caddyfile" | awk '{print $1}')" = "$expected_caddy_sha" ] || { echo "Caddyfile changed after baseline freeze" >&2; exit 1; }
[ "$(uname -m)" = "aarch64" ] || { echo "This release requires an ARM64 server" >&2; exit 1; }
[ "$(df -Pk / | awk 'NR==2{print $4}')" -gt 2097152 ] || { echo "Less than 2 GiB free disk space" >&2; exit 1; }
docker info >/dev/null
docker inspect "$caddy_container" >/dev/null
if [ -e "$root/compose.yaml" ] || docker ps -a --format '{{.Names}}' | grep -q '^home-tunnel-'; then
  echo "An existing Home Tunnel deployment was detected; refusing a fresh install" >&2
  exit 1
fi
if ss -lntH | awk '{print $4}' | grep -Eq '(^|:)7000$'; then
  echo "TCP port 7000 is already in use" >&2
  exit 1
fi

install -d -m 0750 "$root" "$root/scripts" "$root/caddy" "$root/systemd"
install -d -m 0755 "$root/downloads"
install -d -m 0700 "$root/secrets" "$root/evidence" "$root/rollback/caddy" "$root/handoff" "$root/gnupg" /var/backups/home-tunnel
install -d -m 0755 "$root/status"
install -m 0640 "$release/compose.yaml" "$root/compose.yaml"
for file in "$release"/scripts/*; do install -m 0750 "$file" "$root/scripts/$(basename "$file")"; done
for file in "$release"/caddy/*; do install -m 0640 "$file" "$root/caddy/$(basename "$file")"; done
for file in "$release"/systemd/*; do install -m 0644 "$file" "$root/systemd/$(basename "$file")"; done
install -m 0640 "$release/manifest.sha256" "$root/release-manifest.sha256"

"$root/scripts/probe-existing.sh" "$root/evidence/existing-domains.pre.tsv"
{
  printf 'captured_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'uname='; uname -a
  printf 'docker='; docker --version
  printf 'compose='; docker compose version
  printf 'caddy='; docker exec "$caddy_container" caddy version
  printf 'caddy_sha256='; sha256sum "$caddyfile" | awk '{print $1}'
  printf 'listeners\n'; ss -lntup
  printf 'containers\n'; docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
  printf 'networks\n'; docker network ls --format '{{.Name}} {{.Driver}} {{.Scope}}'
} > "$root/evidence/server-baseline.txt"
chmod 0600 "$root/evidence/server-baseline.txt"

write_secret() {
  printf '%s\n' "$2" > "$root/secrets/$1"
  chown 10001:10001 "$root/secrets/$1"
  chmod 0400 "$root/secrets/$1"
}
frps_plugin_key="$(openssl rand -hex 32)"
bootstrap_password="Ht-$(openssl rand -hex 24)-B7!"
admin_password="Ht-$(openssl rand -hex 24)-M7!"
write_secret internal_service_key "$(openssl rand -hex 32)"
write_secret frps_plugin_key "$frps_plugin_key"
write_secret lease_signing_key "$(openssl rand -hex 32)"
write_secret bootstrap_admin_password "$bootstrap_password"
write_secret admin_final_password "$admin_password"
write_secret backup_passphrase "$(openssl rand -hex 48)"
unset frps_plugin_key bootstrap_password admin_password

# Ten-year self-signed FRPS TLS certificate: FRPS serves it on TCP 7000 and the
# control center publishes the public part so managed clients pin the FRPS
# identity. Skip generation when both files already exist (idempotent).
frps_public_host="${HOME_TUNNEL_FRPS_PUBLIC_HOST:?HOME_TUNNEL_FRPS_PUBLIC_HOST is required for the FRPS TLS certificate}"
if [ ! -e "$root/secrets/frps_tls_cert.pem" ] || [ ! -e "$root/secrets/frps_tls_key.pem" ]; then
  case "$frps_public_host" in
    *[!0-9.]*) frps_tls_san="DNS:$frps_public_host" ;;
    *) frps_tls_san="IP:$frps_public_host,DNS:$frps_public_host" ;;
  esac
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -sha256 \
    -days 3650 -nodes \
    -keyout "$root/secrets/frps_tls_key.pem" \
    -out "$root/secrets/frps_tls_cert.pem" \
    -subj "/CN=$frps_public_host" \
    -addext "subjectAltName=$frps_tls_san" 2>/dev/null
  for frps_tls_file in frps_tls_cert.pem frps_tls_key.pem; do
    chown 10001:10001 "$root/secrets/$frps_tls_file"
    chmod 0400 "$root/secrets/$frps_tls_file"
  done
fi

if [ "$preloaded_images" -eq 0 ]; then
  docker load -i "$release/images/home-tunnel-images.tar" >/dev/null
fi
images="$(awk '/^    image:/ {print $2}' "$root/compose.yaml")"
[ -n "$images" ] || { echo "Compose contains no service images" >&2; exit 1; }
for image in $images; do
  [ "$(docker image inspect -f '{{.Architecture}}' "$image")" = "arm64" ] || { echo "$image is not ARM64" >&2; exit 1; }
  docker image inspect -f 'id={{.Id}} arch={{.Architecture}} tags={{json .RepoTags}} config={{json .Config}}' "$image" >> "$root/evidence/image-manifest.txt"
done

docker network inspect home-tunnel-edge >/dev/null 2>&1 || docker network create --label com.home-tunnel.managed=true home-tunnel-edge >/dev/null
if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$caddy_container" | grep -q 'home-tunnel-edge'; then
  docker network connect --alias caddy home-tunnel-edge "$caddy_container"
fi
docker compose -f "$root/compose.yaml" config --quiet

rollback_needed=0
on_exit() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$rollback_needed" -eq 1 ]; then "$root/scripts/rollback.sh" >/dev/null 2>&1 || true; fi
  exit "$status"
}
trap on_exit EXIT HUP INT TERM

wait_healthy() {
  name="$1"; attempts="${2:-90}"; count=0
  while [ "$count" -lt "$attempts" ]; do
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)"
    [ "$state" = "healthy" ] && return 0
    [ "$state" = "exited" ] && { docker logs --tail 80 "$name" >&2; return 1; }
    count=$((count + 1)); sleep 2
  done
  docker logs --tail 80 "$name" >&2 || true
  return 1
}

docker compose -f "$root/compose.yaml" up -d control-center
wait_healthy home-tunnel-control-center 90
docker compose -f "$root/compose.yaml" up -d frps traffic-gateway
wait_healthy home-tunnel-frps 90
wait_healthy home-tunnel-traffic-gateway 90

"$root/scripts/backup.sh" >/dev/null
"$root/scripts/verify-backup.sh" >/dev/null
python3 "$root/scripts/render_caddy.py" --input "$caddyfile" --global-snippet "$root/caddy/on-demand-global.caddy" --site-snippet "$root/caddy/home-tunnel.caddy" --output "$root/Caddyfile.candidate"
"$root/scripts/caddy-apply.sh" "$root/Caddyfile.candidate" >/dev/null
rollback_needed=1

python3 "$root/scripts/e2e_smoke.py" \
  --frpc "$release/frpc" \
  --bootstrap-password-file "$root/secrets/bootstrap_admin_password" \
  --admin-password-file "$root/secrets/admin_final_password" \
  --handoff-file "$root/handoff/Home_Tunnel_admin_credentials.txt" \
  --evidence-file "$root/evidence/e2e-smoke.json"
chown ubuntu:ubuntu "$root/handoff/Home_Tunnel_admin_credentials.txt"
chmod 0600 "$root/handoff/Home_Tunnel_admin_credentials.txt"

"$root/scripts/backup.sh" >/dev/null
"$root/scripts/verify-backup.sh" >/dev/null
"$root/scripts/probe-existing.sh" "$root/evidence/existing-domains.post.tsv"
cmp "$root/evidence/existing-domains.pre.tsv" "$root/evidence/existing-domains.post.tsv" >/dev/null || { echo "Existing domain regression changed status or certificate" >&2; exit 1; }

for service in control-center traffic-gateway; do
  [ "$(docker inspect -f '{{json .HostConfig.PortBindings}}' "home-tunnel-$service")" = "{}" ] || { echo "$service unexpectedly publishes a host port" >&2; exit 1; }
done
frps_ports="$(docker inspect -f '{{json .HostConfig.PortBindings}}' home-tunnel-frps)"
printf '%s' "$frps_ports" | grep -q '7000/tcp' || { echo "FRPS port 7000 is not published" >&2; exit 1; }

for unit in "$root"/systemd/*; do install -m 0644 "$unit" "/etc/systemd/system/$(basename "$unit")"; done
systemctl daemon-reload
systemctl enable --now home-tunnel-backup.timer home-tunnel-backup-verify.timer >/dev/null
docker compose -f "$root/compose.yaml" ps > "$root/evidence/compose-final.txt"
docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' home-tunnel-control-center home-tunnel-frps home-tunnel-traffic-gateway > "$root/evidence/resources-final.txt"
printf '{"status":"deployed","version":"%s","completed_at":"%s"}\n' "$release_version" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$root/status/deployment.json"
chmod 0444 "$root/status/deployment.json"
rm -f "$root/Caddyfile.candidate"
rollback_needed=0
trap - EXIT HUP INT TERM
printf 'Home Tunnel v%s deployment completed.\n' "$release_version"
