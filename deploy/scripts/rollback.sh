#!/bin/sh
set -eu
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "rollback.sh must run as root" >&2
  exit 1
fi

root="${HOME_TUNNEL_ROOT:-/opt/home-tunnel}"
caddyfile="${CADDYFILE_PATH:-/opt/caddy/Caddyfile}"
caddy_container="${CADDY_CONTAINER:-caddy}"
backup="${1:-$root/rollback/caddy/Caddyfile.pre-home-tunnel}"
case "$(readlink -f "$backup")" in
  "$root"/rollback/caddy/Caddyfile*) ;;
  *) echo "Refusing rollback file outside the managed directory" >&2; exit 1 ;;
esac
[ -f "$backup" ] || { echo "Verified Caddy rollback file is missing" >&2; exit 1; }

if [ -f "$backup.sha256" ]; then sha256sum -c "$backup.sha256" >/dev/null; fi
docker run --rm --pull never --network home-tunnel-edge -v "$backup:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile >/dev/null
inode_before="$(stat -c %i "$caddyfile")"
BACKUP_PATH="$backup" CADDY_PATH="$caddyfile" python3 - <<'PY'
import os
from pathlib import Path
source = Path(os.environ["BACKUP_PATH"]).read_bytes()
target = Path(os.environ["CADDY_PATH"])
with target.open("r+b") as handle:
    handle.seek(0)
    handle.write(source)
    handle.truncate()
    handle.flush()
    os.fsync(handle.fileno())
PY
[ "$inode_before" = "$(stat -c %i "$caddyfile")" ] || { echo "Caddyfile inode changed during rollback" >&2; exit 1; }
docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile >/dev/null
docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile >/dev/null

if [ -f "$root/compose.yaml" ]; then
  docker compose -f "$root/compose.yaml" stop traffic-gateway frps control-center >/dev/null 2>&1 || true
fi
if docker network inspect home-tunnel-edge >/dev/null 2>&1; then
  docker network disconnect home-tunnel-edge "$caddy_container" >/dev/null 2>&1 || true
fi
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$root/evidence"
"$root/scripts/probe-existing.sh" "$root/evidence/existing-domains.$stamp.rollback.tsv"
printf 'rollback_completed=%s database_preserved=true\n' "$stamp"
