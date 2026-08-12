import { Router, type Response } from "express";
import { z } from "zod";
import { backupLastSuccessAt } from "../backup.js";
import { config } from "../config.js";
import { databaseEvents, one, query, transaction } from "../db.js";
import { parseStoredAllowlist } from "../domain.js";
import { asyncHandler, HttpError, httpRequestCounts } from "../http.js";
import { alertDeliveryCounts } from "../notifications.js";
import { getWebsocketClientCount } from "../realtime.js";
import { constantTimeStringEqual, verifyLease } from "../security.js";
import { parseBody } from "../validation.js";

const router = Router();
const consoleDomain = new URL(config.publicBaseUrl).hostname.toLowerCase();

router.get(
  "/tls/allow",
  asyncHandler(async (request, response) => {
    const domain = String(request.query.domain ?? "").trim().toLowerCase();
    if (domain === consoleDomain) {
      response.status(204).end();
      return;
    }
    const suffix = `.${config.tunnelDomain}`;
    if (!domain.endsWith(suffix)) {
      response.status(404).end();
      return;
    }
    const subdomain = domain.slice(0, -suffix.length);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
      response.status(404).end();
      return;
    }
    // 被配额挂起的用户等价于不可用：与策略快照的 enabled 条件保持一致，
    // 不再为其子域授权证书签发。
    const allowed = await one<{ ok: number }>(
      `SELECT 1 AS ok FROM connections c
         JOIN users u ON u.id=c.user_id JOIN devices d ON d.id=c.device_id
        WHERE lower(c.subdomain)=lower(?) AND c.deleted_at IS NULL AND c.enabled=true
          AND u.status='active' AND u.quota_suspended_at IS NULL AND d.status='active' LIMIT 1`,
      [subdomain],
    );
    response.status(allowed?.ok === 1 ? 204 : 404).end();
  }),
);

function requireInternalKey(value: string | undefined): void {
  if (!value || !constantTimeStringEqual(value, config.internalServiceKey)) {
    throw new HttpError(401, "AUTH_INVALID", "内部服务认证失败");
  }
}

router.get(
  "/policies/events",
  asyncHandler(async (request, response) => {
    requireInternalKey(request.header("x-home-tunnel-key"));
    response.status(200);
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("connection", "keep-alive");
    response.flushHeaders();
    response.write("retry: 3000\nevent: ready\ndata: {}\n\n");

    const notify = () => {
      if (!response.destroyed) response.write(`event: policy\ndata: {"at":"${new Date().toISOString()}"}\n\n`);
    };
    const keepalive = setInterval(() => {
      if (!response.destroyed) response.write(`: keepalive ${Date.now()}\n\n`);
    }, 30_000);
    keepalive.unref();
    databaseEvents.on("outbox", notify);
    request.once("close", () => {
      clearInterval(keepalive);
      databaseEvents.off("outbox", notify);
    });
  }),
);

router.get(
  "/policies/sync",
  asyncHandler(async (request, response) => {
    requireInternalKey(request.header("x-home-tunnel-key"));
    const revision = await one<{ revision: string }>("SELECT COALESCE(max(id),0) AS revision FROM outbox_events");
    const revisionNumber = Number(revision?.revision ?? 0);
    const etag = `"${revisionNumber}"`;
    const expiresAt = new Date(Date.now() + config.policySnapshotSeconds * 1000);
    response.setHeader("cache-control", "no-store");
    response.setHeader("etag", etag);
    response.setHeader("x-policy-snapshot-expires-at", expiresAt.toISOString());
    const knownRevisions = (request.header("if-none-match") ?? "").split(",").map((value) => value.trim());
    if (knownRevisions.includes(etag)) {
      response.status(304).end();
      return;
    }
    const rows = await query<{
      connection_id: string;
      user_id: string;
      device_id: string;
      subdomain: string;
      enabled: boolean;
      connection_version: string;
      user_status: string;
      user_quota_suspended_at: Date | null;
      device_status: string;
      device_lease_valid: boolean;
      device_lease_expires_at: Date | null;
      access_ip_allowlist: string | null;
      access_basic_user: string | null;
      access_basic_hash: string | null;
      access_policy_version: string;
      connection_limit_bps: string | null;
      connection_burst_bytes: string | null;
      connection_policy_version: string;
      user_limit_bps: string | null;
      user_burst_bytes: string | null;
      user_policy_version: string;
    }>(
      `SELECT c.id AS connection_id,c.user_id,c.device_id,c.subdomain,c.enabled,
              c.version AS connection_version,u.status AS user_status,
              u.quota_suspended_at AS user_quota_suspended_at,d.status AS device_status,
              (d.lease_expires_at IS NOT NULL AND d.lease_expires_at > home_tunnel_now()) AS device_lease_valid,
              d.lease_expires_at AS device_lease_expires_at,
              c.access_ip_allowlist,c.access_basic_user,c.access_basic_hash,c.access_policy_version,
              cp.bandwidth_limit_bps AS connection_limit_bps,cp.burst_bytes AS connection_burst_bytes,
              cp.version AS connection_policy_version,
              up.bandwidth_limit_bps AS user_limit_bps,up.burst_bytes AS user_burst_bytes,
              up.version AS user_policy_version
         FROM connections c JOIN users u ON u.id=c.user_id JOIN devices d ON d.id=c.device_id
         LEFT JOIN traffic_policies cp ON cp.scope_type='connection' AND cp.scope_id=c.id
         LEFT JOIN traffic_policies up ON up.scope_type='user' AND up.scope_id=u.id
        WHERE c.deleted_at IS NULL`,
    );
    response.json({
      revision: revisionNumber,
      generated_at: new Date().toISOString(),
      snapshot_expires_at: expiresAt.toISOString(),
      tunnel_domain: config.tunnelDomain,
      connections: rows.map((row) => ({
        connection_id: row.connection_id,
        user_id: row.user_id,
        device_id: row.device_id,
        subdomain: row.subdomain,
        // 配额挂起是网关层软停用：enabled 多条件 AND 中加入
        // quota_suspended_at IS NULL，连接与设备配置本身保持不变。
        enabled:
          row.enabled &&
          row.user_status === "active" &&
          row.user_quota_suspended_at == null &&
          row.device_status === "active" &&
          row.device_lease_valid,
        device_lease_expires_at: row.device_lease_expires_at?.toISOString() ?? null,
        connection_version: Number(row.connection_version),
        access_ip_allowlist: parseStoredAllowlist(row.access_ip_allowlist),
        access_basic_user: row.access_basic_user ?? null,
        access_basic_hash: row.access_basic_hash ?? null,
        access_policy_version: Number(row.access_policy_version ?? 1),
        connection_limit_bps:
          row.connection_limit_bps == null ? null : Number(row.connection_limit_bps),
        connection_burst_bytes:
          row.connection_burst_bytes == null ? null : Number(row.connection_burst_bytes),
        connection_policy_version: Number(row.connection_policy_version ?? 1),
        user_limit_bps: row.user_limit_bps == null ? null : Number(row.user_limit_bps),
        user_burst_bytes: row.user_burst_bytes == null ? null : Number(row.user_burst_bytes),
        user_policy_version: Number(row.user_policy_version ?? 1),
      })),
    });
  }),
);

router.post(
  "/traffic/samples",
  asyncHandler(async (request, response) => {
    requireInternalKey(request.header("x-home-tunnel-key"));
    const body = parseBody(
      z.object({
        batch_id: z.string().uuid(),
        samples: z
          .array(
            z.object({
              bucket_start: z.string().datetime(),
              bucket_seconds: z.number().int().min(1).max(3600),
              user_id: z.string().uuid(),
              device_id: z.string().uuid(),
              connection_id: z.string().uuid(),
              upload_bytes: z.number().int().min(0),
              download_bytes: z.number().int().min(0),
              request_count: z.number().int().min(0),
              error_count: z.number().int().min(0),
            }),
          )
          .max(1000),
      }),
      request.body,
    );
    const accepted = await transaction(async (client) => {
      const connectionIds = [...new Set(body.samples.map((sample) => sample.connection_id))];
      const parameters = connectionIds.map(() => "?").join(",");
      const subjects = connectionIds.length
        ? await client.query<{ id: string; user_id: string; device_id: string }>(
            `SELECT id,user_id,device_id FROM connections
              WHERE deleted_at IS NULL AND id IN (${parameters})`,
            connectionIds,
          )
        : { rows: [], rowCount: 0 };
      const byConnection = new Map(subjects.rows.map((subject) => [subject.id, subject]));
      const earliest = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const latest = Date.now() + 5 * 60 * 1000;
      let acceptedCount = 0;
      const deduplicated = new Map<string, (typeof body.samples)[number]>();
      for (const sample of body.samples) {
        const subject = byConnection.get(sample.connection_id);
        const timestamp = Date.parse(sample.bucket_start);
        if (
          !subject ||
          subject.user_id !== sample.user_id ||
          subject.device_id !== sample.device_id ||
          timestamp < earliest ||
          timestamp > latest
        ) continue;
        acceptedCount += 1;
        const key = `${sample.connection_id}:${sample.bucket_start}:${sample.bucket_seconds}`;
        const previous = deduplicated.get(key);
        deduplicated.set(key, previous ? {
          ...sample,
          upload_bytes: Math.max(previous.upload_bytes, sample.upload_bytes),
          download_bytes: Math.max(previous.download_bytes, sample.download_bytes),
          request_count: Math.max(previous.request_count, sample.request_count),
          error_count: Math.max(previous.error_count, sample.error_count),
        } : sample);
      }
      for (const sample of deduplicated.values()) {
        await client.query(
          `INSERT INTO traffic_samples(
             batch_id,bucket_start,bucket_seconds,user_id,device_id,connection_id,
             upload_bytes,download_bytes,request_count,error_count)
           VALUES(?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(connection_id,bucket_start,bucket_seconds) DO UPDATE SET
             upload_bytes=max(traffic_samples.upload_bytes,excluded.upload_bytes),
             download_bytes=max(traffic_samples.download_bytes,excluded.download_bytes),
             request_count=max(traffic_samples.request_count,excluded.request_count),
             error_count=max(traffic_samples.error_count,excluded.error_count)`,
          [
            body.batch_id,
            sample.bucket_start,
            sample.bucket_seconds,
            sample.user_id,
            sample.device_id,
            sample.connection_id,
            sample.upload_bytes,
            sample.download_bytes,
            sample.request_count,
            sample.error_count,
          ],
        );
      }
      return acceptedCount;
    });
    response.status(202).json({
      accepted,
      dropped: body.samples.length - accepted,
      batch_id: body.batch_id,
    });
  }),
);

type PluginContent = Record<string, unknown>;

type PluginUser = {
  deviceId: string;
  metas: Record<string, unknown>;
  runId: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pluginUser(content: PluginContent): PluginUser {
  const user = record(content.user);
  return {
    deviceId: text(user.user),
    metas: record(user.metas ?? user.metadatas),
    runId: text(user.run_id ?? user.runId),
  };
}

function leaseFromMetas(metas: Record<string, unknown>) {
  return verifyLease(text(metas.home_tunnel_lease ?? metas.lease));
}

async function activePluginSubject(user: PluginUser) {
  const lease = leaseFromMetas(user.metas);
  if (!lease || !user.deviceId || lease.device_id !== user.deviceId) return null;
  const subject = await one<{
    device_status: string;
    user_status: string;
    token_version: string;
    config_version: string;
  }>(
    `SELECT d.status AS device_status,u.status AS user_status,u.token_version,d.config_version
       FROM devices d JOIN users u ON u.id=d.user_id WHERE d.id=? AND d.user_id=?`,
    [lease.device_id, lease.user_id],
  );
  if (
    !subject ||
    subject.device_status !== "active" ||
    subject.user_status !== "active" ||
    Number(subject.token_version) !== lease.token_version ||
    Number(subject.config_version) !== lease.config_version
  ) {
    return null;
  }
  return { lease, subject };
}

function pluginAccept(response: Response, content?: unknown): void {
  response.json({ reject: false, unchange: true, ...(content === undefined ? {} : { content }) });
}

function pluginReject(response: Response, reason: string): void {
  response.json({ reject: true, reject_reason: reason, unchange: true });
}

// Restores a validated 32-hex compact id to canonical UUID form so lookups can
// use an indexed equality on connections.id instead of replace(id,'-','').
function compactIdToUuid(compact: string): string {
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function parseProxyName(proxyName: string): { connectionId: string; version: number } | null {
  const match = proxyName.match(/^ht_([0-9a-f]{32})_v([1-9][0-9]*)$/i);
  if (!match?.[1] || !match[2]) return null;
  return { connectionId: compactIdToUuid(match[1].toLowerCase()), version: Number(match[2]) };
}

function parseManagedProxyName(proxyName: string, deviceId: string) {
  const prefix = `${deviceId}.`;
  if (!deviceId || !proxyName.startsWith(prefix)) return null;
  return parseProxyName(proxyName.slice(prefix.length));
}

router.post(
  "/frps/plugin/:token",
  asyncHandler(async (request, response) => {
    const pluginKey = String(request.params.token ?? "");
    if (!pluginKey || !constantTimeStringEqual(pluginKey, config.frpsPluginKey)) {
      pluginReject(response, "PLUGIN_AUTH_INVALID");
      return;
    }
    const body = record(request.body);
    const op = text(body.op);
    const content = record(body.content) as PluginContent;
    if (op === "Login") {
      const metas = record(content.metas ?? content.metadatas);
      const lease = leaseFromMetas(metas);
      const deviceId = text(content.user || metas.device_id);
      if (!lease || !deviceId || lease.device_id !== deviceId) {
        pluginReject(response, "LEASE_INVALID");
        return;
      }
      const subject = await one<{
        device_status: string;
        user_status: string;
        token_version: string;
        config_version: string;
      }>(
        `SELECT d.status AS device_status,u.status AS user_status,u.token_version,d.config_version
           FROM devices d JOIN users u ON u.id=d.user_id WHERE d.id=? AND d.user_id=?`,
        [lease.device_id, lease.user_id],
      );
      if (!subject || subject.user_status !== "active") {
        pluginReject(response, "USER_DISABLED");
        return;
      }
      if (subject.device_status !== "active") {
        pluginReject(response, "DEVICE_REVOKED");
        return;
      }
      if (
        Number(subject.token_version) !== lease.token_version ||
        Number(subject.config_version) !== lease.config_version
      ) {
        pluginReject(response, "VERSION_STALE");
        return;
      }
      await query(
        "UPDATE devices SET last_seen_at=home_tunnel_now(),lease_expires_at=home_tunnel_from_unix(?),updated_at=home_tunnel_now() WHERE id=?",
        [lease.exp, lease.device_id],
      );
      pluginAccept(response);
      return;
    }

    if (op === "NewProxy") {
      const proxyName = text(content.proxy_name ?? content.proxyName);
      const user = pluginUser(content);
      const deviceId = user.deviceId;
      const parsed = parseManagedProxyName(proxyName, deviceId);
      const activeSubject = await activePluginSubject(user);
      const proxyType = text(content.proxy_type ?? content.proxyType).toLowerCase();
      if (!parsed || !activeSubject || proxyType !== "http") {
        pluginReject(response, "PROXY_NOT_ALLOWED");
        return;
      }
      const connection = await one<{
        id: string;
        user_id: string;
        device_id: string;
        version: string;
        subdomain: string;
        enabled: boolean;
        user_status: string;
        device_status: string;
      }>(
        `SELECT c.id,c.user_id,c.device_id,c.version,c.subdomain,c.enabled,
                u.status AS user_status,d.status AS device_status
           FROM connections c JOIN users u ON u.id=c.user_id JOIN devices d ON d.id=c.device_id
          WHERE c.id=? AND c.deleted_at IS NULL`,
        [parsed.connectionId],
      );
      const requestedSubdomain = text(content.subdomain).toLowerCase();
      const customDomains = Array.isArray(content.custom_domains ?? content.customDomains)
        ? (content.custom_domains ?? content.customDomains) as unknown[]
        : [];
      const customDomainAllowed = customDomains.length === 0 ||
        (customDomains.length === 1 && text(customDomains[0]).toLowerCase() === `${connection?.subdomain}.${config.tunnelDomain}`);
      if (
        !connection ||
        connection.user_id !== activeSubject.lease.user_id ||
        connection.device_id !== deviceId ||
        Number(connection.version) !== parsed.version ||
        !connection.enabled ||
        connection.user_status !== "active" ||
        connection.device_status !== "active" ||
        (requestedSubdomain && requestedSubdomain !== connection.subdomain) ||
        !customDomainAllowed
      ) {
        pluginReject(response, connection && Number(connection.version) !== parsed.version ? "VERSION_STALE" : "PROXY_NOT_ALLOWED");
        return;
      }
      await query(
        `UPDATE runtime_states SET state='Applying',observed_at=home_tunnel_now(),updated_at=home_tunnel_now()
          WHERE connection_id=? AND desired_version=?`,
        [connection.id, parsed.version],
      );
      pluginAccept(response);
      return;
    }

    if (op === "Ping") {
      const user = pluginUser(content);
      const activeSubject = await activePluginSubject(user);
      if (!activeSubject) {
        pluginReject(response, "LEASE_EXPIRED");
        return;
      }
      await query("UPDATE devices SET last_seen_at=home_tunnel_now(),updated_at=home_tunnel_now() WHERE id=?", [user.deviceId]);
      pluginAccept(response);
      return;
    }

    if (op === "CloseProxy") {
      const user = pluginUser(content);
      const parsed = parseManagedProxyName(text(content.proxy_name ?? content.proxyName), user.deviceId);
      if (!parsed || !user.deviceId) {
        pluginReject(response, "SUBJECT_MISMATCH");
        return;
      }
      const result = await query<{ connection_id: string }>(
        `UPDATE runtime_states SET state='Offline',observed_at=home_tunnel_now(),updated_at=home_tunnel_now()
          WHERE desired_version=? AND connection_id IN (
            SELECT id FROM connections WHERE id=? AND device_id=?
          ) RETURNING connection_id`,
        [parsed.version, parsed.connectionId, user.deviceId],
      );
      if (!result[0]) {
        pluginReject(response, "SUBJECT_MISMATCH");
        return;
      }
      pluginAccept(response);
      return;
    }

    pluginReject(response, "OP_NOT_SUPPORTED");
  }),
);

router.get(
  "/health/dependencies",
  asyncHandler(async (request, response) => {
    requireInternalKey(request.header("x-home-tunnel-key"));
    const database = await one<{ ok: number }>("SELECT 1 AS ok");
    response.json({
      status: database?.ok === 1 ? "healthy" : "unhealthy",
      components: [{ component: "sqlite", status: database?.ok === 1 ? "healthy" : "unhealthy" }],
      at: new Date().toISOString(),
    });
  }),
);

router.get(
  "/metrics",
  asyncHandler(async (request, response) => {
    requireInternalKey(request.header("x-home-tunnel-key"));
    // A single static aggregate statement so the prepared-statement cache in
    // db.ts serves every scrape after the first one.
    const totals = await one<{
      users_total: number;
      devices_total: number;
      connections_enabled: number;
      connections_disabled: number;
      connections_access_protected: number;
      active_sessions: number;
      quota_suspended_users: number;
      devices_offline: number;
    }>(
      `SELECT
        (SELECT count(*) FROM users) AS users_total,
        (SELECT count(*) FROM devices) AS devices_total,
        (SELECT count(*) FROM connections WHERE deleted_at IS NULL AND enabled=true) AS connections_enabled,
        (SELECT count(*) FROM connections WHERE deleted_at IS NULL AND enabled=false) AS connections_disabled,
        (SELECT count(*) FROM connections WHERE deleted_at IS NULL
           AND (access_ip_allowlist IS NOT NULL OR access_basic_user IS NOT NULL)) AS connections_access_protected,
        (SELECT count(*) FROM sessions WHERE revoked_at IS NULL AND access_expires_at > home_tunnel_now()) AS active_sessions,
        (SELECT count(*) FROM users WHERE quota_suspended_at IS NOT NULL) AS quota_suspended_users,
        (SELECT count(*) FROM devices WHERE offline_alerted_at IS NOT NULL) AS devices_offline`,
    );
    const requests = httpRequestCounts();
    const alerts = alertDeliveryCounts();
    const backupTimestampSeconds = Math.floor(backupLastSuccessAt() / 1000);
    const lines = [
      "# HELP home_tunnel_up Control center process is serving requests.",
      "# TYPE home_tunnel_up gauge",
      "home_tunnel_up 1",
      "# HELP home_tunnel_uptime_seconds Seconds since the control center process started.",
      "# TYPE home_tunnel_uptime_seconds gauge",
      `home_tunnel_uptime_seconds ${Math.floor(process.uptime())}`,
      "# HELP home_tunnel_users_total Number of user accounts.",
      "# TYPE home_tunnel_users_total gauge",
      `home_tunnel_users_total ${Number(totals?.users_total ?? 0)}`,
      "# HELP home_tunnel_devices_total Number of registered devices.",
      "# TYPE home_tunnel_devices_total gauge",
      `home_tunnel_devices_total ${Number(totals?.devices_total ?? 0)}`,
      "# HELP home_tunnel_connections_total Number of non-deleted connections by enabled flag.",
      "# TYPE home_tunnel_connections_total gauge",
      `home_tunnel_connections_total{enabled="true"} ${Number(totals?.connections_enabled ?? 0)}`,
      `home_tunnel_connections_total{enabled="false"} ${Number(totals?.connections_disabled ?? 0)}`,
      "# HELP home_tunnel_connections_access_protected_total Non-deleted connections with an IP allowlist or Basic Auth gate.",
      "# TYPE home_tunnel_connections_access_protected_total gauge",
      `home_tunnel_connections_access_protected_total ${Number(totals?.connections_access_protected ?? 0)}`,
      "# HELP home_tunnel_active_sessions_total Number of sessions that are neither revoked nor expired.",
      "# TYPE home_tunnel_active_sessions_total gauge",
      `home_tunnel_active_sessions_total ${Number(totals?.active_sessions ?? 0)}`,
      "# HELP home_tunnel_websocket_clients Connected realtime WebSocket clients.",
      "# TYPE home_tunnel_websocket_clients gauge",
      `home_tunnel_websocket_clients ${getWebsocketClientCount()}`,
      "# HELP home_tunnel_http_requests_total HTTP responses grouped by status class.",
      "# TYPE home_tunnel_http_requests_total counter",
      `home_tunnel_http_requests_total{class="2xx"} ${requests["2xx"]}`,
      `home_tunnel_http_requests_total{class="3xx"} ${requests["3xx"]}`,
      `home_tunnel_http_requests_total{class="4xx"} ${requests["4xx"]}`,
      `home_tunnel_http_requests_total{class="5xx"} ${requests["5xx"]}`,
      "# HELP home_tunnel_backup_last_success_timestamp_seconds Unix time of the last successful database backup, 0 when none has completed.",
      "# TYPE home_tunnel_backup_last_success_timestamp_seconds gauge",
      `home_tunnel_backup_last_success_timestamp_seconds ${backupTimestampSeconds}`,
      "# HELP home_tunnel_quota_suspended_users_total Users currently suspended for exceeding the monthly traffic quota.",
      "# TYPE home_tunnel_quota_suspended_users_total gauge",
      `home_tunnel_quota_suspended_users_total ${Number(totals?.quota_suspended_users ?? 0)}`,
      "# HELP home_tunnel_devices_offline_total Devices currently flagged offline by the alert checker.",
      "# TYPE home_tunnel_devices_offline_total gauge",
      `home_tunnel_devices_offline_total ${Number(totals?.devices_offline ?? 0)}`,
      "# HELP home_tunnel_alerts_sent_total Alert delivery attempts by channel and final result.",
      "# TYPE home_tunnel_alerts_sent_total counter",
      `home_tunnel_alerts_sent_total{channel="webhook",result="ok"} ${alerts.webhook.ok}`,
      `home_tunnel_alerts_sent_total{channel="webhook",result="error"} ${alerts.webhook.error}`,
      `home_tunnel_alerts_sent_total{channel="telegram",result="ok"} ${alerts.telegram.ok}`,
      `home_tunnel_alerts_sent_total{channel="telegram",result="error"} ${alerts.telegram.error}`,
    ];
    response.setHeader("cache-control", "no-store");
    // response.end keeps the header exactly as set; response.send would
    // re-order the parameters when appending its own charset.
    response.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
    response.end(`${lines.join("\n")}\n`);
  }),
);

export { router as internalRouter };
