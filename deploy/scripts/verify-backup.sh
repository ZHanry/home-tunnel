#!/bin/sh
set -eu
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "verify-backup.sh must run as root" >&2
  exit 1
fi

root="${HOME_TUNNEL_ROOT:-/opt/home-tunnel}"
backup_dir="${HOME_TUNNEL_BACKUP_DIR:-/var/backups/home-tunnel}"
passphrase="$root/secrets/backup_passphrase"
backup="${1:-}"
if [ -z "$backup" ]; then
  backup="$(find "$backup_dir" -maxdepth 1 -type f -name 'home_tunnel-*.dump.gpg' -printf '%T@ %p\n' | sort -nr | awk 'NR==1{sub(/^[^ ]+ /,""); print; exit}')"
fi
[ -n "$backup" ] && [ -f "$backup" ] || { echo "No encrypted backup is available" >&2; exit 1; }
case "$(readlink -f "$backup")" in
  "$backup_dir"/home_tunnel-*.dump.gpg) ;;
  *) echo "Refusing backup outside the managed backup directory" >&2; exit 1 ;;
esac

container="home-tunnel-restore-verify-$(date -u +%Y%m%d%H%M%S)-$$"
case "$container" in home-tunnel-restore-verify-*) ;; *) exit 1 ;; esac
restore_password="$(openssl rand -hex 32)"
plain="$(mktemp "$backup_dir/.restore-verify.XXXXXX.dump")"
created=0
cleanup() {
  if [ "$created" -eq 1 ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  if [ -f "$plain" ]; then
    if command -v shred >/dev/null 2>&1; then shred -u "$plain"; else rm -f "$plain"; fi
  fi
}
trap cleanup EXIT HUP INT TERM

GNUPGHOME="$root/gnupg" gpg --batch --yes --quiet --pinentry-mode loopback \
  --passphrase-file "$passphrase" --decrypt --output "$plain" "$backup"
docker run -d --name "$container" --network none --tmpfs /var/lib/postgresql/data:rw,nosuid,size=1g \
  -e POSTGRES_DB=home_tunnel -e POSTGRES_USER=restore_user -e POSTGRES_PASSWORD="$restore_password" \
  postgres:17.5-bookworm >/dev/null
created=1

ready=0
i=0
while [ "$i" -lt 60 ]; do
  if docker exec "$container" pg_isready -U restore_user -d home_tunnel >/dev/null 2>&1; then ready=1; break; fi
  i=$((i + 1))
  sleep 1
done
[ "$ready" -eq 1 ] || { docker logs "$container" >&2; echo "Restore verification database did not become ready" >&2; exit 1; }

docker exec -i "$container" pg_restore -U restore_user -d home_tunnel --no-owner --no-acl < "$plain"
schema_version="$(docker exec "$container" psql -U restore_user -d home_tunnel -Atqc 'SELECT max(version) FROM schema_migrations')"
user_count="$(docker exec "$container" psql -U restore_user -d home_tunnel -Atqc 'SELECT count(*) FROM users')"
[ "$schema_version" = "2" ] || { echo "Restored schema version is invalid" >&2; exit 1; }
[ "$user_count" -ge 1 ] || { echo "Restored database has no administrator/user rows" >&2; exit 1; }

verified="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
status_tmp="$(mktemp "$root/status/.restore.XXXXXX.json")"
STATUS_PATH="$status_tmp" VERIFIED_AT="$verified" BACKUP_FILE="$(basename "$backup")" SCHEMA_VERSION="$schema_version" python3 - <<'PY'
import json
import os
from pathlib import Path
Path(os.environ["STATUS_PATH"]).write_text(json.dumps({
    "status": "healthy",
    "verified_at": os.environ["VERIFIED_AT"],
    "backup_file": os.environ["BACKUP_FILE"],
    "schema_version": int(os.environ["SCHEMA_VERSION"]),
}, separators=(",", ":")) + "\n", encoding="utf-8")
PY
chmod 0444 "$status_tmp"
mv "$status_tmp" "$root/status/restore.json"
printf 'restore_verified=%s schema_version=%s\n' "$backup" "$schema_version"
