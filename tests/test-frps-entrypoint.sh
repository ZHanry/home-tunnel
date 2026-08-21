#!/bin/sh
set -eu

workspace="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
test_root="$(mktemp -d)"
alpine_image="alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce"
trap 'rm -rf -- "$test_root"' EXIT HUP INT TERM

mkdir -p "$test_root/secrets" "$test_root/bin"
printf '%064d\n' 0 > "$test_root/secrets/frps_plugin_key"
cat > "$test_root/bin/frps" <<'EOF'
#!/bin/sh
set -eu
[ "$1" = "-c" ]
cat "$2"
EOF
chmod 0755 "$test_root/bin/frps"

run_entrypoint() {
  docker run --rm "$@" \
    -v "$workspace/deploy/frps/entrypoint.sh:/work/entrypoint.sh:ro" \
    -v "$workspace/deploy/frps/frps.toml.template:/etc/frp/frps.toml.template:ro" \
    -v "$test_root/secrets/frps_plugin_key:/run/secrets/frps_plugin_key:ro" \
    -v "$test_root/bin:/usr/local/bin:ro" \
    "$alpine_image" /bin/sh /work/entrypoint.sh
}

disabled="$(run_entrypoint)"
printf '%s\n' "$disabled" | grep -Fq 'ops = ["Login", "NewProxy", "CloseProxy", "Ping"]'
if printf '%s\n' "$disabled" | grep -Fq 'allowPorts'; then
  echo "Disabled port tunnels unexpectedly rendered allowPorts" >&2
  exit 1
fi

tcp="$(run_entrypoint -e TCP_TUNNEL_ENABLED=true -e TCP_PORT_START=11000 -e TCP_PORT_END=11009)"
printf '%s\n' "$tcp" | grep -Fq 'allowPorts = [{ start = 11000, end = 11009 }]'

udp="$(run_entrypoint -e UDP_TUNNEL_ENABLED=true -e UDP_PORT_START=12000 -e UDP_PORT_END=12009)"
printf '%s\n' "$udp" | grep -Fq 'allowPorts = [{ start = 12000, end = 12009 }]'

shared="$(run_entrypoint -e L4_TUNNEL_ENABLED=true -e L4_PORT_START=13000 -e L4_PORT_END=13009)"
printf '%s\n' "$shared" | grep -Fq 'allowPorts = [{ start = 13000, end = 13009 }]'
if [ "$(printf '%s\n' "$shared" | grep -Fc '{ start = 13000, end = 13009 }')" -ne 1 ]; then
  echo "Shared TCP/UDP range was not de-duplicated" >&2
  exit 1
fi

split="$(run_entrypoint \
  -e TCP_TUNNEL_ENABLED=true -e TCP_PORT_START=14000 -e TCP_PORT_END=14009 \
  -e UDP_TUNNEL_ENABLED=true -e UDP_PORT_START=15000 -e UDP_PORT_END=15009)"
printf '%s\n' "$split" | grep -Fq 'allowPorts = [{ start = 14000, end = 14009 }, { start = 15000, end = 15009 }]'

if run_entrypoint -e UDP_TUNNEL_ENABLED=true -e UDP_PORT_START=16009 -e UDP_PORT_END=16000 >/dev/null 2>&1; then
  echo "Invalid UDP range was accepted" >&2
  exit 1
fi

if run_entrypoint -e TCP_TUNNEL_ENABLED=yes >/dev/null 2>&1; then
  echo "Invalid transport feature flag was accepted" >&2
  exit 1
fi

if run_entrypoint -e TCP_TUNNEL_ENABLED=true -e TCP_PORT_START=6999 -e TCP_PORT_END=7001 >/dev/null 2>&1; then
  echo "TCP range containing FRPS port 7000 was accepted" >&2
  exit 1
fi

if run_entrypoint -e UDP_TUNNEL_ENABLED=true -e UDP_PORT_START=443 -e UDP_PORT_END=443 >/dev/null 2>&1; then
  echo "UDP range containing Caddy port 443 was accepted" >&2
  exit 1
fi

if run_entrypoint -e PUBLIC_FRPS_PORT=10000 -e TCP_TUNNEL_ENABLED=true -e TCP_PORT_START=10000 -e TCP_PORT_END=10099 >/dev/null 2>&1; then
  echo "TCP range containing the configured public FRPS control port was accepted" >&2
  exit 1
fi

echo "FRPS TCP/UDP entrypoint matrix passed"
