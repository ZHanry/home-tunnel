import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import {
  applyVerifiedCustomDomain,
  createCustomDomain,
  deleteCustomDomain,
  publicCustomDomain,
  verifyCustomDomainDns,
  type CustomDomainRow,
} from "../custom-domains.js";
import {
  connectionInputSchema,
  connectionPatchSchema,
  createConnection,
  deleteConnection,
  publicConnection,
  type ConnectionRow,
  updateConnection,
} from "../domain.js";
import { one, query, transaction } from "../db.js";
import {
  asyncHandler,
  audit,
  HttpError,
  parseExpectedVersion,
  pathParam,
  requireActor,
  requireCsrf,
  requirePasswordNormal,
} from "../http.js";
import { opaqueToken, signLease, tokenHash } from "../security.js";
import { parseBody } from "../validation.js";

const router = Router();

function clientGuard(request: Parameters<typeof requireActor>[0]) {
  const actor = requirePasswordNormal(request);
  requireCsrf(request);
  return actor;
}

router.post(
  "/devices/register",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(120),
        install_id: z.string().trim().min(8).max(128),
        fingerprint_hash: z.string().regex(/^[a-f0-9]{64}$/i),
        client_version: z.string().trim().max(64).optional(),
      }),
      request.body,
    );
    const credential = opaqueToken(48);
    const device = await transaction(async (client) => {
      const existing = await client.query<{
        id: string;
        user_id: string;
        status: string;
        config_version: string;
        created_at: Date;
      }>(
        `SELECT id,user_id,status,config_version,created_at
           FROM devices WHERE user_id=? AND fingerprint_hash=? AND revoked_at IS NULL`,
        [actor.userId, body.fingerprint_hash.toLowerCase()],
      );
      let deviceId: string;
      let configVersion: number;
      let createdAt: Date;
      if (existing.rows[0]) {
        if (existing.rows[0].status !== "active") throw new HttpError(423, "DEVICE_REVOKED", "设备已撤销");
        deviceId = existing.rows[0].id;
        configVersion = Number(existing.rows[0].config_version);
        createdAt = existing.rows[0].created_at;
        await client.query(
          `UPDATE devices SET name=?,install_id=?,credential_hash=?,client_version=?,
             last_seen_at=home_tunnel_now(),updated_at=home_tunnel_now() WHERE id=?`,
          [body.name, body.install_id, tokenHash(credential), body.client_version ?? null, deviceId],
        );
      } else {
        deviceId = randomUUID();
        configVersion = 1;
        createdAt = new Date();
        await client.query(
          `INSERT INTO devices(
             id,user_id,name,install_id,fingerprint_hash,credential_hash,client_version,last_seen_at)
           VALUES(?,?,?,?,?,?,?,home_tunnel_now())`,
          [
            deviceId,
            actor.userId,
            body.name,
            body.install_id,
            body.fingerprint_hash.toLowerCase(),
            tokenHash(credential),
            body.client_version ?? null,
          ],
        );
      }
      await client.query("UPDATE sessions SET device_id=?,updated_at=home_tunnel_now() WHERE id=?", [deviceId, actor.sessionId]);
      await audit(client, request, existing.rows[0] ? "DeviceCredentialRotated" : "DeviceRegistered", "Device", deviceId, null, {
        name: body.name,
        install_id_hash: tokenHash(body.install_id),
        fingerprint_hash: body.fingerprint_hash,
      });
      return { id: deviceId, config_version: configVersion, created_at: createdAt };
    });
    response.status(201).json({
      device_id: device.id,
      name: body.name,
      status: "active",
      config_version: device.config_version,
      device_credential: credential,
      created_at: device.created_at,
    });
  }),
);

router.post(
  "/devices/current/credential/rotate",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    if (!actor.deviceId) throw new HttpError(409, "STATE_CONFLICT", "当前会话尚未注册设备");
    const credential = opaqueToken(48);
    await transaction(async (client) => {
      const result = await client.query(
        `UPDATE devices SET credential_hash=?,updated_at=home_tunnel_now() WHERE id=? AND user_id=? AND status='active' RETURNING id`,
        [tokenHash(credential), actor.deviceId, actor.userId],
      );
      if (!result.rows[0]) throw new HttpError(423, "DEVICE_REVOKED", "设备已撤销");
      await audit(client, request, "DeviceCredentialRotated", "Device", actor.deviceId, null, null);
    });
    response.json({ device_id: actor.deviceId, device_credential: credential });
  }),
);

const connectionSelect = `
  SELECT c.*,rs.state,rs.applied_version,rs.last_error_code,
         tp.bandwidth_limit_bps,tp.version AS policy_version
    FROM connections c
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
  "/client/connections",
  asyncHandler(async (request, response) => {
    const actor = requirePasswordNormal(request);
    const rows = await query<ConnectionRow>(
      `${connectionSelect} WHERE c.user_id=? AND c.deleted_at IS NULL ORDER BY c.updated_at DESC`,
      [actor.userId],
    );
    const domains = await customDomainsByConnection(rows.map((row) => row.id));
    response.json({ items: rows.map((row) => publicConnection(row, domains.get(row.id) ?? [])) });
  }),
);

router.post(
  "/client/connections",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const body = parseBody(
      connectionInputSchema
        .omit({ proxy_type: true, tcp_remote_port: true })
        .extend({ device_id: z.string().uuid(), proxy_type: z.literal("http").default("http") }),
      request.body,
    );
    const created = await transaction(async (client) => {
      const connection = await createConnection(client, actor.userId, body.device_id, body);
      // 审计补充 Basic 用户名（口令与哈希绝不入审计）。
      await audit(client, request, "ConnectionCreated", "Connection", connection.id, null, {
        ...publicConnection(connection),
        access_basic_user: connection.access_basic_user ?? null,
      });
      return connection;
    });
    response.status(201).json(publicConnection(created));
  }),
);

router.get(
  "/client/connections/:connectionId",
  asyncHandler(async (request, response) => {
    const actor = requirePasswordNormal(request);
    const row = await one<ConnectionRow>(
      `${connectionSelect} WHERE c.id=? AND c.user_id=? AND c.deleted_at IS NULL`,
      [request.params.connectionId, actor.userId],
    );
    if (!row) throw new HttpError(404, "OWNERSHIP_MISMATCH", "连接不存在");
    const domains = await customDomainsByConnection([row.id]);
    response.json(publicConnection(row, domains.get(row.id) ?? []));
  }),
);

router.patch(
  "/client/connections/:connectionId",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const connectionId = pathParam(request, "connectionId");
    const patch = parseBody(
      connectionPatchSchema.omit({ bandwidth_limit_bps: true, proxy_type: true, tcp_remote_port: true }),
      request.body,
    );
    const expected = parseExpectedVersion(request, patch.expected_version);
    const updated = await transaction(async (client) => {
      const changed = await updateConnection(client, connectionId, expected, patch, actor.userId);
      await audit(client, request, "ConnectionUpdated", "Connection", connectionId, publicConnection(changed.before), {
        ...publicConnection(changed.after),
        access_basic_user: changed.after.access_basic_user ?? null,
      });
      return changed.after;
    });
    response.json(publicConnection(updated));
  }),
);

router.delete(
  "/client/connections/:connectionId",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const connectionId = pathParam(request, "connectionId");
    const expected = parseExpectedVersion(request, request.body?.expected_version);
    await transaction(async (client) => {
      const deleted = await deleteConnection(client, connectionId, expected, actor.userId);
      await audit(client, request, "ConnectionDeleted", "Connection", connectionId, publicConnection(deleted), { deleted: true });
    });
    response.status(204).end();
  }),
);

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

type DeviceLeaseSubject = {
    id: string;
    user_id: string;
    config_version: string;
    status: string;
    user_status: string;
    token_version: string;
    lease_expires_at: Date | null;
};

async function loadDeviceLeaseSubject(userId: string, deviceId: string): Promise<DeviceLeaseSubject> {
  const device = await one<DeviceLeaseSubject>(
    `SELECT d.id,d.user_id,d.config_version,d.status,u.status AS user_status,u.token_version
            ,d.lease_expires_at
       FROM devices d JOIN users u ON u.id=d.user_id WHERE d.id=? AND d.user_id=?`,
    [deviceId, userId],
  );
  if (!device) throw new HttpError(404, "OWNERSHIP_MISMATCH", "设备不存在");
  if (device.user_status !== "active") throw new HttpError(423, "USER_DISABLED", "账号已禁用");
  if (device.status !== "active") throw new HttpError(423, "DEVICE_REVOKED", "设备已撤销");
  return device;
}

async function issueDeviceLease(device: DeviceLeaseSubject, seconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.min(seconds, config.offlineLeaseMaxSeconds);
  const lease = signLease({
    sub: device.id,
    user_id: device.user_id,
    device_id: device.id,
    config_version: Number(device.config_version),
    token_version: Number(device.token_version),
    iat: now,
    exp,
    jti: randomUUID(),
  });
  await query(
    "UPDATE devices SET lease_expires_at=home_tunnel_from_unix(?),last_seen_at=home_tunnel_now(),updated_at=home_tunnel_now() WHERE id=?",
    [exp, device.id],
  );
  return { lease, expires_at: new Date(exp * 1000).toISOString(), config_version: Number(device.config_version) };
}

router.post(
  "/client/sync",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const body = parseBody(
      z.object({
        device_id: z.string().uuid(),
        last_config_version: z.number().int().min(0),
        supports_optional_lease: z.boolean().optional().default(false),
        lease_expires_at: z.string().datetime().nullable().optional(),
      }),
      request.body,
    );
    if (actor.deviceId && actor.deviceId !== body.device_id) {
      throw new HttpError(404, "OWNERSHIP_MISMATCH", "设备不存在");
    }
    const device = await loadDeviceLeaseSubject(actor.userId, body.device_id);
    const targetVersion = Number(device.config_version);
    const fullSync = body.last_config_version !== targetVersion;
    let connections: ReturnType<typeof publicConnection>[] = [];
    if (fullSync) {
      const rows = await query<ConnectionRow>(
        `${connectionSelect} WHERE c.device_id=? AND c.deleted_at IS NULL ORDER BY c.created_at`,
        [body.device_id],
      );
      const domains = await customDomainsByConnection(rows.map((row) => row.id));
      connections = rows.map((row) => ({
        ...publicConnection({
          ...row,
          enabled: row.enabled && ((row.proxy_type ?? "http") === "http" || config.tcpTunnels.enabled),
        }, domains.get(row.id) ?? []),
        proxy_name: `ht_${row.id.replaceAll("-", "")}_v${Number(row.version)}`,
      }));
    }
    const renewalBoundary = Date.now() + 15 * 60 * 1000;
    const reportedExpiry = body.lease_expires_at ? Date.parse(body.lease_expires_at) : 0;
    const storedExpiry = device.lease_expires_at?.getTime() ?? 0;
    const shouldIssueLease =
      !body.supports_optional_lease || fullSync || reportedExpiry <= renewalBoundary || storedExpiry <= renewalBoundary;
    const lease = shouldIssueLease ? await issueDeviceLease(device, config.onlineLeaseSeconds) : null;
    response.json({
      device_id: body.device_id,
      full_sync: fullSync,
      from_config_version: body.last_config_version,
      target_config_version: targetVersion,
      connections,
      content_hash: canonicalHash(connections),
      lease,
      server_time: new Date().toISOString(),
    });
  }),
);

router.post(
  "/client/heartbeat",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const body = parseBody(
      z.object({
        device_id: z.string().uuid(),
        applied_config_version: z.number().int().min(0),
        client_version: z.string().max(64).optional(),
        agent_version: z.string().max(64).optional(),
        clock_utc: z.string().datetime().optional(),
        connections: z
          .array(
            z.object({
              connection_id: z.string().uuid(),
              applied_version: z.number().int().min(0),
              state: z.enum(["Disabled", "Pending", "Applying", "Online", "Degraded", "Offline", "Error"]),
              error_code: z.string().max(64).nullable().optional(),
              error_summary: z.string().max(512).nullable().optional(),
            }),
          )
          .max(250)
          .default([]),
      }),
      request.body,
    );
    if ((actor.deviceId && actor.deviceId !== body.device_id) || !actor.deviceId) {
      throw new HttpError(404, "OWNERSHIP_MISMATCH", "设备不存在");
    }
    await transaction(async (client) => {
      const updated = await client.query(
        `UPDATE devices SET applied_config_version=max(applied_config_version,?),
           client_version=?,agent_version=?,last_seen_at=home_tunnel_now(),updated_at=home_tunnel_now()
         WHERE id=? AND user_id=? AND status='active' RETURNING id`,
        [body.applied_config_version, body.client_version ?? null, body.agent_version ?? null, body.device_id, actor.userId],
      );
      if (!updated.rows[0]) throw new HttpError(423, "DEVICE_REVOKED", "设备已撤销");
      for (const state of body.connections) {
        await client.query(
          `UPDATE runtime_states SET
             applied_version=max(applied_version,?),state=?,last_error_code=?,last_error_summary=?,
             observed_at=home_tunnel_now(),updated_at=home_tunnel_now()
           WHERE connection_id=? AND ? <= desired_version
             AND EXISTS(SELECT 1 FROM connections c
               WHERE c.id=runtime_states.connection_id AND c.device_id=? AND c.user_id=?)`,
          [
            state.applied_version,
            state.state,
            state.error_code ?? null,
            state.error_summary ?? null,
            state.connection_id,
            state.applied_version,
            body.device_id,
            actor.userId,
          ],
        );
      }
    });
    const serverTime = Date.now();
    const clientTime = body.clock_utc ? Date.parse(body.clock_utc) : serverTime;
    response.json({ ok: true, server_time: new Date(serverTime).toISOString(), clock_skew_seconds: Math.round((clientTime - serverTime) / 1000) });
  }),
);

router.get(
  "/client/connections/:connectionId/custom-domains",
  asyncHandler(async (request, response) => {
    const actor = requirePasswordNormal(request);
    const connectionId = pathParam(request, "connectionId");
    const rows = await query<CustomDomainRow>(
      `SELECT cd.*,c.subdomain FROM custom_domains cd JOIN connections c ON c.id=cd.connection_id
        WHERE cd.connection_id=? AND c.user_id=? AND c.deleted_at IS NULL ORDER BY cd.created_at`,
      [connectionId, actor.userId],
    );
    if (!rows.length) {
      const connection = await one<{ id: string }>(
        "SELECT id FROM connections WHERE id=? AND user_id=? AND deleted_at IS NULL",
        [connectionId, actor.userId],
      );
      if (!connection) throw new HttpError(404, "OWNERSHIP_MISMATCH", "连接不存在");
    }
    response.json({ items: rows.map(publicCustomDomain) });
  }),
);

router.post(
  "/client/connections/:connectionId/custom-domains",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const connectionId = pathParam(request, "connectionId");
    const body = parseBody(z.object({ domain: z.string().trim().min(4).max(253) }), request.body);
    const created = await transaction(async (client) => {
      const domain = await createCustomDomain(client, connectionId, body.domain, actor.userId);
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
  "/client/custom-domains/:domainId/verify",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const domainId = pathParam(request, "domainId");
    const checked = await verifyCustomDomainDns(domainId, actor.userId);
    const verified = await transaction(async (client) => {
      const domain = await applyVerifiedCustomDomain(
        client,
        domainId,
        checked.domain,
        checked.verification_token,
        actor.userId,
      );
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
  "/client/custom-domains/:domainId",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const domainId = pathParam(request, "domainId");
    await transaction(async (client) => {
      const domain = await deleteCustomDomain(client, domainId, actor.userId);
      await audit(client, request, "CustomDomainDeleted", "CustomDomain", domain.id, {
        connection_id: domain.connection_id,
        domain: domain.domain,
        status: domain.status,
      }, { deleted: true });
    });
    response.status(204).end();
  }),
);

router.post(
  "/client/runtime-report",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const body = parseBody(
      z.object({
        device_id: z.string().uuid(),
        reports: z
          .array(
            z.object({
              connection_id: z.string().uuid(),
              applied_version: z.number().int().min(0),
              state: z.enum(["Disabled", "Pending", "Applying", "Online", "Degraded", "Offline", "Error"]),
              error_code: z.string().max(64).nullable().optional(),
              error_summary: z.string().max(512).nullable().optional(),
              observed_at: z.string().datetime(),
            }),
          )
          .min(1)
          .max(250),
      }),
      request.body,
    );
    if (!actor.deviceId || actor.deviceId !== body.device_id) throw new HttpError(404, "OWNERSHIP_MISMATCH", "设备不存在");
    await transaction(async (client) => {
      for (const report of body.reports) {
        // The stored observed_at is produced by home_tunnel_now() with millisecond
        // precision; normalize the client value to the same ISO format so the
        // lexicographic `? >= observed_at` comparison stays correct.
        const observedAt = new Date(Date.parse(report.observed_at)).toISOString();
        await client.query(
          `UPDATE runtime_states SET applied_version=max(applied_version,?),state=?,
             last_error_code=?,last_error_summary=?,observed_at=?,updated_at=home_tunnel_now()
           WHERE connection_id=? AND ? <= desired_version AND ? >= observed_at
             AND EXISTS(SELECT 1 FROM connections c
               WHERE c.id=runtime_states.connection_id AND c.device_id=? AND c.user_id=?)`,
          [
            report.applied_version,
            report.state,
            report.error_code ?? null,
            report.error_summary ?? null,
            observedAt,
            report.connection_id,
            report.applied_version,
            observedAt,
            body.device_id,
            actor.userId,
          ],
        );
      }
      await audit(client, request, "RuntimeReported", "Device", body.device_id, null, { report_count: body.reports.length });
    });
    response.status(202).json({ accepted: body.reports.length });
  }),
);

router.post(
  "/client/frp-lease",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const body = parseBody(z.object({ device_id: z.string().uuid(), mode: z.enum(["online", "offline"]).default("online") }), request.body);
    if (!actor.deviceId || actor.deviceId !== body.device_id) throw new HttpError(404, "OWNERSHIP_MISMATCH", "设备不存在");
    const seconds = body.mode === "offline" ? config.offlineLeaseMaxSeconds : config.onlineLeaseSeconds;
    const device = await loadDeviceLeaseSubject(actor.userId, body.device_id);
    const lease = await issueDeviceLease(device, seconds);
    response.json({ ...lease, mode: body.mode, max_offline_seconds: config.offlineLeaseMaxSeconds });
  }),
);

router.get(
  "/client/traffic/summary",
  asyncHandler(async (request, response) => {
    const actor = requirePasswordNormal(request);
    const rows = await query<{
      connection_id: string;
      upload_bytes: string;
      download_bytes: string;
      request_count: string;
    }>(
      `SELECT connection_id,sum(upload_bytes) AS upload_bytes,
              sum(download_bytes) AS download_bytes,sum(request_count) AS request_count
         FROM (
           SELECT connection_id,upload_bytes,download_bytes,request_count FROM traffic_samples WHERE user_id=?
           UNION ALL
           SELECT connection_id,upload_bytes,download_bytes,request_count FROM traffic_hourly WHERE user_id=?
         ) samples GROUP BY connection_id`,
      [actor.userId, actor.userId],
    );
    response.json({
      items: rows.map((row) => ({
        ...row,
        upload_bytes: Number(row.upload_bytes),
        download_bytes: Number(row.download_bytes),
        request_count: Number(row.request_count),
      })),
    });
  }),
);

export { router as clientRouter };
