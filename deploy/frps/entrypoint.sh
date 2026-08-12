#!/bin/sh
set -eu
umask 077

plugin_key="$(tr -d '\r\n' < /run/secrets/frps_plugin_key)"
case "$plugin_key" in
  ''|*[!0-9a-f]*) echo "FRPS plugin key must be non-empty lowercase hexadecimal" >&2; exit 1 ;;
esac

mkdir -p /run/frp
tcp_allow_ports=""
if [ "${TCP_TUNNEL_ENABLED:-false}" = "true" ]; then
  tcp_start="${TCP_PORT_START:-10000}"
  tcp_end="${TCP_PORT_END:-10099}"
  case "$tcp_start:$tcp_end" in
    *[!0-9:]*|:*|*:) echo "TCP port range must contain integers" >&2; exit 1 ;;
  esac
  if [ "$tcp_start" -lt 1 ] || [ "$tcp_end" -gt 65535 ] || [ "$tcp_start" -gt "$tcp_end" ]; then
    echo "TCP port range is invalid" >&2
    exit 1
  fi
  tcp_allow_ports="allowPorts = [{ start = $tcp_start, end = $tcp_end }]"
fi

sed -e "s/__PLUGIN_TOKEN__/$plugin_key/g" \
    -e "s/__TCP_ALLOW_PORTS__/$tcp_allow_ports/g" \
    /etc/frp/frps.toml.template > /run/frp/frps.toml
chmod 0400 /run/frp/frps.toml

exec /usr/local/bin/frps -c /run/frp/frps.toml
