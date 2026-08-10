#!/bin/sh
set -eu
umask 077

output="${1:-}"
[ -n "$output" ] || { echo "usage: probe-existing.sh OUTPUT" >&2; exit 1; }
mkdir -p "$(dirname "$output")"
temporary="$(mktemp "$(dirname "$output")/.probe.XXXXXX")"
cleanup() { rm -f "$temporary"; }
trap cleanup EXIT HUP INT TERM

for domain in ${HOME_TUNNEL_EXISTING_PROBE_DOMAINS:-}; do
  https_status="$(curl --silent --show-error --location --max-time 20 --output /dev/null --write-out '%{http_code}' "https://$domain/")"
  http_status="$(curl --silent --show-error --max-time 20 --output /dev/null --write-out '%{http_code}' "http://$domain/")"
  fingerprint="$(printf '\n' | openssl s_client -servername "$domain" -connect "$domain:443" 2>/dev/null | openssl x509 -noout -fingerprint -sha256 | cut -d= -f2)"
  [ "$https_status" != "000" ] && [ -n "$fingerprint" ] || { echo "Probe failed for $domain" >&2; exit 1; }
  printf '%s\t%s\t%s\t%s\n' "$domain" "$http_status" "$https_status" "$fingerprint" >> "$temporary"
done
chmod 0600 "$temporary"
mv "$temporary" "$output"
