import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const nodeEnvironment = process.env.NODE_ENV ?? "production";

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
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

function isDocumentationPlaceholder(host: string): boolean {
  return (
    /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/.test(host) ||
    /(?:^|\.)example(?:\.(?:com|net|org))?$/i.test(host)
  );
}

function publicFrpsHost(): string {
  const value = process.env.PUBLIC_FRPS_HOST?.trim();
  if (!value) {
    if (nodeEnvironment === "production") throw new Error("PUBLIC_FRPS_HOST is required in production");
    return "203.0.113.10";
  }
  if (value.length > 253 || /[\s/\\]/.test(value)) throw new Error("PUBLIC_FRPS_HOST is invalid");
  if (nodeEnvironment === "production" && isDocumentationPlaceholder(value)) {
    throw new Error("PUBLIC_FRPS_HOST must not use a documentation placeholder in production");
  }
  return value;
}

function publicBaseUrl(): string {
  const value = process.env.PUBLIC_BASE_URL?.trim();
  if (!value) {
    if (nodeEnvironment === "production") throw new Error("PUBLIC_BASE_URL is required in production");
    return "https://console.tunnel.example.com";
  }
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    throw new Error("PUBLIC_BASE_URL is invalid");
  }
  if (nodeEnvironment === "production" && isDocumentationPlaceholder(hostname)) {
    throw new Error("PUBLIC_BASE_URL must not use a documentation placeholder in production");
  }
  return value;
}

// FRPS_TLS_CERT_FILE 指向 FRPS 自签证书的公钥 PEM 文件（不是 secret 内容本身）。
// 配置后 /api/v1/public/config 会原样下发该 PEM，客户端据此固定 FRPS 的信任锚。
function frpsTlsCertificatePem(): string | null {
  const path = process.env.FRPS_TLS_CERT_FILE?.trim();
  if (!path) return null;
  const value = readFileSync(path, "utf8");
  if (
    !value.includes("-----BEGIN CERTIFICATE-----") ||
    !value.includes("-----END CERTIFICATE-----") ||
    value.length > 16 * 1024
  ) {
    throw new Error("FRPS_TLS_CERT_FILE must contain a PEM CERTIFICATE block");
  }
  return value;
}

function tunnelDomain(): string {
  const value = process.env.TUNNEL_DOMAIN?.trim().toLowerCase();
  if (!value) {
    if (nodeEnvironment === "production") throw new Error("TUNNEL_DOMAIN is required in production");
    return "tunnel.example.com";
  }
  if (nodeEnvironment === "production" && isDocumentationPlaceholder(value)) {
    throw new Error("TUNNEL_DOMAIN must not use a documentation placeholder in production");
  }
  return value;
}

// 告警 Webhook：可选；配置后必须是 HTTPS 端点，生产环境拒绝文档占位域名。
function alertWebhookUrl(): string | null {
  const value = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ALERT_WEBHOOK_URL is invalid");
  }
  if (url.protocol !== "https:") throw new Error("ALERT_WEBHOOK_URL must use https://");
  if (nodeEnvironment === "production" && isDocumentationPlaceholder(url.hostname)) {
    throw new Error("ALERT_WEBHOOK_URL must not use a documentation placeholder in production");
  }
  return value;
}

// Telegram 告警：token 走 secret 双通道（_FILE 优先于内联），与 chat_id 必须
// 成对配置，只配一半直接启动失败，避免误以为告警已生效。
function alertTelegram(): { botToken: string; chatId: string } | null {
  const botToken = secret("ALERT_TELEGRAM_BOT_TOKEN", "ALERT_TELEGRAM_BOT_TOKEN_FILE", false);
  const chatId = process.env.ALERT_TELEGRAM_CHAT_ID?.trim() ?? "";
  if (!botToken && !chatId) return null;
  if (!botToken || !chatId) {
    throw new Error("ALERT_TELEGRAM_BOT_TOKEN(_FILE) and ALERT_TELEGRAM_CHAT_ID must be configured together");
  }
  return { botToken, chatId };
}

const sqlitePath = process.env.SQLITE_PATH?.trim() || "/data/home-tunnel.db";

export const config = {
  nodeEnv: nodeEnvironment,
  port: integer("PORT", 8080),
  publicBaseUrl: publicBaseUrl(),
  downloadsDirectory: process.env.DOWNLOADS_DIRECTORY ?? "/app/downloads",
  tunnelDomain: tunnelDomain(),
  publicFrpsHost: publicFrpsHost(),
  publicFrpsPort: integer("PUBLIC_FRPS_PORT", 7000),
  frpsTlsCertificatePem: frpsTlsCertificatePem(),
  cookieSecure: boolean("COOKIE_SECURE", true),
  database: {
    path: sqlitePath,
  },
  backup: {
    // Empty means "no usable target": backups stay disabled for in-memory
    // databases unless BACKUP_DIRECTORY points somewhere explicitly.
    directory:
      process.env.BACKUP_DIRECTORY?.trim() ||
      (sqlitePath === ":memory:" ? "" : join(dirname(sqlitePath), "backups")),
    // 0 disables the scheduler; the cap keeps the interval inside the 32-bit
    // millisecond range accepted by setInterval.
    intervalHours: Math.min(nonNegativeInteger("BACKUP_INTERVAL_HOURS", 24), 168),
    retentionCount: integer("BACKUP_RETENTION_COUNT", 7),
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
  passwordHashConcurrency: Math.min(integer("PASSWORD_HASH_CONCURRENCY", 1), 4),
  passwordHashQueueMax: Math.min(integer("PASSWORD_HASH_QUEUE_MAX", 32), 256),
  onlineLeaseSeconds: Math.min(integer("ONLINE_LEASE_SECONDS", 24 * 60 * 60), 24 * 60 * 60),
  offlineLeaseMaxSeconds: Math.min(integer("OFFLINE_LEASE_MAX_SECONDS", 24 * 60 * 60), 24 * 60 * 60),
  policySnapshotSeconds: Math.min(integer("POLICY_SNAPSHOT_SECONDS", 24 * 60 * 60), 24 * 60 * 60),
  gatewayHealthUrl: process.env.GATEWAY_HEALTH_URL ?? "http://home-tunnel-traffic-gateway:8080/healthz",
  frpsHost: process.env.FRPS_HOST ?? "home-tunnel-frps",
  frpsPort: integer("FRPS_PORT", 7000),
  caddyHost: process.env.CADDY_HOST ?? "caddy",
  caddyPort: integer("CADDY_PORT", 80),
  backupStatusFile: process.env.BACKUP_STATUS_FILE ?? "/run/home-tunnel-status/backup.json",
  alerts: {
    webhookUrl: alertWebhookUrl(),
    telegram: alertTelegram(),
  },
};
