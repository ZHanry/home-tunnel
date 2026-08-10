#!/bin/sh
set -eu
umask 077

plugin_key="$(tr -d '\r\n' < /run/secrets/frps_plugin_key)"
case "$plugin_key" in
  ''|*[!0-9a-f]*) echo "FRPS plugin key must be non-empty lowercase hexadecimal" >&2; exit 1 ;;
esac

mkdir -p /run/frp
sed "s/__PLUGIN_TOKEN__/$plugin_key/g" /etc/frp/frps.toml.template > /run/frp/frps.toml
chmod 0400 /run/frp/frps.toml

exec /usr/local/bin/frps -c /run/frp/frps.toml
