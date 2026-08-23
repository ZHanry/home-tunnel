#!/bin/sh
set -eu
umask 077

if [ "$#" -lt 2 ] || [ "$#" -gt 4 ]; then
  echo "usage: $0 TUNNEL_DOMAIN FRPS_PUBLIC_HOST [CONSOLE_HOST] [ACME_EMAIL]" >&2
  exit 64
fi

tunnel_domain="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/^\.*//;s/\.*$//')"
frps_public_host="$2"
case "$frps_public_host" in
  \[*\]) frps_public_host="$(printf '%s' "$frps_public_host" | sed 's/^\[//;s/\]$//')" ;;
esac
console_host="${3:-console.$tunnel_domain}"
acme_email="${4:-admin@$tunnel_domain}"

printf '%s' "$tunnel_domain" | grep -Eq '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$' || { echo "invalid tunnel domain" >&2; exit 64; }
printf '%s' "$console_host" | grep -Eq '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$' || { echo "invalid console host" >&2; exit 64; }
case "$frps_public_host" in
  *:*)
    if [ "${#frps_public_host}" -gt 45 ] ||
      ! printf '%s' "$frps_public_host" | grep -Eq '^[0-9A-Fa-f:.]+$' ||
      ! printf '%s' "$frps_public_host" | grep -Eq '[0-9A-Fa-f]'; then
      echo "invalid FRPS IPv6 address" >&2
      exit 64
    fi
    ;;
  *)
    printf '%s' "$frps_public_host" | grep -Eq '^[A-Za-z0-9.-]{1,253}$' ||
      { echo "invalid FRPS host" >&2; exit 64; }
    ;;
esac
printf '%s' "$acme_email" | grep -Eq '^[^[:space:]@]+@[^[:space:]@]+$' || { echo "invalid ACME email" >&2; exit 64; }

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
deploy_root="$(dirname "$script_dir")"
workspace_root="$(dirname "$deploy_root")"
environment_path="$workspace_root/.env"
secret_root="$deploy_root/secrets"

if [ -e "$environment_path" ] || [ -e "$secret_root" ]; then
  echo "local configuration already exists; refusing to overwrite it" >&2
  exit 73
fi
command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 69; }

install -d -m 0700 "$secret_root"
openssl rand -hex 32 > "$secret_root/internal_service_key"
openssl rand -hex 32 > "$secret_root/frps_plugin_key"
openssl rand -hex 32 > "$secret_root/lease_signing_key"
printf 'Ht-%s-A7!\n' "$(openssl rand -hex 18)" > "$secret_root/bootstrap_admin_password"

# Ten-year self-signed FRPS TLS certificate: the control center serves the
# public part through /api/v1/public/config so managed clients can pin the
# FRPS identity. Skip generation when both files already exist (idempotent).
if [ ! -e "$secret_root/frps_tls_cert.pem" ] || [ ! -e "$secret_root/frps_tls_key.pem" ]; then
  case "$frps_public_host" in
    *:*) frps_tls_san="IP:$frps_public_host" ;;
    *[!0-9.]*) frps_tls_san="DNS:$frps_public_host" ;;
    *) frps_tls_san="IP:$frps_public_host,DNS:$frps_public_host" ;;
  esac
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -sha256 \
    -days 3650 -nodes \
    -keyout "$secret_root/frps_tls_key.pem" \
    -out "$secret_root/frps_tls_cert.pem" \
    -subj "/CN=$frps_public_host" \
    -addext "subjectAltName=$frps_tls_san" 2>/dev/null
fi
# Secret files must stay readable by the non-root container user (uid 10001):
# compose bind mounts them with host ownership, so 0600 root-owned files would be
# unreadable inside the containers. World-read 0644 on the files is safe because
# the 0700 directory above already blocks other host users from reaching them
# (bind mount path resolution is done by the docker daemon, not the container).
chmod 0644 "$secret_root"/*
chmod 0700 "$secret_root"

cat > "$environment_path" <<EOF
HOME_TUNNEL_VERSION=3.2.0-rc.3
HOME_TUNNEL_CONSOLE_HOST=$console_host
HOME_TUNNEL_TUNNEL_DOMAIN=$tunnel_domain
HOME_TUNNEL_PUBLIC_BASE_URL=https://$console_host
HOME_TUNNEL_FRPS_PUBLIC_HOST=$frps_public_host
HOME_TUNNEL_FRPS_BIND_ADDRESS=0.0.0.0
HOME_TUNNEL_FRPS_PORT=7000
HOME_TUNNEL_TCP_BIND_ADDRESS=0.0.0.0
HOME_TUNNEL_TCP_PORT_START=10000
HOME_TUNNEL_TCP_PORT_END=10099
HOME_TUNNEL_UDP_BIND_ADDRESS=0.0.0.0
HOME_TUNNEL_UDP_PORT_START=10000
HOME_TUNNEL_UDP_PORT_END=10099
HOME_TUNNEL_L4_BIND_ADDRESS=0.0.0.0
HOME_TUNNEL_L4_PORT_START=10000
HOME_TUNNEL_L4_PORT_END=10099
HOME_TUNNEL_ACME_EMAIL=$acme_email
HOME_TUNNEL_BOOTSTRAP_ADMIN_USERNAME=admin
EOF
chmod 0600 "$environment_path"

echo "Created $environment_path and the secret files below $secret_root"
echo "Read deploy/secrets/bootstrap_admin_password locally for the one-time password."
