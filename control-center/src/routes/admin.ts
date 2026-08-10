import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createConnection as createSocketConnection } from "node:net";
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
import {
  generateTemporaryPassword,
  hashPassword,
  normalizeUsername,
  opaqueToken,
  tokenHash,
} from "../security.js";
import { nullableBandwidth, parseBody } from "../validation.js";
import { config } from "../config.js";
import { APP_VERSION } from "../version.js";

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

function adminGuard(request: Parameters<typeof requireAdmin>[0]): void {
  requireAdmin(request);
  requirePasswordNormal(request);
  requireCsrf(request);
}

const userFields = `
  u.id::text,u.username,u.display_name,u.role,u.status,u.password_state,u.token_version::text,u.version::text,
  u.created_at,u.updated_at,tp.bandwidth_limit_bps,tp.version::text AS policy_version,
  (SELECT count(*)::int FROM devices d WHERE d.user_id=u.id AND d.status='active') AS device_count,
  (SELECT count(*)::int FROM connections c WHERE c.user_id=u.id AND c.deleted_at IS NULL) AS connection_count`;

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
  bandwidth_limit_bps: string | null;
  policy_version: string;
  device_count: number;
  connection_count: number;
};

function publicUser(row: UserSummary) {
  return {
    ...row,
    token_version: Number(row.token_version),
    version: Number(row.version),
    policy_version: Number(row.policy_version),
    bandwidth_limit_bps: row.bandwidth_limit_bps == null ? null : Number(row.bandwidth_limit_bps),
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
        (SELECT count(*)::int FROM users WHERE status='active') AS users,
        (SELECT count(*)::int FROM devices WHERE status='active' AND last_seen_at > now()-interval '90 seconds') AS online_devices,
        (SELECT count(*)::int FROM connections WHERE deleted_at IS NULL) AS connections,
        (SELECT count(*)::int FROM runtime_states WHERE state='Online') AS online_connections,
        COALESCE((SELECT sum(upload_bytes)::text FROM traffic_samples WHERE bucket_start > now()-interval '24 hours'),'0') AS upload_24h,
        COALESCE((SELECT sum(download_bytes)::text FROM traffic_samples WHERE bucket_start > now()-interval '24 hours'),'0') AS download_24h,
        (SELECT count(*)::int FROM runtime_states WHERE state='Error') AS high_errors`,
    );
    response.json({
      ...summary,
      upload_24h: Number(summary?.upload_24h ?? 0),
      download_24h: Number(summary?.download_24h ?? 0),
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
        WHERE ($1='' OR u.username ILIKE '%'||$1||'%' OR u.display_name ILIKE '%'||$1||'%')
        ORDER BY u.created_at DESC LIMIT 100`,
      [search],
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
         VALUES($1,$2,$3,$4,'must_change',now()+make_interval(secs=>$5),$6)`,
        [userId, username, body.display_name, passwordHash, config.temporaryPasswordSeconds, body.role],
      );
      await client.query(
        `INSERT INTO traffic_policies(id,scope_type,scope_id,bandwidth_limit_bps)
         VALUES($1,'user',$2,$3)`,
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
         LEFT JOIN traffic_policies tp ON tp.scope_type='user' AND tp.scope_id=u.id WHERE u.id=$1`,
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
       LEFT JOIN traffic_policies tp ON tp.scope_type='user' AND tp.scope_id=u.id WHERE u.id=$1`,
      [request.params.userId],
    );
    if (!row) throw new HttpError(404, "NOT_FOUND", "用户不存在");
    response.json(publicUser(row));
  }),
);

router.patch(
  "/users/:userId",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const actor = requireAdmin(request);
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
         LEFT JOIN traffic_policies tp ON tp.scope_type='user' AND tp.scope_id=u.id WHERE u.id=$1`,
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
        `UPDATE users SET display_name=$3,role=$4,version=version+1,updated_at=now()
          WHERE id=$1 AND version=$2 RETURNING *`,
        [userId, expectedVersion, body.display_name ?? before.display_name, body.role ?? before.role],
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
    adminGuard(request);
    const actor = requireAdmin(request);
    const userId = pathParam(request, "userId");
    const action = request.path.endsWith("/enable") ? "enable" : "disable";
    if (actor.userId === userId && action === "disable") {
      throw new HttpError(409, "STATE_CONFLICT", "不能禁用当前登录管理员");
    }
    const enabled = action === "enable";
    const row = await transaction(async (client) => {
      const before = await client.query<UserSummary>(
        `SELECT ${userFields} FROM users u LEFT JOIN traffic_policies tp
          ON tp.scope_type='user' AND tp.scope_id=u.id WHERE u.id=$1 FOR UPDATE`,
        [userId],
      );
      const user = before.rows[0];
      if (!user) throw new HttpError(404, "NOT_FOUND", "用户不存在");
      const updated = await client.query<UserSummary>(
        `UPDATE users SET status=$2,token_version=token_version+1,version=version+1,updated_at=now()
          WHERE id=$1 RETURNING *`,
        [userId, enabled ? "active" : "disabled"],
      );
      if (!enabled) {
        await client.query("UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE user_id=$1", [
          userId,
        ]);
        await client.query("UPDATE devices SET lease_expires_at=now(),updated_at=now() WHERE user_id=$1", [
          userId,
        ]);
      }
      const devices = await client.query<{ id: string }>("SELECT id::text FROM devices WHERE user_id=$1 AND status='active'", [
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
        `UPDATE users SET password_hash=$2,password_state='must_change',
           temporary_password_expires_at=now()+make_interval(secs=>$3),token_version=token_version+1,
           version=version+1,updated_at=now() WHERE id=$1 RETURNING id::text`,
        [userId, passwordHash, config.temporaryPasswordSeconds],
      );
      if (!result.rows[0]) throw new HttpError(404, "NOT_FOUND", "用户不存在");
      await client.query("UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE user_id=$1", [
        userId,
      ]);
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
      `SELECT d.id::text,d.user_id::text,u.username,d.name,d.status,d.config_version::text,
              d.applied_config_version::text,d.client_version,d.agent_version,d.last_seen_at,d.lease_expires_at,d.created_at
         FROM devices d JOIN users u ON u.id=d.user_id
        WHERE ($1='' OR d.user_id::text=$1) AND ($2='' OR d.status=$2)
        ORDER BY d.last_seen_at DESC NULLS LAST,d.created_at DESC LIMIT 200`,
      [userId, status],
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

router.post(
  "/devices/:deviceId/revoke",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const deviceId = pathParam(request, "deviceId");
    const revokedCredentialHash = tokenHash(opaqueToken(48));
    await transaction(async (client) => {
      const current = await client.query<{ id: string; user_id: string; status: string; config_version: string }>(
        "SELECT id::text,user_id::text,status,config_version::text FROM devices WHERE id=$1 FOR UPDATE",
        [deviceId],
      );
      const device = current.rows[0];
      if (!device) throw new HttpError(404, "NOT_FOUND", "设备不存在");
      await client.query(
        `UPDATE devices SET status='revoked',credential_hash=$2,
           revoked_at=now(),lease_expires_at=now(),config_version=config_version+1,updated_at=now() WHERE id=$1`,
        [deviceId, revokedCredentialHash],
      );
      await client.query("UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE device_id=$1", [
        deviceId,
      ]);
      await client.query(
        `INSERT INTO outbox_events(event_type,resource_type,resource_id,resource_version,recipient_user_id,recipient_device_id,payload)
         VALUES('subject.revoked','Device',$1::text,$2,$3,$1::uuid,$4)`,
        [
          deviceId,
          Number(device.config_version) + 1,
          device.user_id,
          JSON.stringify({ subject_type: "device", subject_id: deviceId }),
        ],
      );
      await audit(client, request, "DeviceRevoked", "Device", deviceId, { status: device.status }, { status: "revoked" });
    });
    response.status(202).json({ status: "revoked" });
  }),
);

const connectionSelect = `
  SELECT c.*,u.username,d.name AS device_name,rs.state,rs.applied_version::text,rs.last_error_code,
         tp.bandwidth_limit_bps,tp.version::text AS policy_version
    FROM connections c
    JOIN users u ON u.id=c.user_id JOIN devices d ON d.id=c.device_id
    LEFT JOIN runtime_states rs ON rs.connection_id=c.id
    LEFT JOIN traffic_policies tp ON tp.scope_type='connection' AND tp.scope_id=c.id`;

router.get(
  "/connections",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const search = String(request.query.search ?? "").trim();
    const userId = String(request.query.user_id ?? "");
    const rows = await query<ConnectionRow>(
      `${connectionSelect}
       WHERE c.deleted_at IS NULL AND ($1='' OR c.user_id::text=$1)
         AND ($2='' OR c.subdomain ILIKE '%'||$2||'%' OR c.name ILIKE '%'||$2||'%' OR u.username ILIKE '%'||$2||'%')
       ORDER BY c.updated_at DESC LIMIT 250`,
      [userId, search],
    );
    response.json({ items: rows.map((row) => ({ ...publicConnection(row), public_url: `https://${row.subdomain}.${config.tunnelDomain}` })) });
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
      await audit(client, request, "ConnectionCreated", "Connection", created.id, null, publicConnection(created));
      return created;
    });
    response.status(201).json({ ...publicConnection(connection), public_url: `https://${connection.subdomain}.${config.tunnelDomain}` });
  }),
);

router.get(
  "/connections/:connectionId",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const row = await one<ConnectionRow>(`${connectionSelect} WHERE c.id=$1 AND c.deleted_at IS NULL`, [
      request.params.connectionId,
    ]);
    if (!row) throw new HttpError(404, "NOT_FOUND", "连接不存在");
    response.json({ ...publicConnection(row), public_url: `https://${row.subdomain}.${config.tunnelDomain}` });
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
      await audit(client, request, "ConnectionUpdated", "Connection", connectionId, publicConnection(changed.before), publicConnection(changed.after));
      return changed.after;
    });
    response.json({ ...publicConnection(result), public_url: `https://${result.subdomain}.${config.tunnelDomain}` });
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
  "/traffic-policies/:scopeType/:scopeId",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const policy = await one<{ scope_type: string; scope_id: string; bandwidth_limit_bps: string | null; burst_bytes: string | null; version: string; updated_at: Date }>(
      `SELECT scope_type,scope_id::text,bandwidth_limit_bps,burst_bytes,version::text,updated_at
         FROM traffic_policies WHERE scope_type=$1 AND scope_id=$2`,
      [request.params.scopeType, request.params.scopeId],
    );
    if (!policy) throw new HttpError(404, "NOT_FOUND", "策略不存在");
    response.json({
      ...policy,
      bandwidth_limit_bps: policy.bandwidth_limit_bps == null ? null : Number(policy.bandwidth_limit_bps),
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
      z.object({ bandwidth_limit_bps: nullableBandwidth, expected_version: z.number().int().positive().optional() }),
      request.body,
    );
    const expected = parseExpectedVersion(request, body.expected_version);
    const result = await transaction(async (client) => {
      const current = await client.query<{ scope_type: string; scope_id: string; bandwidth_limit_bps: string | null; version: string }>(
        `SELECT scope_type,scope_id::text,bandwidth_limit_bps,version::text FROM traffic_policies
          WHERE scope_type=$1 AND scope_id=$2 FOR UPDATE`,
        [scopeType, scopeId],
      );
      const policy = current.rows[0];
      if (!policy) throw new HttpError(404, "NOT_FOUND", "策略不存在");
      if (Number(policy.version) !== expected) {
        throw new HttpError(409, "VERSION_CONFLICT", "策略已被其他操作修改", { current_version: Number(policy.version) });
      }
      const updated = await client.query<{ version: string; updated_at: Date }>(
        `UPDATE traffic_policies SET bandwidth_limit_bps=$4,version=version+1,updated_at=now()
          WHERE scope_type=$1 AND scope_id=$2 AND version=$3 RETURNING version::text,updated_at`,
        [scopeType, scopeId, expected, body.bandwidth_limit_bps],
      );
      if (!updated.rows[0]) throw new HttpError(409, "VERSION_CONFLICT", "策略已被其他操作修改");
      if (scopeType === "user") {
        const devices = await client.query<{ id: string }>("SELECT id::text FROM devices WHERE user_id=$1 AND status='active'", [
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
          "SELECT user_id::text,device_id::text FROM connections WHERE id=$1 AND deleted_at IS NULL",
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
        version: Number(policy.version),
      }, { bandwidth_limit_bps: body.bandwidth_limit_bps, version: Number(updated.rows[0].version) });
      return updated.rows[0];
    });
    response.json({
      scope_type: scopeType,
      scope_id: scopeId,
      bandwidth_limit_bps: body.bandwidth_limit_bps,
      version: Number(result.version),
      updated_at: result.updated_at,
    });
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
    const filterSql = `
        WHERE ($1='' OR action=$1)
          AND ($2='' OR target_id=$2)
          AND ($3='' OR target_type=$3)
          AND ($4='' OR action ILIKE '%'||$4||'%'
                      OR actor_type ILIKE '%'||$4||'%'
                      OR coalesce(actor_id::text,'') ILIKE '%'||$4||'%'
                      OR target_type ILIKE '%'||$4||'%'
                      OR coalesce(target_id,'') ILIKE '%'||$4||'%'
                      OR request_id::text ILIKE '%'||$4||'%')`;
    const countRows = await query<{ total: string }>(
      `SELECT count(*)::text AS total FROM audit_events ${filterSql}`,
      [action, targetId, targetType, search],
    );
    const total = Number(countRows[0]?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;
    const rows = await query(
      `SELECT id,actor_type,actor_id::text,action,target_type,target_id,before_value,after_value,
              request_id::text,source_ip::text,created_at
         FROM audit_events
        ${filterSql}
        ORDER BY id DESC LIMIT $5 OFFSET $6`,
      [action, targetId, targetType, search, pageSize, offset],
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
      `SELECT ts.user_id::text,ts.connection_id::text,u.username,c.name,c.subdomain,
              sum(ts.upload_bytes)::text AS upload_bytes,sum(ts.download_bytes)::text AS download_bytes,
              sum(ts.request_count)::text AS requests,sum(ts.error_count)::text AS errors
         FROM traffic_samples ts JOIN users u ON u.id=ts.user_id JOIN connections c ON c.id=ts.connection_id
        WHERE ts.bucket_start > now()-make_interval(hours=>$1) AND ($2='' OR ts.user_id::text=$2)
        GROUP BY ts.user_id,ts.connection_id,u.username,c.name,c.subdomain
        ORDER BY sum(ts.upload_bytes+ts.download_bytes) DESC LIMIT 200`,
      [hours, userId],
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
    const dbResult = await pool.query<{ now: Date }>("SELECT now()");
    const dbLatencyMs = Math.round((performance.now() - started) * 10) / 10;
    const outbox = await one<{ pending: number; oldest_age_seconds: string | null }>(
      `SELECT count(*)::int AS pending,
              extract(epoch FROM (now()-min(created_at)))::text AS oldest_age_seconds
         FROM outbox_events WHERE delivered_at IS NULL`,
    );
    const [gateway, frpsProbe, caddyProbe, backup] = await Promise.all([
      gatewayHealth(),
      tcpHealth(config.frpsHost, config.frpsPort),
      tcpHealth(config.caddyHost, config.caddyPort),
      backupHealth(),
    ]);
    const components: Array<Record<string, unknown> & { status: string }> = [
      { component: "control-center", status: "healthy", version: APP_VERSION },
      { component: "postgresql", status: dbResult.rows[0] ? "healthy" : "unhealthy", latency_ms: dbLatencyMs },
      {
        component: "outbox",
        status: Number(outbox?.oldest_age_seconds ?? 0) <= 5 ? "healthy" : "degraded",
        pending: outbox?.pending ?? 0,
        oldest_age_seconds: Number(outbox?.oldest_age_seconds ?? 0),
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
