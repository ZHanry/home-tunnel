#!/bin/sh
set -eu
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "backup.sh must run as root" >&2
  exit 1
fi

root="${HOME_TUNNEL_ROOT:-/opt/home-tunnel}"
backup_dir="${HOME_TUNNEL_BACKUP_DIR:-/var/backups/home-tunnel}"
status_dir="$root/status"
passphrase="$root/secrets/backup_passphrase"
container="home-tunnel-control-center"

case "$(readlink -m "$backup_dir")" in
  /var/backups/home-tunnel) ;;
  *) echo "Refusing unexpected backup directory" >&2; exit 1 ;;
esac
[ -r "$passphrase" ] || { echo "Backup passphrase is missing" >&2; exit 1; }
docker inspect "$container" >/dev/null 2>&1 || { echo "Control-center container is missing" >&2; exit 1; }
[ "$(docker inspect -f '{{.State.Running}}' "$container")" = "true" ] || { echo "Control-center container is not running" >&2; exit 1; }

mkdir -p "$backup_dir" "$status_dir" "$root/gnupg"
chmod 0700 "$backup_dir" "$root/gnupg"
chmod 0755 "$status_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
container_snapshot="/tmp/home-tunnel-backup-$stamp-$$.sqlite3"
plain="$(mktemp "$backup_dir/.home_tunnel.$stamp.XXXXXX.sqlite3")"
encrypted_tmp="$backup_dir/.home_tunnel.$stamp.sqlite3.gpg.tmp"
encrypted="$backup_dir/home_tunnel-$stamp.sqlite3.gpg"
status_tmp="$(mktemp "$status_dir/.backup.XXXXXX.json")"

cleanup() {
  docker exec "$container" rm -f -- "$container_snapshot" >/dev/null 2>&1 || true
  if [ -f "$plain" ]; then
    if command -v shred >/dev/null 2>&1; then shred -u "$plain"; else rm -f "$plain"; fi
  fi
  rm -f "$encrypted_tmp" "$status_tmp"
}
trap cleanup EXIT HUP INT TERM

# node:sqlite's online backup API creates a consistent snapshot while the service stays online.
docker exec "$container" node --input-type=module -e '
  import { backup, DatabaseSync } from "node:sqlite";
  const destination = process.argv[1];
  const source = new DatabaseSync(process.env.SQLITE_PATH || "/data/home-tunnel.db", { readOnly: true });
  try { await backup(source, destination); } finally { source.close(); }
' "$container_snapshot"
rm -f "$plain"
docker cp "$container:$container_snapshot" "$plain" >/dev/null
chmod 0600 "$plain"

GNUPGHOME="$root/gnupg" gpg --batch --yes --quiet --pinentry-mode loopback \
  --passphrase-file "$passphrase" --symmetric --cipher-algo AES256 --compress-algo none \
  --output "$encrypted_tmp" "$plain"
chmod 0600 "$encrypted_tmp"
mv "$encrypted_tmp" "$encrypted"
sha="$(sha256sum "$encrypted" | awk '{print $1}')"
size="$(stat -c %s "$encrypted")"
completed="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

STATUS_PATH="$status_tmp" COMPLETED_AT="$completed" BACKUP_SHA="$sha" BACKUP_SIZE="$size" BACKUP_FILE="$(basename "$encrypted")" python3 - <<'PY'
import json
import os
from pathlib import Path
Path(os.environ["STATUS_PATH"]).write_text(json.dumps({
    "status": "healthy",
    "database": "sqlite",
    "completed_at": os.environ["COMPLETED_AT"],
    "sha256": os.environ["BACKUP_SHA"],
    "size_bytes": int(os.environ["BACKUP_SIZE"]),
    "file": os.environ["BACKUP_FILE"],
}, separators=(",", ":")) + "\n", encoding="utf-8")
PY
chmod 0444 "$status_tmp"
mv "$status_tmp" "$status_dir/backup.json"

find "$backup_dir" -maxdepth 1 -type f -name 'home_tunnel-*.sqlite3.gpg' -mtime +30 -delete
printf 'backup=%s sha256=%s size=%s\n' "$encrypted" "$sha" "$size"
