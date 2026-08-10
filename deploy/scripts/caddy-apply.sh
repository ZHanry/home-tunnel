#!/bin/sh
set -eu
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "caddy-apply.sh must run as root" >&2
  exit 1
fi

root="${HOME_TUNNEL_ROOT:-/opt/home-tunnel}"
caddyfile="${CADDYFILE_PATH:-/opt/caddy/Caddyfile}"
caddy_container="${CADDY_CONTAINER:-caddy}"
candidate="${1:-}"
if [ -z "$candidate" ] || [ ! -f "$candidate" ]; then
  echo "usage: caddy-apply.sh CANDIDATE" >&2
  exit 1
fi
case "$(readlink -f "$caddyfile")" in
  /opt/caddy/Caddyfile) ;;
  *) echo "Refusing unexpected Caddyfile path" >&2; exit 1 ;;
esac

rollback_dir="$root/rollback/caddy"
evidence_dir="$root/evidence"
mkdir -p "$rollback_dir" "$evidence_dir"
chmod 0700 "$rollback_dir" "$evidence_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$rollback_dir/Caddyfile.$stamp.pre-home-tunnel"
cp -p "$caddyfile" "$backup"
sha256sum "$backup" > "$backup.sha256"
inode_before="$(stat -c %i "$caddyfile")"

restore() {
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
  docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
}

if ! docker run --rm --network home-tunnel-edge -v "$candidate:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile >/dev/null; then
  echo "Candidate Caddyfile validation failed" >&2
  exit 1
fi

CANDIDATE_PATH="$candidate" CADDY_PATH="$caddyfile" python3 - <<'PY'
import os
from pathlib import Path
source = Path(os.environ["CANDIDATE_PATH"]).read_bytes()
target = Path(os.environ["CADDY_PATH"])
with target.open("r+b") as handle:
    handle.seek(0)
    handle.write(source)
    handle.truncate()
    handle.flush()
    os.fsync(handle.fileno())
PY

inode_after="$(stat -c %i "$caddyfile")"
if [ "$inode_before" != "$inode_after" ]; then
  restore
  echo "Caddyfile inode changed; restored the verified backup" >&2
  exit 1
fi
if ! docker exec "$caddy_container" caddy validate --config /etc/caddy/Caddyfile >/dev/null; then
  restore
  echo "Mounted Caddyfile validation failed; restored the verified backup" >&2
  exit 1
fi
if ! docker exec "$caddy_container" caddy reload --config /etc/caddy/Caddyfile >/dev/null; then
  restore
  echo "Caddy reload failed; restored the verified backup" >&2
  exit 1
fi

cp -p "$backup" "$rollback_dir/Caddyfile.pre-home-tunnel"
sha256sum "$rollback_dir/Caddyfile.pre-home-tunnel" > "$rollback_dir/Caddyfile.pre-home-tunnel.sha256"
sha256sum "$caddyfile" > "$evidence_dir/Caddyfile.$stamp.deployed.sha256"
printf '%s\n' "$backup"
