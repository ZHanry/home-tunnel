#!/usr/bin/env bash
set -Eeuo pipefail

upgrade=false
if [[ ${1:-} == "--upgrade" ]]; then
  upgrade=true
elif [[ $# -ne 0 ]]; then
  echo "usage: sudo ./install.sh [--upgrade]" >&2
  exit 2
fi
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "install.sh must run as root" >&2
  exit 1
fi

root_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
client_source="$root_dir/bin/home-tunnel-client"
gui_source="$root_dir/bin/home-tunnel-gui"
agent_source="$root_dir/lib/home-tunnel-agent"
unit_source="$root_dir/lib/systemd/system/home-tunnel-client.service"
enroll_source="$root_dir/libexec/home-tunnel-enroll"
desktop_source="$root_dir/lib/home-tunnel.desktop"
for required in "$client_source" "$gui_source" "$agent_source" "$unit_source" "$enroll_source"; do
  [[ -f "$required" ]] || { echo "missing package file: $required" >&2; exit 1; }
done

client_target=/usr/local/bin/home-tunnel-client
gui_target=/usr/local/bin/home-tunnel-gui
agent_target=/usr/local/lib/home-tunnel/home-tunnel-agent
unit_target=/etc/systemd/system/home-tunnel-client.service
enroll_target=/usr/local/sbin/home-tunnel-enroll
desktop_target=/usr/local/share/applications/home-tunnel.desktop
if [[ -e "$client_target" || -e "$gui_target" || -e "$agent_target" || -e "$unit_target" || -e "$enroll_target" ]] && ! $upgrade; then
  echo "Home Tunnel Linux client is already installed; use --upgrade to replace binaries" >&2
  exit 1
fi

backup_dir=$(mktemp -d /var/tmp/home-tunnel-install.XXXXXX)
committed=false
was_active=false
if systemctl is-active --quiet home-tunnel-client.service; then
  was_active=true
fi
rollback() {
  if ! $committed; then
    for target in "$client_target" "$gui_target" "$agent_target" "$unit_target" "$enroll_target" "$desktop_target"; do
      name=$(printf '%s' "$target" | tr '/' '_')
      if [[ -f "$backup_dir/$name" ]]; then
        cp -p -- "$backup_dir/$name" "$target"
      elif [[ -e "$target" ]]; then
        rm -f -- "$target"
      fi
    done
    systemctl daemon-reload 2>/dev/null || true
    if $was_active; then
      systemctl start home-tunnel-client.service 2>/dev/null || true
    fi
  fi
  rm -rf -- "$backup_dir"
}
trap rollback EXIT INT TERM
for target in "$client_target" "$gui_target" "$agent_target" "$unit_target" "$enroll_target" "$desktop_target"; do
  if [[ -f "$target" ]]; then
    cp -p -- "$target" "$backup_dir/$(printf '%s' "$target" | tr '/' '_')"
  fi
done

if $was_active; then
  systemctl stop home-tunnel-client.service
fi

if ! id home-tunnel >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/home-tunnel --shell /usr/sbin/nologin --user-group home-tunnel
fi
install -d -m 0755 /usr/local/bin /usr/local/sbin /usr/local/lib/home-tunnel /usr/local/share/applications
install -d -o home-tunnel -g home-tunnel -m 0700 /var/lib/home-tunnel
install -m 0755 "$client_source" "$client_target"
install -m 0755 "$gui_source" "$gui_target"
install -m 0755 "$agent_source" "$agent_target"
install -m 0755 "$enroll_source" "$enroll_target"
install -m 0644 "$unit_source" "$unit_target"
if [[ -f "$desktop_source" ]]; then
  install -m 0644 "$desktop_source" "$desktop_target"
fi
systemctl daemon-reload

if $upgrade && [[ -f /var/lib/home-tunnel/state.json ]]; then
  if $was_active; then
    systemctl start home-tunnel-client.service
  fi
  echo "Home Tunnel Linux client upgraded."
else
  echo "Home Tunnel Linux client installed."
  echo "Headless: sudo home-tunnel-enroll"
  echo "Desktop:  home-tunnel-gui"
fi
committed=true
