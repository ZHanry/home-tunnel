import { readFileSync } from "node:fs";

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

function secret(name: string, fileName: string, required = true): string {
  const inline = process.env[name]?.trim();
  if (inline) return inline;
  const path = process.env[fileName]?.trim();
  if (path) {
    const value = readFileSync(path, "utf8").trim();
    if (value) return value;
  }
  if (required) throw new Error(`${name} or ${fileName} is required`);
  return "";
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "production",
  port: integer("PORT", 8080),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "https://console.tunnel.example.com",
  downloadsDirectory: process.env.DOWNLOADS_DIRECTORY ?? "/app/downloads",
  tunnelDomain: (process.env.TUNNEL_DOMAIN ?? "tunnel.example.com").toLowerCase(),
  publicFrpsHost: process.env.PUBLIC_FRPS_HOST ?? "203.0.113.10",
  publicFrpsPort: integer("PUBLIC_FRPS_PORT", 7000),
  cookieSecure: boolean("COOKIE_SECURE", true),
  database: {
    host: process.env.PGHOST ?? "postgres",
    port: integer("PGPORT", 5432),
    database: process.env.PGDATABASE ?? "home_tunnel",
    user: process.env.PGUSER ?? "home_tunnel",
    password: secret("PGPASSWORD", "PGPASSWORD_FILE"),
    max: integer("PGPOOL_MAX", 10),
  },
  internalServiceKey: secret("INTERNAL_SERVICE_KEY", "INTERNAL_SERVICE_KEY_FILE"),
  frpsPluginKey: secret("FRPS_PLUGIN_KEY", "FRPS_PLUGIN_KEY_FILE"),
  leaseSigningKey: secret("LEASE_SIGNING_KEY", "LEASE_SIGNING_KEY_FILE"),
  bootstrapAdminPassword: secret(
    "BOOTSTRAP_ADMIN_PASSWORD",
    "BOOTSTRAP_ADMIN_PASSWORD_FILE",
    false,
  ),
  bootstrapAdminUsername: (process.env.BOOTSTRAP_ADMIN_USERNAME ?? "admin").toLowerCase(),
  accessTokenSeconds: integer("ACCESS_TOKEN_SECONDS", 15 * 60),
  refreshTokenSeconds: integer("REFRESH_TOKEN_SECONDS", 30 * 24 * 60 * 60),
  temporaryPasswordSeconds: integer("TEMPORARY_PASSWORD_SECONDS", 72 * 60 * 60),
  onlineLeaseSeconds: Math.min(integer("ONLINE_LEASE_SECONDS", 24 * 60 * 60), 24 * 60 * 60),
  offlineLeaseMaxSeconds: Math.min(integer("OFFLINE_LEASE_MAX_SECONDS", 24 * 60 * 60), 24 * 60 * 60),
  policySnapshotSeconds: Math.min(integer("POLICY_SNAPSHOT_SECONDS", 24 * 60 * 60), 24 * 60 * 60),
  gatewayHealthUrl: process.env.GATEWAY_HEALTH_URL ?? "http://home-tunnel-traffic-gateway:8080/healthz",
  frpsHost: process.env.FRPS_HOST ?? "home-tunnel-frps",
  frpsPort: integer("FRPS_PORT", 7000),
  caddyHost: process.env.CADDY_HOST ?? "caddy",
  caddyPort: integer("CADDY_PORT", 80),
  backupStatusFile: process.env.BACKUP_STATUS_FILE ?? "/run/home-tunnel-status/backup.json",
};
