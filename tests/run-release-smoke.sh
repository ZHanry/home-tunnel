#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

workspace=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
compose_file="$workspace/tests/release-smoke.compose.yaml"
release_dir=${RELEASE_DIR:-$workspace/release}
evidence_dir=${EVIDENCE_DIR:-$workspace/release-smoke-evidence}
smoke_root="$workspace/tests/smoke"
alpine_image=alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce
compose=(docker compose -f "$compose_file")
if command -v cygpath >/dev/null 2>&1 && [[ "$release_dir" =~ ^[A-Za-z]:[\\/] ]]; then
  release_dir=$(cygpath -u "$release_dir")
fi
if command -v cygpath >/dev/null 2>&1; then
  compose_file=$(cygpath -w "$compose_file")
  compose=(docker compose -f "$compose_file")
fi
external_stack=${HOME_TUNNEL_SMOKE_EXTERNAL_STACK:-0}
allow_mutable_images=${HOME_TUNNEL_SMOKE_ALLOW_MUTABLE_IMAGES:-0}
python_command=${PYTHON_COMMAND:-python3}
containerized_driver=${HOME_TUNNEL_SMOKE_CONTAINERIZED_DRIVER:-}
python_smoke_script="$workspace/deploy/scripts/e2e_smoke.py"
python_smoke_root="$smoke_root"
python_evidence_dir="$evidence_dir"
docker_workspace="$workspace"
docker_smoke_root="$smoke_root"
docker_evidence_dir="$evidence_dir"
if command -v cygpath >/dev/null 2>&1; then
  containerized_driver=${containerized_driver:-1}
  python_smoke_script=$(cygpath -w "$python_smoke_script")
  python_smoke_root=$(cygpath -w "$smoke_root")
  python_evidence_dir=$(cygpath -w "$evidence_dir")
  docker_workspace=$(cygpath -w "$workspace")
  docker_smoke_root=$(cygpath -w "$smoke_root")
  docker_evidence_dir=$(cygpath -w "$evidence_dir")
fi
containerized_driver=${containerized_driver:-0}
[[ "$containerized_driver" == 0 || "$containerized_driver" == 1 ]] || {
  echo "HOME_TUNNEL_SMOKE_CONTAINERIZED_DRIVER must be 0 or 1" >&2
  exit 1
}

: "${CONTROL_IMAGE:?set CONTROL_IMAGE to the RC control-center image digest}"
: "${GATEWAY_IMAGE:?set GATEWAY_IMAGE to the RC traffic-gateway image digest}"
: "${RC_VERSION:?set RC_VERSION to X.Y.Z-rc.N}"
if [[ "$external_stack" != 1 && "$allow_mutable_images" != 1 ]]; then
  [[ "$CONTROL_IMAGE" == *@sha256:* && "$GATEWAY_IMAGE" == *@sha256:* ]] || {
    echo "Release smoke accepts immutable image digests only" >&2
    exit 1
  }
fi
control_container=${HOME_TUNNEL_CONTROL_CONTAINER:-home-tunnel-release-control-center}

cleanup() {
  if [[ "$external_stack" != 1 ]]; then
    "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ -e "$smoke_root" ]]; then
    MSYS_NO_PATHCONV=1 docker run --rm --platform linux/amd64 -v "$docker_smoke_root:/cleanup" "$alpine_image" sh -c 'rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?*' >/dev/null 2>&1 || true
    rm -rf -- "$smoke_root" || true
  fi
}
trap cleanup EXIT INT TERM
cleanup
mkdir -p "$smoke_root/secrets" "$smoke_root/backup-root/status" "$smoke_root/downloads" "$evidence_dir"

printf '%064d\n' 11 > "$smoke_root/secrets/internal_service_key"
printf '%064d\n' 22 > "$smoke_root/secrets/frps_plugin_key"
printf '%064d\n' 33 > "$smoke_root/secrets/lease_signing_key"
printf '%s\n' 'Local-Bootstrap-Only-Q8-safe' > "$smoke_root/secrets/bootstrap_admin_password"
printf '%s\n' 'Local-Operator-Final-Q9-safe-64' > "$smoke_root/admin_final_password"

openssl_output_root="$smoke_root"
if command -v cygpath >/dev/null 2>&1; then
  openssl_output_root=$(cygpath -w "$smoke_root")
fi
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1,DNS:frps' \
  -keyout "$openssl_output_root/secrets/frps_tls_key.pem" -out "$openssl_output_root/secrets/frps_tls_cert.pem" \
  >/dev/null 2>&1
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=smoke.test' \
  -addext 'subjectAltName=DNS:console.smoke.test,DNS:*.tunnel.smoke.test' \
  -keyout "$openssl_output_root/caddy.key" -out "$openssl_output_root/caddy.crt" >/dev/null 2>&1

# Docker Compose implements local file-backed secrets and bind mounts with the
# host filesystem's ownership and mode. The runner creates these fixtures with
# umask 077, but the production containers intentionally run as uid 10001.
# These are deterministic, disposable smoke credentials, so make only the
# mounted inputs readable while keeping every other generated file private.
chmod 0755 \
  "$smoke_root" \
  "$smoke_root/secrets" \
  "$smoke_root/downloads" \
  "$smoke_root/backup-root" \
  "$smoke_root/backup-root/status"
chmod 0444 "$smoke_root/secrets/"*
MSYS_NO_PATHCONV=1 docker run --rm --user 10001:10001 --platform linux/amd64 \
  -v "$docker_smoke_root/secrets:/secrets:ro" \
  -v "$docker_smoke_root/downloads:/downloads:ro" \
  -v "$docker_smoke_root/backup-root/status:/status:ro" \
  "$alpine_image" sh -eu -c '
    for secret in /secrets/*; do test -r "$secret"; done
    test -x /downloads
    test -x /status
  '

cat > "$smoke_root/Caddyfile" <<'CADDY'
{
  auto_https off
  admin off
}
http://:80 {
  respond "healthy" 200
}
https://console.smoke.test {
  tls /etc/caddy/caddy.crt /etc/caddy/caddy.key
  reverse_proxy control-center:8080
}
https://*.tunnel.smoke.test {
  tls /etc/caddy/caddy.crt /etc/caddy/caddy.key
  reverse_proxy traffic-gateway:8080
}
CADDY

"${compose[@]}" config --quiet
if [[ "$external_stack" != 1 ]]; then
  if ! "${compose[@]}" up -d; then
    "${compose[@]}" ps --all || true
    "${compose[@]}" logs --no-color || true
    exit 1
  fi
fi
for service in control-center frps traffic-gateway caddy; do
  container="home-tunnel-release-$service"
  for _ in $(seq 1 90); do
    state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)
    [[ "$state" == healthy ]] && break
    [[ "$state" == exited ]] && { docker logs "$container"; exit 1; }
    sleep 1
  done
  [[ "${state:-}" == healthy ]] || { docker logs "$container"; exit 1; }
done
for service in control-center frps traffic-gateway; do
  container="home-tunnel-release-$service"
  [[ "$(docker exec "$container" id -u)" == 10001 ]] || { echo "$container is not uid 10001" >&2; exit 1; }
done

[[ "$(docker exec "$control_container" node --input-type=module -e \
  "import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.env.SQLITE_PATH,{readOnly:true});console.log(d.prepare('select max(version) v from schema_migrations').get().v);d.close()")" == 7 ]] || {
  echo "Migration 007 was not applied" >&2
  exit 1
}

package="$release_dir/home-tunnel-linux-$RC_VERSION-amd64.tar.gz"
if [[ ! -s "$package" && -s "$release_dir/linux/home-tunnel-linux-$RC_VERSION-amd64.tar.gz" ]]; then
  package="$release_dir/linux/home-tunnel-linux-$RC_VERSION-amd64.tar.gz"
fi
[[ -s "$package" ]] || { echo "RC Linux amd64 package is missing" >&2; exit 1; }
mkdir -p "$smoke_root/client"
tar_package="$package"
tar_client_root="$smoke_root/client"
tar -xzf "$tar_package" -C "$tar_client_root"
agent=$(find "$smoke_root/client" -type f -path '*/lib/home-tunnel-agent' -print -quit)
[[ -f "$agent" ]] || { echo "Managed Agent is missing from RC package" >&2; exit 1; }
chmod 0755 "$agent"

mkdir -p "$smoke_root/backup-root/secrets" "$smoke_root/backup-root/status" "$smoke_root/backups"
printf '%s\n' 'Release-Smoke-Backup-Q9-safe' > "$smoke_root/backup-root/secrets/backup_passphrase"
MSYS_NO_PATHCONV=1 docker run --rm --user 0:0 \
  -e HOME_TUNNEL_CONTROL_CONTAINER="$control_container" \
  -v "$docker_workspace/deploy/scripts:/scripts:ro" \
  -v "$docker_smoke_root:/smoke" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --platform linux/amd64 "$alpine_image" sh -eu -c '
    apk add --no-cache docker-cli gnupg python3 sqlite >/dev/null
    HOME_TUNNEL_ROOT=/smoke/backup-root HOME_TUNNEL_BACKUP_DIR=/smoke/backups /scripts/backup.sh
  ' > "$evidence_dir/backup.txt"

if [[ "$containerized_driver" == 1 ]]; then
  driver_network=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' \
    home-tunnel-release-caddy | grep -E '(^|_)edge$' | head -n 1)
  [[ -n "$driver_network" ]] || { echo "Release-smoke edge network was not found" >&2; exit 1; }
  agent_relative=${agent#"$smoke_root/"}
  [[ "$agent_relative" != "$agent" ]] || { echo "Managed Agent is outside the smoke root" >&2; exit 1; }
  MSYS_NO_PATHCONV=1 docker run --rm --user 0:0 --network "$driver_network" \
    -e HOME_TUNNEL_CONTROL_CONTAINER="$control_container" \
    -v "$docker_workspace/deploy/scripts:/scripts:ro" \
    -v "$docker_smoke_root:/smoke" \
    -v "$docker_evidence_dir:/evidence" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    --platform linux/amd64 "$alpine_image" sh -eu -c '
      apk add --no-cache docker-cli openssl python3 >/dev/null
      exec python3 /scripts/e2e_smoke.py "$@"
    ' sh \
    --origin https://console.smoke.test \
    --frpc "/smoke/$agent_relative" --managed-agent \
    --frps-server frps --frps-port 7000 \
    --frps-ca-file /smoke/secrets/frps_tls_cert.pem \
    --tunnel-domain tunnel.smoke.test \
    --public-connect-host caddy --public-connect-port 443 --public-ca-file /smoke/caddy.crt \
    --bootstrap-password-file /smoke/secrets/bootstrap_admin_password \
    --admin-password-file /smoke/admin_final_password \
    --handoff-file /smoke/admin_handoff.txt \
    --evidence-file /evidence/e2e-smoke.json
else
  HOME_TUNNEL_CONTROL_CONTAINER="$control_container" \
  MSYS_NO_PATHCONV=1 "$python_command" "$python_smoke_script" \
    --origin https://console.smoke.test \
    --frpc "${agent}" --managed-agent \
    --frps-server 127.0.0.1 --frps-port 17000 \
    --frps-ca-file "$python_smoke_root/secrets/frps_tls_cert.pem" \
    --tunnel-domain tunnel.smoke.test \
    --public-connect-host 127.0.0.1 --public-connect-port 18443 --insecure-public-tls \
    --bootstrap-password-file "$python_smoke_root/secrets/bootstrap_admin_password" \
    --admin-password-file "$python_smoke_root/admin_final_password" \
    --handoff-file "$python_smoke_root/admin_handoff.txt" \
    --evidence-file "$python_evidence_dir/e2e-smoke.json"
fi

MSYS_NO_PATHCONV=1 docker run --rm --user 0:0 \
  -v "$docker_workspace/deploy/scripts:/scripts:ro" \
  -v "$docker_smoke_root:/smoke" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --platform linux/amd64 "$alpine_image" sh -eu -c '
    apk add --no-cache docker-cli gnupg python3 sqlite >/dev/null
    HOME_TUNNEL_ROOT=/smoke/backup-root HOME_TUNNEL_BACKUP_DIR=/smoke/backups /scripts/verify-backup.sh
  ' > "$evidence_dir/backup-restore.txt"

cp "$smoke_root/backup-root/status/backup.json" "$evidence_dir/backup.json"
cp "$smoke_root/backup-root/status/restore.json" "$evidence_dir/restore.json"
if [[ "$external_stack" != 1 ]]; then
  "${compose[@]}" ps > "$evidence_dir/compose.txt"
else
  docker ps --filter "name=home-tunnel-release-" > "$evidence_dir/compose.txt"
fi
printf '{"status":"passed","version":"%s","control_image":"%s","gateway_image":"%s"}\n' \
  "$RC_VERSION" "$CONTROL_IMAGE" "$GATEWAY_IMAGE" > "$evidence_dir/release-smoke.json"
echo "Release smoke passed with authenticated API, HTTP/HTTPS/WebSocket, revocation, and backup restore."
