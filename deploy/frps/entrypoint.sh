#!/bin/sh
set -eu
umask 077

plugin_key="$(tr -d '\r\n' < /run/secrets/frps_plugin_key)"
case "$plugin_key" in
  ''|*[!0-9a-f]*) echo "FRPS plugin key must be non-empty lowercase hexadecimal" >&2; exit 1 ;;
esac

mkdir -p /run/frp

l4_enabled="${L4_TUNNEL_ENABLED:-false}"
tcp_enabled="${TCP_TUNNEL_ENABLED:-$l4_enabled}"
udp_enabled="${UDP_TUNNEL_ENABLED:-$l4_enabled}"
case "$tcp_enabled:$udp_enabled" in
  true:true|true:false|false:true|false:false) ;;
  *) echo "TCP_TUNNEL_ENABLED and UDP_TUNNEL_ENABLED must be true or false" >&2; exit 1 ;;
esac

allow_port_entries=""
tcp_start=""
tcp_end=""
public_frps_port="${PUBLIC_FRPS_PORT:-7000}"
case "$public_frps_port" in
  *[!0-9]*|'') echo "PUBLIC_FRPS_PORT must be an integer" >&2; exit 1 ;;
esac
if [ "$public_frps_port" -lt 1 ] || [ "$public_frps_port" -gt 65535 ]; then
  echo "PUBLIC_FRPS_PORT is invalid" >&2
  exit 1
fi
if [ "$tcp_enabled" = "true" ]; then
  tcp_start="${TCP_PORT_START:-${L4_PORT_START:-10000}}"
  tcp_end="${TCP_PORT_END:-${L4_PORT_END:-10099}}"
  case "$tcp_start:$tcp_end" in
    *[!0-9:]*|:*|*:) echo "TCP port range must contain integers" >&2; exit 1 ;;
  esac
  if [ "$tcp_start" -lt 1 ] || [ "$tcp_end" -gt 65535 ] || [ "$tcp_start" -gt "$tcp_end" ]; then
    echo "TCP port range is invalid" >&2
    exit 1
  fi
  for reserved_port in 80 443 7000 8080 "$public_frps_port"; do
    if [ "$tcp_start" -le "$reserved_port" ] && [ "$reserved_port" -le "$tcp_end" ]; then
      echo "TCP port range includes reserved deployment port $reserved_port" >&2
      exit 1
    fi
  done
  allow_port_entries="{ start = $tcp_start, end = $tcp_end }"
fi

if [ "$udp_enabled" = "true" ]; then
  udp_start="${UDP_PORT_START:-${L4_PORT_START:-10000}}"
  udp_end="${UDP_PORT_END:-${L4_PORT_END:-10099}}"
  case "$udp_start:$udp_end" in
    *[!0-9:]*|:*|*:) echo "UDP port range must contain integers" >&2; exit 1 ;;
  esac
  if [ "$udp_start" -lt 1 ] || [ "$udp_end" -gt 65535 ] || [ "$udp_start" -gt "$udp_end" ]; then
    echo "UDP port range is invalid" >&2
    exit 1
  fi
  if [ "$udp_start" -le 443 ] && [ 443 -le "$udp_end" ]; then
    echo "UDP port range includes reserved deployment port 443" >&2
    exit 1
  fi
  if [ "$udp_start:$udp_end" != "$tcp_start:$tcp_end" ]; then
    if [ -n "$allow_port_entries" ]; then
      allow_port_entries="$allow_port_entries, "
    fi
    allow_port_entries="${allow_port_entries}{ start = $udp_start, end = $udp_end }"
  fi
fi

l4_allow_ports=""
if [ -n "$allow_port_entries" ]; then
  l4_allow_ports="allowPorts = [$allow_port_entries]"
fi

sed -e "s/__PLUGIN_TOKEN__/$plugin_key/g" \
    -e "s/__L4_ALLOW_PORTS__/$l4_allow_ports/g" \
    /etc/frp/frps.toml.template > /run/frp/frps.toml
chmod 0400 /run/frp/frps.toml

exec /usr/local/bin/frps -c /run/frp/frps.toml
