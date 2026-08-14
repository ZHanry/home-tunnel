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
  backup="$(find "$backup_dir" -maxdepth 1 -type f -name 'home_tunnel-*.sqlite3.gpg' -print | sort -r | head -n 1)"
fi
[ -n "$backup" ] && [ -f "$backup" ] || { echo "No encrypted backup is available" >&2; exit 1; }
case "$(readlink -f "$backup")" in
  "$backup_dir"/home_tunnel-*.sqlite3.gpg) ;;
  *) echo "Refusing backup outside the managed backup directory" >&2; exit 1 ;;
esac
[ -r "$passphrase" ] || { echo "Backup passphrase is missing" >&2; exit 1; }

plain="$(mktemp "$backup_dir/.restore-verify.XXXXXX")"
cleanup() {
  if [ -f "$plain" ]; then
    if command -v shred >/dev/null 2>&1; then shred -u "$plain"; else rm -f "$plain"; fi
  fi
}
trap cleanup EXIT HUP INT TERM

GNUPGHOME="$root/gnupg" gpg --batch --yes --quiet --pinentry-mode loopback \
  --passphrase-file "$passphrase" --decrypt --output "$plain" "$backup"

verification="$(python3 - "$plain" <<'PY'
import sqlite3
import sys
from pathlib import Path

path = Path(sys.argv[1]).resolve()
connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
try:
    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        raise SystemExit(f"SQLite integrity check failed: {integrity}")
    foreign_key_error = connection.execute("PRAGMA foreign_key_check").fetchone()
    if foreign_key_error is not None:
        raise SystemExit(f"SQLite foreign-key check failed: {foreign_key_error}")
    schema_version = int(connection.execute("SELECT max(version) FROM schema_migrations").fetchone()[0] or 0)
    user_count = int(connection.execute("SELECT count(*) FROM users").fetchone()[0])
    if schema_version < 2:
        raise SystemExit("Restored schema version is invalid")
    if user_count < 1:
        raise SystemExit("Restored database has no administrator/user rows")
    print(f"{schema_version} {user_count}")
finally:
    connection.close()
PY
)"
schema_version="${verification%% *}"
user_count="${verification#* }"

verified="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
status_tmp="$(mktemp "$root/status/.restore.XXXXXX")"
STATUS_PATH="$status_tmp" VERIFIED_AT="$verified" BACKUP_FILE="$(basename "$backup")" SCHEMA_VERSION="$schema_version" USER_COUNT="$user_count" python3 - <<'PY'
import json
import os
from pathlib import Path
Path(os.environ["STATUS_PATH"]).write_text(json.dumps({
    "status": "healthy",
    "database": "sqlite",
    "verified_at": os.environ["VERIFIED_AT"],
    "backup_file": os.environ["BACKUP_FILE"],
    "schema_version": int(os.environ["SCHEMA_VERSION"]),
    "user_count": int(os.environ["USER_COUNT"]),
}, separators=(",", ":")) + "\n", encoding="utf-8")
PY
chmod 0444 "$status_tmp"
mv "$status_tmp" "$root/status/restore.json"
printf 'restore_verified=%s schema_version=%s users=%s\n' "$backup" "$schema_version" "$user_count"
