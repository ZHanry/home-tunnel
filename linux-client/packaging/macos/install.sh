#!/usr/bin/env bash
set -Eeuo pipefail

# macOS installer for the Home Tunnel headless client; the launchd-based
# counterpart of the Linux install.sh. Sandboxing note: launchd offers no
# systemd-style hardening directives, so containment comes from the dedicated
# unprivileged _hometunnel account plus the 0700 state directory.

usage() {
  echo "usage: sudo ./install.sh [--upgrade|--uninstall]" >&2
  exit 2
}

mode=install
case "${1:-}" in
  "") ;;
  --upgrade) mode=upgrade ;;
  --uninstall) mode=uninstall ;;
  *) usage ;;
esac
[[ $# -le 1 ]] || usage
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "this installer only supports macOS; use the Linux package instead" >&2
  exit 1
fi
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "install.sh must run as root" >&2
  exit 1
fi

label=com.hometunnel.client
service_user=_hometunnel
client_target=/usr/local/bin/home-tunnel-client
gui_target=/usr/local/bin/home-tunnel-gui
agent_target=/usr/local/lib/home-tunnel/home-tunnel-agent
plist_target="/Library/LaunchDaemons/$label.plist"
enroll_target=/usr/local/sbin/home-tunnel-enroll
state_dir=/usr/local/var/lib/home-tunnel
log_dir=/usr/local/var/log/home-tunnel

service_loaded() {
  launchctl print "system/$label" >/dev/null 2>&1
}

if [[ "$mode" == "uninstall" ]]; then
  if service_loaded; then
    launchctl bootout "system/$label"
  fi
  rm -f -- "$client_target" "$gui_target" "$agent_target" "$plist_target" "$enroll_target"
  echo "Home Tunnel macOS client uninstalled."
  echo "Kept: $state_dir (holds the device credential) and the $service_user account."
  echo "After revoking the device in the control center, remove them with:"
  echo "  sudo rm -rf $state_dir $log_dir"
  echo "  sudo dscl . -delete /Users/$service_user"
  echo "  sudo dscl . -delete /Groups/$service_user"
  exit 0
fi

root_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
client_source="$root_dir/bin/home-tunnel-client"
gui_source="$root_dir/bin/home-tunnel-gui"
agent_source="$root_dir/lib/home-tunnel-agent"
plist_source="$root_dir/Library/LaunchDaemons/$label.plist"
enroll_source="$root_dir/libexec/home-tunnel-enroll"
for required in "$client_source" "$gui_source" "$agent_source" "$plist_source" "$enroll_source"; do
  [[ -f "$required" ]] || { echo "missing package file: $required" >&2; exit 1; }
done

if [[ -e "$client_target" || -e "$gui_target" || -e "$agent_target" || -e "$plist_target" || -e "$enroll_target" ]] && [[ "$mode" != "upgrade" ]]; then
  echo "Home Tunnel macOS client is already installed; use --upgrade to replace binaries" >&2
  exit 1
fi

backup_dir=$(mktemp -d /var/tmp/home-tunnel-install.XXXXXX)
committed=false
was_loaded=false
if service_loaded; then
  was_loaded=true
fi
rollback() {
  if ! $committed; then
    for target in "$client_target" "$gui_target" "$agent_target" "$plist_target" "$enroll_target"; do
      name=$(printf '%s' "$target" | tr '/' '_')
      if [[ -f "$backup_dir/$name" ]]; then
        cp -p -- "$backup_dir/$name" "$target"
      elif [[ -e "$target" ]]; then
        rm -f -- "$target"
      fi
    done
    if $was_loaded && ! service_loaded && [[ -f "$plist_target" ]]; then
      launchctl bootstrap system "$plist_target" 2>/dev/null || true
    fi
  fi
  rm -rf -- "$backup_dir"
}
trap rollback EXIT INT TERM
for target in "$client_target" "$gui_target" "$agent_target" "$plist_target" "$enroll_target"; do
  if [[ -f "$target" ]]; then
    cp -p -- "$target" "$backup_dir/$(printf '%s' "$target" | tr '/' '_')"
  fi
done

if $was_loaded; then
  launchctl bootout "system/$label"
fi

# free_system_id prints an ID that is unused as both a UID and a GID; macOS
# convention keeps service accounts below 500.
free_system_id() {
  local used candidate
  used=$({ dscl . -list /Users UniqueID; dscl . -list /Groups PrimaryGroupID; } | awk '{print $2}' | sort -u)
  for candidate in {240..499}; do
    if ! printf '%s\n' "$used" | grep -qx "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  echo "no free system uid/gid between 240 and 499" >&2
  return 1
}

# ensure_service_account creates the hidden _hometunnel daemon user and group
# through dscl/dseditgroup (the scriptable macOS equivalent of useradd
# --system) with no password, no shell, and no home directory.
ensure_service_account() {
  local service_id group_id
  if dscl . -read "/Groups/$service_user" PrimaryGroupID >/dev/null 2>&1 &&
    dscl . -read "/Users/$service_user" UniqueID >/dev/null 2>&1; then
    return 0
  fi
  service_id=$(free_system_id)
  if ! dscl . -read "/Groups/$service_user" PrimaryGroupID >/dev/null 2>&1; then
    dseditgroup -o create -i "$service_id" -r "Home Tunnel service" "$service_user"
  fi
  group_id=$(dscl . -read "/Groups/$service_user" PrimaryGroupID | awk '{print $2}')
  if ! dscl . -read "/Users/$service_user" UniqueID >/dev/null 2>&1; then
    dscl . -create "/Users/$service_user"
    dscl . -create "/Users/$service_user" UniqueID "$service_id"
    dscl . -create "/Users/$service_user" PrimaryGroupID "$group_id"
    dscl . -create "/Users/$service_user" UserShell /usr/bin/false
    dscl . -create "/Users/$service_user" NFSHomeDirectory /var/empty
    dscl . -create "/Users/$service_user" RealName "Home Tunnel service account"
    dscl . -create "/Users/$service_user" IsHidden 1
    dscl . -create "/Users/$service_user" Password '*'
  fi
}
ensure_service_account

install -d -m 0755 /usr/local/bin /usr/local/sbin /usr/local/lib/home-tunnel
install -d -o "$service_user" -g "$service_user" -m 0700 "$state_dir"
# launchd opens StandardOutPath/StandardErrorPath in the daemon's context, so
# the log directory must be writable by the service user.
install -d -o "$service_user" -g "$service_user" -m 0755 "$log_dir"
install -m 0755 "$client_source" "$client_target"
install -m 0755 "$gui_source" "$gui_target"
install -m 0755 "$agent_source" "$agent_target"
install -m 0755 "$enroll_source" "$enroll_target"
# launchd only accepts daemon plists owned by root and not group/world
# writable.
install -o root -g wheel -m 0644 "$plist_source" "$plist_target"

if [[ "$mode" == "upgrade" && -f "$state_dir/state.json" ]]; then
  if $was_loaded; then
    launchctl bootstrap system "$plist_target"
  fi
  echo "Home Tunnel macOS client upgraded."
else
  # A fresh install must not load the daemon yet: an un-enrolled client exits
  # with an error and KeepAlive would restart it forever. home-tunnel-enroll
  # bootstraps the daemon once a device credential exists.
  echo "Home Tunnel macOS client installed."
  echo "Run: sudo home-tunnel-enroll"
fi
committed=true
