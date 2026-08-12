import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createConnection as createSocketConnection } from "node:net";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import { Router } from "express";
import { z } from "zod";
import { transaction, one, query, pool } from "../db.js";
import {
  asyncHandler,
  audit,
  HttpError,
  parseExpectedVersion,
  pathParam,
  requireAdmin,
  requireCsrf,
  requirePasswordNormal,
} from "../http.js";
import {
  bumpDeviceConfig,
  connectionInputSchema,
  connectionPatchSchema,
  createConnection,
  deleteConnection,
  publicConnection,
  type ConnectionRow,
  updateConnection,
} from "../domain.js";
import { configuredAlertChannels, sendAlert } from "../notifications.js";
import { triggerQuotaEnforcement } from "../quota.js";
import {
  generateTemporaryPassword,
  hashPassword,
  normalizeUsername,
} from "../security.js";
import { nullableBandwidth, nullableMonthlyQuota, parseBody } from "../validation.js";
import { config } from "../config.js";
import { APP_VERSION } from "../version.js";
import {
  applyVerifiedCustomDomain,
  createCustomDomain,
  deleteCustomDomain,
  publicCustomDomain,
  verifyCustomDomainDns,
  type CustomDomainRow,
} from "../custom-domains.js";

const router = Router();

async function tcpHealth(host: string, port: number): Promise<{ status: "healthy" | "unhealthy"; latency_ms: number }> {
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = createSocketConnection({ host, port });
    let settled = false;
    const finish = (status: "healthy" | "unhealthy") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ status, latency_ms: Math.round((performance.now() - started) * 10) / 10 });
    };
    socket.setTimeout(1500);
    socket.once("connect", () => finish("healthy"));
    socket.once("timeout", () => finish("unhealthy"));
    socket.once("error", () => finish("unhealthy"));
  });
}

async function gatewayHealth(): Promise<Record<string, unknown>> {
  const started = performance.now();
  try {
    const response = await fetch(config.gatewayHealthUrl, { signal: AbortSignal.timeout(1800) });
    const payload = await response.json() as { status?: string; revision?: number; policy_age_seconds?: number | null };
    return {
      component: "traffic-gateway",
      status: response.ok && payload.status === "healthy" ? "healthy" : "unhealthy",
      latency_ms: Math.round((performance.now() - started) * 10) / 10,
      revision: payload.revision,
      policy_age_seconds: payload.policy_age_seconds,
    };
  } catch {
    return {
      component: "traffic-gateway",
      status: "unhealthy",
      latency_ms: Math.round((performance.now() - started) * 10) / 10,
    };
  }
}

async function backupHealth(): Promise<Record<string, unknown>> {
  try {
    const status = JSON.parse(await readFile(config.backupStatusFile, "utf8")) as {
      status?: string;
      completed_at?: string;
      sha256?: string;
      size_bytes?: number;
    };
    const completedAt = status.completed_at ? Date.parse(status.completed_at) : Number.NaN;
    const ageSeconds = Number.isFinite(completedAt) ? Math.max(0, Math.round((Date.now() - completedAt) / 1000)) : null;
    return {
      component: "backup",
      status: status.status === "healthy" && ageSeconds != null && ageSeconds <= 36 * 60 * 60 ? "healthy" : "degraded",
      completed_at: status.completed_at,
      age_seconds: ageSeconds,
      size_bytes: status.size_bytes,
      sha256_prefix: status.sha256?.slice(0, 12),
    };
  } catch {
    return { component: "backup", status: "unknown", message: "尚无可验证的备份状态" };
  }
}

function adminGuard(request: Parameters<typeof requireAdmin>[0]) {
  const actor = requireAdmin(request);
  requirePasswordNormal(request);
  requireCsrf(request);
  return actor;
}

// month_to_date_bytes：samples + hourly 两表（不重叠）自 UTC 月初的合计，
// 子查询命中 (user_id,bucket_start) 索引；列表接口 LIMIT 100 规模可接受，
// 详情接口复用同一查询即为精确值。
const userFields = `
  u.id,u.username,u.display_name,u.role,u.status,u.password_state,u.token_version,u.version,
  u.created_at,u.updated_at,u.quota_suspended_at,
  tp.bandwidth_limit_bps,tp.monthly_quota_bytes,tp.version AS policy_version,
  (SELECT count(*) FROM devices d WHERE d.user_id=u.id AND d.status='active') AS device_count,
  (SELECT count(*) FROM connections c WHERE c.user_id=u.id AND c.deleted_at IS NULL) AS connection_count,
  (COALESCE((SELECT sum(ts.upload_bytes+ts.download_bytes) FROM traffic_samples ts
              WHERE ts.user_id=u.id AND ts.bucket_start>=home_tunnel_month_start()),0)
   +COALESCE((SELECT sum(th.upload_bytes+th.download_bytes) FROM traffic_hourly th
              WHERE th.user_id=u.id AND th.bucket_start>=home_tunnel_month_start()),0)) AS month_to_date_bytes`;

type UserSummary = {
  id: string;
  username: string;
  display_name: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  password_state: "normal" | "must_change";
  token_version: string;
  version: string;
  created_at: Date;
  updated_at: Date;
  quota_suspended_at: Date | null;
  bandwidth_limit_bps: string | null;
  monthly_quota_bytes: string | null;
  policy_version: string;
  device_count: number;
  connection_count: number;
  month_to_date_bytes: string | number;
};

// 显式字段白名单：部分调用方把 `UPDATE users ... RETURNING *` 的整行并入
// 该函数入参，逐字段构造可确保 password_hash、quota_warned_at 等内部列
// 永远不会进入 API 响应。
function publicUser(row: UserSummary) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    status: row.status,
    password_state: row.password_state,
    token_version: Number(row.token_version),
    version: Number(row.version),
    created_at: row.created_at,
    updated_at: row.updated_at,
    bandwidth_limit_bps: row.bandwidth_limit_bps == null ? null : Number(row.bandwidth_limit_bps),
    monthly_quota_bytes: row.monthly_quota_bytes == null ? null : Number(row.monthly_quota_bytes),
    month_to_date_bytes: Number(row.month_to_date_bytes ?? 0),
    quota_suspended: row.quota_suspended_at != null,
    policy_version: Number(row.policy_version),
    device_count: Number(row.device_count ?? 0),
    connection_count: Number(row.connection_count ?? 0),
  };
}

router.get(
  "/summary",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const summary = await one<{
      users: number;
      online_devices: number;
      connections: number;
      online_connections: number;
      upload_24h: string;
      download_24h: string;
      high_errors: number;
    }>(
      `SELECT
        (SELECT count(*) FROM users WHERE status='active') AS users,
        (SELECT count(*) FROM devices WHERE status='active' AND last_seen_at > home_tunnel_add_seconds(home_tunnel_now(), -90)) AS online_devices,
        (SELECT count(*) FROM connections WHERE deleted_at IS NULL) AS connections,
        (SELECT count(*) FROM runtime_states WHERE state='Online') AS online_connections,
        COALESCE((SELECT sum(upload_bytes) FROM traffic_samples WHERE bucket_start > home_tunnel_add_seconds(home_tunnel_now(), -86400)),'0') AS upload_24h,
        COALESCE((SELECT sum(download_bytes) FROM traffic_samples WHERE bucket_start > home_tunnel_add_seconds(home_tunnel_now(), -86400)),'0') AS download_24h,
        (SELECT count(*) FROM runtime_states WHERE state='Error') AS high_errors`,
    );
    response.json({
      ...summary,
      upload_24h: Number(summary?.upload_24h ?? 0),
      download_24h: Number(summary?.download_24h ?? 0),
      tcp_tunnels: {
        enabled: config.tcpTunnels.enabled,
        port_start: config.tcpTunnels.portStart,
        port_end: config.tcpTunnels.portEnd,
      },
      at: new Date().toISOString(),
    });
  }),
);

router.get(
  "/users",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const search = String(request.query.search ?? "").trim();
    const rows = await query<UserSummary>(
      `SELECT ${userFields}
         FROM users u LEFT JOIN traffic_policies tp ON tp.scope_type='user' AND tp.scope_id=u.id
        WHERE (?='' OR u.username LIKE '%'||?||'%' OR u.display_name LIKE '%'||?||'%')
        ORDER BY u.created_at DESC LIMIT 100`,
      [search, search, search],
    );
    response.json({ items: rows.map(publicUser) });
  }),
);

router.post(
  "/users",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const body = parseBody(
      z.object({
        username: z.string().trim().min(3).max(64),
        display_name: z.string().trim().min(1).max(120),
        role: z.enum(["admin", "user"]).default("user"),
        bandwidth_limit_bps: nullableBandwidth.optional().default(null),
      }),
      request.body,
    );
    const username = normalizeUsername(body.username);
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
      throw new HttpError(400, "VALIDATION_ERROR", "用户名格式不正确", {
        field_errors: { username: "仅允许小写字母、数字、点、下划线与连字符" },
      });
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const userId = randomUUID();
    const created = await transaction(async (client) => {
      await client.query(
        `INSERT INTO users(
          id,username,display_name,password_hash,password_state,temporary_password_expires_at,role)
         VALUES(?,?,?,?,'must_change',home_tunnel_add_seconds(home_tunnel_now(),?),?)`,
        [userId, username, body.display_name, passwordHash, config.temporaryPasswordSeconds, body.role],
      );
      await client.query(
        `INSERT INTO traffic_policies(id,scope_type,scope_id,bandwidth_limit_bps)
         VALUES(?,'user',?,?)`,
        [randomUUID(), userId, body.bandwidth_limit_bps],
      );
      await audit(client, request, "UserCreated", "User", userId, null, {
        username,
        display_name: body.display_name,
        role: body.role,
        bandwidth_limit_bps: body.bandwidth_limit_bps,
        password_state: "must_change",
      });
      const result = await client.query<UserSummary>(
        `SELECT ${userFields} FROM users u
         LEFT JOIN traffic_policies tp ON tp.scope_type='user' AND tp.scope_id=u.id WHERE u.id=?`,
        [userId],
      );
      return result.rows[0] ?? null;
    });
    response.status(201).json({ user: created ? publicUser(created) : null, temporary_password: temporaryPassword });
  }),
);

router.get(
  "/users/:userId",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const row = await one<UserSummary>(
      `SELECT ${userFields} FROM users u
       LEFT JOIN traffic_policies tp ON tp.scope_type='user' AND tp.scope_id=u.id WHERE u.id=?`,
      [request.params.userId],
    );
    if (!row) throw new HttpError(404, "NOT_FOUND", "用户不存在");
    response.json(publicUser(row));
  }),
);

router.patch(
  "/users/:userId",
  asyncHandler(async (request, response) => {
    const actor = adminGuard(request);
    const userId = pathParam(request, "userId");
    const body = parseBody(
      z.object({
        display_name: z.string().trim().min(1).max(120).optional(),
        role: z.enum(["admin", "user"]).optional(),
        expected_version: z.number().int().positive().optional(),
      }),
      request.body,
    );
    const expectedVersion = parseExpectedVersion(request, body.expected_version);
    if (actor.userId === userId && body.role === "user") {
      throw new HttpError(409, "STATE_CONFLICT", "不能降低当前登录管理员自己的角色");
    }
    const updated = await transaction(async (client) => {
      const beforeResult = await client.query<UserSummary>(
        `SELECT ${userFields} FROM users u
         LEFT JOIN traffic_policies tp ON tp.scope_type='user' AND tp.scope_id=u.id WHERE u.id=?`,
        [userId],
      );
      const before = beforeResult.rows[0];
      if (!before) throw new HttpError(404, "NOT_FOUND", "用户不存在");
      if (Number(before.version) !== expectedVersion) {
        throw new HttpError(409, "VERSION_CONFLICT", "用户已被其他操作修改", {
          current_version: Number(before.version),
          current: publicUser(before),
        });
      }
      const result = await client.query<UserSummary>(
        `UPDATE users SET display_name=?,role=?,version=version+1,updated_at=home_tunnel_now()
          WHERE id=? AND version=? RETURNING *`,
        [body.display_name ?? before.display_name, body.role ?? before.role, userId, expectedVersion],
      );
      if (!result.rows[0]) throw new HttpError(409, "VERSION_CONFLICT", "用户已被其他操作修改");
      await audit(client, request, "UserUpdated", "User", userId, publicUser(before), {
        display_name: result.rows[0].display_name,
        role: result.rows[0].role,
        version: Number(result.rows[0].version),
      });
      return { ...before, ...result.rows[0] };
    });
    response.json(publicUser(updated));
  }),
);

router.post(
  ["/users/:userId/disable", "/users/:userId/enable"],
  asyncHandler(async (request, response) => {
    const actor = adminGuard(request);
    const userId = pathParam(request, "userId");
    const action = request.path.endsWith("/enable") ? "enable" : "disable";
    if (actor.userId === userId && action === "disable") {
      throw new HttpError(409, "STATE_CONFLICT", "不能禁用当前登录管理员");
    }
    const enabled = action === "enable";
    const row = await transaction(async (client) => {
      const before = await client.query<UserSummary>(
        `SELECT ${userFields} FROM users u LEFT JOIN traffic_policies tp
          ON tp.scope_type='user' AND tp.scope_id=u.id WHERE u.id=?`,
        [userId],
      );
      const user = before.rows[0];
      if (!user) throw new HttpError(404, "NOT_FOUND", "用户不存在");
      const updated = await client.query<UserSummary>(
        `UPDATE users SET status=?,token_version=token_version+1,version=version+1,updated_at=home_tunnel_now()
          WHERE id=? RETURNING *`,
        [enabled ? "active" : "disabled", userId],
      );
      if (!enabled) {
        await client.query(
          "UPDATE sessions SET revoked_at=COALESCE(revoked_at,home_tunnel_now()),updated_at=home_tunnel_now() WHERE user_id=?",
          [userId],
        );
        await client.query("UPDATE devices SET lease_expires_at=home_tunnel_now(),updated_at=home_tunnel_now() WHERE user_id=?", [
          userId,
        ]);
      }
      const devices = await client.query<{ id: string }>("SELECT id FROM devices WHERE user_id=? AND status='active'", [
        userId,
      ]);
      for (const device of devices.rows) {
        await bumpDeviceConfig(
          client,
          device.id,
          enabled ? "config.version.changed" : "subject.revoked",
          "User",
          userId,
          Number(updated.rows[0]!.version),
          userId,
          { subject_type: "user", subject_id: userId, action: enabled ? "enable" : "disable" },
        );
      }
      await audit(
        client,
        request,
        enabled ? "UserEnabled" : "UserDisabled",
        "User",
        userId,
        { status: user.status },
        { status: enabled ? "active" : "disabled" },
      );
      return { ...user, ...updated.rows[0] };
    });
    response.status(202).json(publicUser(row));
  }),
);

router.post(
  "/users/:userId/reset-password",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const userId = pathParam(request, "userId");
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE users SET password_hash=?,password_state='must_change',
           temporary_password_expires_at=home_tunnel_add_seconds(home_tunnel_now(),?),token_version=token_version+1,
           version=version+1,updated_at=home_tunnel_now() WHERE id=? RETURNING id`,
        [passwordHash, config.temporaryPasswordSeconds, userId],
      );
      if (!result.rows[0]) throw new HttpError(404, "NOT_FOUND", "用户不存在");
      await client.query(
        "UPDATE sessions SET revoked_at=COALESCE(revoked_at,home_tunnel_now()),updated_at=home_tunnel_now() WHERE user_id=?",
        [userId],
      );
      await audit(client, request, "PasswordReset", "User", userId, null, {
        password_state: "must_change",
      });
    });
    response.json({ temporary_password: temporaryPassword, expires_in_seconds: config.temporaryPasswordSeconds });
  }),
);

router.get(
  "/devices",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const userId = String(request.query.user_id ?? "");
    const status = String(request.query.status ?? "");
    const rows = await query<{
      id: string;
      user_id: string;
      username: string;
      name: string;
      status: string;
      config_version: string;
      applied_config_version: string;
      client_version: string | null;
      agent_version: string | null;
      last_seen_at: Date | null;
      lease_expires_at: Date | null;
      created_at: Date;
    }>(
      `SELECT d.id,d.user_id,u.username,d.name,d.status,d.config_version,
              d.applied_config_version,d.client_version,d.agent_version,d.last_seen_at,d.lease_expires_at,d.created_at
         FROM devices d JOIN users u ON u.id=d.user_id
        WHERE (?='' OR d.user_id=?) AND (?='' OR d.status=?)
        ORDER BY d.last_seen_at DESC NULLS LAST,d.created_at DESC LIMIT 200`,
      [userId, userId, status, status],
    );
    response.json({
      items: rows.map((row) => ({
        ...row,
        config_version: Number(row.config_version),
        applied_config_version: Number(row.applied_config_version),
        online: row.last_seen_at ? Date.now() - row.last_seen_at.getTime() < 90_000 : false,
      })),
    });
  }),
);

const deviceTrafficPurgeBatch = 5_000;

// Drains the two large traffic tables in small committed batches so the global
// database mutex is only held briefly per batch. Rows written concurrently are
// swept up by the final delete transaction in deleteDeviceHandler.
async function purgeDeviceTraffic(deviceId: string): Promise<void> {
  for (;;) {
    const deleted = await transaction(async (client) => {
      const rows = await client.query<{ id: number }>(
        `SELECT id FROM traffic_samples WHERE device_id=? ORDER BY id LIMIT ${deviceTrafficPurgeBatch}`,
        [deviceId],
      );
      if (!rows.rows.length) return 0;
      const ids = rows.rows.map((row) => row.id);
      const result = await client.query(
        `DELETE FROM traffic_samples WHERE id IN (${ids.map(() => "?").join(",")})`,
        ids,
      );
      return result.rowCount;
    });
    if (deleted < deviceTrafficPurgeBatch) break;
    await yieldEventLoop();
  }
  for (;;) {
    const deleted = await transaction(async (client) => {
      const rows = await client.query<{ connection_id: string; bucket_start: Date }>(
        `SELECT connection_id,bucket_start FROM traffic_hourly WHERE device_id=? LIMIT ${deviceTrafficPurgeBatch}`,
        [deviceId],
      );
      if (!rows.rows.length) return 0;
      const tuples = rows.rows.map(() => "(?,?)").join(",");
      const values = rows.rows.flatMap((row) => [row.connection_id, row.bucket_start]);
      const result = await client.query(
        `DELETE FROM traffic_hourly WHERE (connection_id,bucket_start) IN (${tuples})`,
        values,
      );
      return result.rowCount;
    });
    if (deleted < deviceTrafficPurgeBatch) break;
    await yieldEventLoop();
  }
}

const deleteDeviceHandler = asyncHandler(async (request, response) => {
  adminGuard(request);
  const deviceId = pathParam(request, "deviceId");
  const existing = await one<{ id: string }>("SELECT id FROM devices WHERE id=?", [deviceId]);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "设备不存在");
  await purgeDeviceTraffic(deviceId);
  await transaction(async (client) => {
    const current = await client.query<{ id: string; user_id: string; status: string; config_version: string }>(
      "SELECT id,user_id,status,config_version FROM devices WHERE id=?",
      [deviceId],
    );
    const device = current.rows[0];
    if (!device) throw new HttpError(404, "NOT_FOUND", "设备不存在");

    const connections = await client.query<{ id: string }>(
      "SELECT id FROM connections WHERE device_id=?",
      [deviceId],
    );
    const connectionIds = connections.rows.map((connection) => connection.id);

    // Keep the revocation event name for older clients while making deletion the
    // management and storage semantic. The event also advances gateway policy revision.
    await client.query(
      `INSERT INTO outbox_events(event_type,resource_type,resource_id,resource_version,recipient_user_id,recipient_device_id,payload)
       VALUES('subject.revoked','Device',?,?,?,?,?)`,
      [
        deviceId,
        Number(device.config_version) + 1,
        device.user_id,
        deviceId,
        JSON.stringify({ subject_type: "device", subject_id: deviceId, action: "delete", deleted: true }),
      ],
    );

    await client.query("DELETE FROM sessions WHERE device_id=?", [deviceId]);
    // Residual sweep: the bulk of these tables was already purged in batches by
    // purgeDeviceTraffic; this only removes rows ingested in the meantime.
    await client.query("DELETE FROM traffic_hourly WHERE device_id=?", [deviceId]);
    await client.query("DELETE FROM traffic_samples WHERE device_id=?", [deviceId]);
    for (const connectionId of connectionIds) {
      await client.query("DELETE FROM custom_domains WHERE connection_id=?", [connectionId]);
      await client.query("DELETE FROM runtime_states WHERE connection_id=?", [connectionId]);
      await client.query(
        "DELETE FROM traffic_policies WHERE scope_type='connection' AND scope_id=?",
        [connectionId],
      );
    }
    await client.query("DELETE FROM connections WHERE device_id=?", [deviceId]);
    await client.query("DELETE FROM devices WHERE id=?", [deviceId]);
    await audit(
      client,
      request,
      "DeviceDeleted",
      "Device",
      deviceId,
      { status: device.status, connection_count: connectionIds.length },
      { deleted: true },
    );
  });
  response.status(204).end();
});

router.delete("/devices/:deviceId", deleteDeviceHandler);

// Compatibility for an administrator page that was already open before v2.2.5.
router.post("/devices/:deviceId/revoke", deleteDeviceHandler);

const connectionSelect = `
  SELECT c.*,u.username,d.name AS device_name,rs.state,rs.applied_version,rs.last_error_code,
         tp.bandwidth_limit_bps,tp.version AS policy_version
    FROM connections c
    JOIN users u ON u.id=c.user_id JOIN devices d ON d.id=c.device_id
    LEFT JOIN runtime_states rs ON rs.connection_id=c.id
    LEFT JOIN traffic_policies tp ON tp.scope_type='connection' AND tp.scope_id=c.id`;

async function customDomainsByConnection(connectionIds: string[]): Promise<Map<string, string[]>> {
  if (!connectionIds.length) return new Map();
  const rows = await query<{ connection_id: string; domain: string }>(
    `SELECT connection_id,domain FROM custom_domains
      WHERE status='verified' AND connection_id IN (${connectionIds.map(() => "?").join(",")})
      ORDER BY domain`,
    connectionIds,
  );
  const result = new Map<string, string[]>();
  for (const row of rows) result.set(row.connection_id, [...(result.get(row.connection_id) ?? []), row.domain]);
  return result;
}

router.get(
  "/connections",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const search = String(request.query.search ?? "").trim();
    const userId = String(request.query.user_id ?? "");
    const rows = await query<ConnectionRow>(
      `${connectionSelect}
       WHERE c.deleted_at IS NULL AND (?='' OR c.user_id=?)
         AND (?='' OR c.subdomain LIKE '%'||?||'%' OR c.name LIKE '%'||?||'%' OR u.username LIKE '%'||?||'%')
       ORDER BY c.updated_at DESC LIMIT 250`,
      [userId, userId, search, search, search, search],
    );
    const domains = await customDomainsByConnection(rows.map((row) => row.id));
    response.json({
      items: rows.map((row) => publicConnection(row, domains.get(row.id) ?? [])),
      tcp_tunnels: {
        enabled: config.tcpTunnels.enabled,
        port_start: config.tcpTunnels.portStart,
        port_end: config.tcpTunnels.portEnd,
      },
    });
  }),
);

router.post(
  "/connections",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const body = parseBody(
      connectionInputSchema.extend({ user_id: z.string().uuid(), device_id: z.string().uuid() }),
      request.body,
    );
    const connection = await transaction(async (client) => {
      const created = await createConnection(client, body.user_id, body.device_id, body);
      // 审计补充 Basic 用户名（口令与哈希绝不入审计）。
      await audit(client, request, "ConnectionCreated", "Connection", created.id, null, {
        ...publicConnection(created),
        access_basic_user: created.access_basic_user ?? null,
      });
      return created;
    });
    response.status(201).json(publicConnection(connection));
  }),
);

router.get(
  "/connections/:connectionId",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const row = await one<ConnectionRow>(`${connectionSelect} WHERE c.id=? AND c.deleted_at IS NULL`, [
      request.params.connectionId,
    ]);
    if (!row) throw new HttpError(404, "NOT_FOUND", "连接不存在");
    const domains = await customDomainsByConnection([row.id]);
    response.json(publicConnection(row, domains.get(row.id) ?? []));
  }),
);

router.patch(
  "/connections/:connectionId",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const connectionId = pathParam(request, "connectionId");
    const patch = parseBody(connectionPatchSchema, request.body);
    const expected = parseExpectedVersion(request, patch.expected_version);
    const result = await transaction(async (client) => {
      const changed = await updateConnection(client, connectionId, expected, patch);
      await audit(client, request, "ConnectionUpdated", "Connection", connectionId, publicConnection(changed.before), {
        ...publicConnection(changed.after),
        access_basic_user: changed.after.access_basic_user ?? null,
      });
      return changed.after;
    });
    response.json(publicConnection(result));
  }),
);

router.delete(
  "/connections/:connectionId",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const connectionId = pathParam(request, "connectionId");
    const expected = parseExpectedVersion(request, request.body?.expected_version);
    await transaction(async (client) => {
      const deleted = await deleteConnection(client, connectionId, expected);
      await audit(client, request, "ConnectionDeleted", "Connection", connectionId, publicConnection(deleted), { deleted: true });
    });
    response.status(204).end();
  }),
);

router.get(
  "/connections/:connectionId/custom-domains",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const connectionId = pathParam(request, "connectionId");
    const rows = await query<CustomDomainRow>(
      `SELECT cd.*,c.subdomain FROM custom_domains cd JOIN connections c ON c.id=cd.connection_id
        WHERE cd.connection_id=? AND c.deleted_at IS NULL ORDER BY cd.created_at`,
      [connectionId],
    );
    if (!rows.length && !(await one("SELECT id FROM connections WHERE id=? AND deleted_at IS NULL", [connectionId]))) {
      throw new HttpError(404, "NOT_FOUND", "连接不存在");
    }
    response.json({ items: rows.map(publicCustomDomain) });
  }),
);

router.post(
  "/connections/:connectionId/custom-domains",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const connectionId = pathParam(request, "connectionId");
    const body = parseBody(z.object({ domain: z.string().trim().min(4).max(253) }), request.body);
    const created = await transaction(async (client) => {
      const domain = await createCustomDomain(client, connectionId, body.domain);
      await audit(client, request, "CustomDomainCreated", "CustomDomain", domain.id, null, {
        connection_id: connectionId,
        domain: domain.domain,
        status: domain.status,
      });
      return domain;
    });
    response.status(201).json(publicCustomDomain(created));
  }),
);

router.post(
  "/custom-domains/:domainId/verify",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const domainId = pathParam(request, "domainId");
    const checked = await verifyCustomDomainDns(domainId);
    const verified = await transaction(async (client) => {
      const domain = await applyVerifiedCustomDomain(client, domainId, checked.domain, checked.verification_token);
      await audit(client, request, "CustomDomainVerified", "CustomDomain", domain.id, null, {
        connection_id: domain.connection_id,
        domain: domain.domain,
        status: domain.status,
      });
      return domain;
    });
    response.json(publicCustomDomain(verified));
  }),
);

router.delete(
  "/custom-domains/:domainId",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const domainId = pathParam(request, "domainId");
    await transaction(async (client) => {
      const domain = await deleteCustomDomain(client, domainId);
      await audit(client, request, "CustomDomainDeleted", "CustomDomain", domain.id, {
        connection_id: domain.connection_id,
        domain: domain.domain,
        status: domain.status,
      }, { deleted: true });
    });
    response.status(204).end();
  }),
);

router.get(
  "/traffic-policies/:scopeType/:scopeId",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const policy = await one<{ scope_type: string; scope_id: string; bandwidth_limit_bps: string | null; monthly_quota_bytes: string | null; burst_bytes: string | null; version: string; updated_at: Date }>(
      `SELECT scope_type,scope_id,bandwidth_limit_bps,monthly_quota_bytes,burst_bytes,version,updated_at
         FROM traffic_policies WHERE scope_type=? AND scope_id=?`,
      [request.params.scopeType, request.params.scopeId],
    );
    if (!policy) throw new HttpError(404, "NOT_FOUND", "策略不存在");
    response.json({
      ...policy,
      bandwidth_limit_bps: policy.bandwidth_limit_bps == null ? null : Number(policy.bandwidth_limit_bps),
      monthly_quota_bytes: policy.monthly_quota_bytes == null ? null : Number(policy.monthly_quota_bytes),
      burst_bytes: policy.burst_bytes == null ? null : Number(policy.burst_bytes),
      version: Number(policy.version),
    });
  }),
);

router.patch(
  "/traffic-policies/:scopeType/:scopeId",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const scopeType = pathParam(request, "scopeType");
    const scopeId = pathParam(request, "scopeId");
    const body = parseBody(
      z.object({
        bandwidth_limit_bps: nullableBandwidth,
        monthly_quota_bytes: nullableMonthlyQuota.optional(),
        expected_version: z.number().int().positive().optional(),
      }),
      request.body,
    );
    // 月度配额是用户级概念：连接级策略不接受该字段，避免写入永不被读取的死数据。
    const quotaProvided = Object.hasOwn(body, "monthly_quota_bytes");
    if (quotaProvided && scopeType !== "user") {
      throw new HttpError(400, "VALIDATION_ERROR", "月度配额仅适用于用户级策略", {
        field_errors: { monthly_quota_bytes: "仅用户级策略支持配额" },
      });
    }
    const expected = parseExpectedVersion(request, body.expected_version);
    const result = await transaction(async (client) => {
      const current = await client.query<{ scope_type: string; scope_id: string; bandwidth_limit_bps: string | null; monthly_quota_bytes: string | null; version: string }>(
        `SELECT scope_type,scope_id,bandwidth_limit_bps,monthly_quota_bytes,version FROM traffic_policies
          WHERE scope_type=? AND scope_id=?`,
        [scopeType, scopeId],
      );
      const policy = current.rows[0];
      if (!policy) throw new HttpError(404, "NOT_FOUND", "策略不存在");
      if (Number(policy.version) !== expected) {
        throw new HttpError(409, "VERSION_CONFLICT", "策略已被其他操作修改", { current_version: Number(policy.version) });
      }
      // 未提供配额字段时保留原值；提供则采用新值（可为 null = 取消配额）。
      const nextQuota = quotaProvided
        ? body.monthly_quota_bytes ?? null
        : policy.monthly_quota_bytes == null ? null : Number(policy.monthly_quota_bytes);
      const updated = await client.query<{ version: string; updated_at: Date }>(
        `UPDATE traffic_policies SET bandwidth_limit_bps=?,monthly_quota_bytes=?,version=version+1,updated_at=home_tunnel_now()
          WHERE scope_type=? AND scope_id=? AND version=? RETURNING version,updated_at`,
        [body.bandwidth_limit_bps, nextQuota, scopeType, scopeId, expected],
      );
      if (!updated.rows[0]) throw new HttpError(409, "VERSION_CONFLICT", "策略已被其他操作修改");
      if (scopeType === "user") {
        const devices = await client.query<{ id: string }>("SELECT id FROM devices WHERE user_id=? AND status='active'", [
          scopeId,
        ]);
        for (const device of devices.rows) {
          await bumpDeviceConfig(
            client,
            device.id,
            "config.version.changed",
            "TrafficPolicy",
            scopeId,
            Number(updated.rows[0].version),
            scopeId,
            { scope_type: "user" },
          );
        }
      } else if (scopeType === "connection") {
        const connection = await client.query<{ user_id: string; device_id: string }>(
          "SELECT user_id,device_id FROM connections WHERE id=? AND deleted_at IS NULL",
          [scopeId],
        );
        if (connection.rows[0]) {
          await bumpDeviceConfig(
            client,
            connection.rows[0].device_id,
            "config.version.changed",
            "TrafficPolicy",
            scopeId,
            Number(updated.rows[0].version),
            connection.rows[0].user_id,
            { scope_type: "connection" },
          );
        }
      }
      await audit(client, request, "TrafficPolicyUpdated", "TrafficPolicy", scopeId, {
        bandwidth_limit_bps: policy.bandwidth_limit_bps == null ? null : Number(policy.bandwidth_limit_bps),
        monthly_quota_bytes: policy.monthly_quota_bytes == null ? null : Number(policy.monthly_quota_bytes),
        version: Number(policy.version),
      }, { bandwidth_limit_bps: body.bandwidth_limit_bps, monthly_quota_bytes: nextQuota, version: Number(updated.rows[0].version) });
      return { ...updated.rows[0], monthly_quota_bytes: nextQuota };
    });
    // 配额可能已从"超额"变为"未超额"（或反之）：立即触发一次检查，
    // 不阻塞响应；失败只记日志，下一个定时 tick 兜底。
    if (quotaProvided && scopeType === "user") triggerQuotaEnforcement();
    response.json({
      scope_type: scopeType,
      scope_id: scopeId,
      bandwidth_limit_bps: body.bandwidth_limit_bps,
      monthly_quota_bytes: result.monthly_quota_bytes,
      version: Number(result.version),
      updated_at: result.updated_at,
    });
  }),
);

router.post(
  "/alerts/test",
  asyncHandler(async (request, response) => {
    const actor = adminGuard(request);
    const channels = configuredAlertChannels();
    if (!channels.webhook && !channels.telegram) {
      throw new HttpError(409, "NO_ALERT_CHANNEL", "尚未配置任何告警通道");
    }
    // subject_id 带时间戳确保唯一，去重窗口不会吞掉管理员反复触发的测试。
    const outcome = await sendAlert({
      event_type: "alert.test",
      severity: "info",
      title: "Home Tunnel 告警测试",
      message: `由管理员 ${actor.username} 手动触发的测试告警。`,
      subject_id: `test:${Date.now()}`,
      details: { requested_by: actor.username },
    });
    response.json({ configured: channels, delivered: outcome.delivered, results: outcome.results });
  }),
);

router.get(
  "/audit-events",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const action = String(request.query.action ?? "").trim().slice(0, 128);
    const targetId = String(request.query.target_id ?? "").trim().slice(0, 256);
    const targetType = String(request.query.target_type ?? "").trim().slice(0, 64);
    const search = String(request.query.q ?? "").trim().slice(0, 160);
    const requestedPage = Math.min(1_000_000, Math.max(1, Number.parseInt(String(request.query.page ?? 1), 10) || 1));
    const legacyLimit = request.query.limit == null ? null : Number.parseInt(String(request.query.limit), 10);
    const requestedPageSize = Number.parseInt(String(request.query.page_size ?? legacyLimit ?? 100), 10) || 100;
    const pageSize = Math.min(request.query.page_size == null ? 200 : 100, Math.max(1, requestedPageSize));
    // Anonymous placeholders bind strictly by position, so filterValues must
    // list every occurrence in the same order as the `?` markers below.
    const filterSql = `
        WHERE (?='' OR action=?)
          AND (?='' OR target_id=?)
          AND (?='' OR target_type=?)
          AND (?='' OR action LIKE '%'||?||'%'
                      OR actor_type LIKE '%'||?||'%'
                      OR coalesce(actor_id,'') LIKE '%'||?||'%'
                      OR target_type LIKE '%'||?||'%'
                      OR coalesce(target_id,'') LIKE '%'||?||'%'
                      OR request_id LIKE '%'||?||'%')`;
    const filterValues = [
      action, action,
      targetId, targetId,
      targetType, targetType,
      search, search, search, search, search, search, search,
    ];
    // Capped count: stop scanning after 10001 matches instead of counting the
    // whole table for every page view of this LIKE-heavy filter.
    const countRows = await query<{ total: string }>(
      `SELECT count(*) AS total FROM (
         SELECT id FROM audit_events ${filterSql} LIMIT 10001
       ) capped`,
      filterValues,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;
    const rows = await query(
      `SELECT id,actor_type,actor_id,action,target_type,target_id,before_value,after_value,
              request_id,source_ip,created_at
         FROM audit_events
        ${filterSql}
        ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...filterValues, pageSize, offset],
    );
    response.json({ items: rows, total, page, page_size: pageSize, total_pages: totalPages });
  }),
);

router.get(
  "/traffic/summary",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const hours = Math.min(168, Math.max(1, Number.parseInt(String(request.query.hours ?? 24), 10) || 24));
    const userId = String(request.query.user_id ?? "");
    const rows = await query<{
      user_id: string;
      connection_id: string;
      username: string;
      name: string;
      subdomain: string;
      upload_bytes: string;
      download_bytes: string;
      requests: string;
      errors: string;
    }>(
      `SELECT ts.user_id,ts.connection_id,u.username,c.name,c.subdomain,
              sum(ts.upload_bytes) AS upload_bytes,sum(ts.download_bytes) AS download_bytes,
              sum(ts.request_count) AS requests,sum(ts.error_count) AS errors
         FROM traffic_samples ts JOIN users u ON u.id=ts.user_id JOIN connections c ON c.id=ts.connection_id
        WHERE ts.bucket_start > home_tunnel_add_seconds(home_tunnel_now(), -3600 * ?) AND (?='' OR ts.user_id=?)
        GROUP BY ts.user_id,ts.connection_id,u.username,c.name,c.subdomain
        ORDER BY sum(ts.upload_bytes+ts.download_bytes) DESC LIMIT 200`,
      [hours, userId, userId],
    );
    response.json({
      hours,
      items: rows.map((row) => ({
        ...row,
        upload_bytes: Number(row.upload_bytes),
        download_bytes: Number(row.download_bytes),
        requests: Number(row.requests),
        errors: Number(row.errors),
      })),
    });
  }),
);

router.get(
  "/system/health",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const started = performance.now();
    const dbResult = await pool.query<{ now: Date }>("SELECT home_tunnel_now() AS now");
    const dbLatencyMs = Math.round((performance.now() - started) * 10) / 10;
    const outbox = await one<{ pending: number; oldest_at: Date | null }>(
      `SELECT count(*) AS pending,min(created_at) AS oldest_at
         FROM outbox_events WHERE delivered_at IS NULL`,
    );
    const oldestAgeSeconds = outbox?.oldest_at
      ? Math.max(0, Math.round((Date.now() - outbox.oldest_at.getTime()) / 1000))
      : 0;
    const [gateway, frpsProbe, caddyProbe, backup] = await Promise.all([
      gatewayHealth(),
      tcpHealth(config.frpsHost, config.frpsPort),
      tcpHealth(config.caddyHost, config.caddyPort),
      backupHealth(),
    ]);
    const components: Array<Record<string, unknown> & { status: string }> = [
      { component: "control-center", status: "healthy", version: APP_VERSION },
      { component: "sqlite", status: dbResult.rows[0] ? "healthy" : "unhealthy", latency_ms: dbLatencyMs },
      {
        component: "outbox",
        status: oldestAgeSeconds <= 5 ? "healthy" : "degraded",
        pending: outbox?.pending ?? 0,
        oldest_age_seconds: oldestAgeSeconds,
      },
      gateway as Record<string, unknown> & { status: string },
      { component: "frps", ...frpsProbe },
      { component: "caddy", ...caddyProbe },
      backup as Record<string, unknown> & { status: string },
    ];
    const status = components.some((item) => item.status === "unhealthy")
      ? "unhealthy"
      : components.some((item) => item.status === "degraded" || item.status === "unknown")
        ? "degraded"
        : "healthy";
    response.json({ status, components, at: new Date().toISOString() });
  }),
);

export { router as adminRouter };
