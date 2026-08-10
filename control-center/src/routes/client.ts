import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
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
        `SELECT id::text,user_id::text,status,config_version::text,created_at
           FROM devices WHERE user_id=$1 AND fingerprint_hash=$2 AND revoked_at IS NULL FOR UPDATE`,
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
          `UPDATE devices SET name=$2,install_id=$3,credential_hash=$4,client_version=$5,
             last_seen_at=now(),updated_at=now() WHERE id=$1`,
          [deviceId, body.name, body.install_id, tokenHash(credential), body.client_version ?? null],
        );
      } else {
        deviceId = randomUUID();
        configVersion = 1;
        createdAt = new Date();
        await client.query(
          `INSERT INTO devices(
             id,user_id,name,install_id,fingerprint_hash,credential_hash,client_version,last_seen_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,now())`,
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
      await client.query("UPDATE sessions SET device_id=$2,updated_at=now() WHERE id=$1", [actor.sessionId, deviceId]);
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
        `UPDATE devices SET credential_hash=$2,updated_at=now() WHERE id=$1 AND user_id=$3 AND status='active' RETURNING id`,
        [actor.deviceId, tokenHash(credential), actor.userId],
      );
      if (!result.rows[0]) throw new HttpError(423, "DEVICE_REVOKED", "设备已撤销");
      await audit(client, request, "DeviceCredentialRotated", "Device", actor.deviceId, null, null);
    });
    response.json({ device_id: actor.deviceId, device_credential: credential });
  }),
);

const connectionSelect = `
  SELECT c.*,rs.state,rs.applied_version::text,rs.last_error_code,
         tp.bandwidth_limit_bps,tp.version::text AS policy_version
    FROM connections c
    LEFT JOIN runtime_states rs ON rs.connection_id=c.id
    LEFT JOIN traffic_policies tp ON tp.scope_type='connection' AND tp.scope_id=c.id`;

router.get(
  "/client/connections",
  asyncHandler(async (request, response) => {
    const actor = requirePasswordNormal(request);
    const rows = await query<ConnectionRow>(
      `${connectionSelect} WHERE c.user_id=$1 AND c.deleted_at IS NULL ORDER BY c.updated_at DESC`,
      [actor.userId],
    );
    response.json({
      items: rows.map((row) => ({
        ...publicConnection(row),
        public_url: `https://${row.subdomain}.${config.tunnelDomain}`,
      })),
    });
  }),
);

router.post(
  "/client/connections",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const body = parseBody(connectionInputSchema.extend({ device_id: z.string().uuid() }), request.body);
    const created = await transaction(async (client) => {
      const connection = await createConnection(client, actor.userId, body.device_id, body);
      await audit(client, request, "ConnectionCreated", "Connection", connection.id, null, publicConnection(connection));
      return connection;
    });
    response.status(201).json({
      ...publicConnection(created),
      public_url: `https://${created.subdomain}.${config.tunnelDomain}`,
    });
  }),
);

router.get(
  "/client/connections/:connectionId",
  asyncHandler(async (request, response) => {
    const actor = requirePasswordNormal(request);
    const row = await one<ConnectionRow>(
      `${connectionSelect} WHERE c.id=$1 AND c.user_id=$2 AND c.deleted_at IS NULL`,
      [request.params.connectionId, actor.userId],
    );
    if (!row) throw new HttpError(404, "OWNERSHIP_MISMATCH", "连接不存在");
    response.json({ ...publicConnection(row), public_url: `https://${row.subdomain}.${config.tunnelDomain}` });
  }),
);

router.patch(
  "/client/connections/:connectionId",
  asyncHandler(async (request, response) => {
    const actor = clientGuard(request);
    const connectionId = pathParam(request, "connectionId");
    const patch = parseBody(connectionPatchSchema.omit({ bandwidth_limit_bps: true }), request.body);
    const expected = parseExpectedVersion(request, patch.expected_version);
    const updated = await transaction(async (client) => {
      const changed = await updateConnection(client, connectionId, expected, patch, actor.userId);
      await audit(client, request, "ConnectionUpdated", "Connection", connectionId, publicConnection(changed.before), publicConnection(changed.after));
      return changed.after;
    });
    response.json({ ...publicConnection(updated), public_url: `https://${updated.subdomain}.${config.tunnelDomain}` });
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
    `SELECT d.id::text,d.user_id::text,d.config_version::text,d.status,u.status AS user_status,u.token_version::text
            ,d.lease_expires_at
       FROM devices d JOIN users u ON u.id=d.user_id WHERE d.id=$1 AND d.user_id=$2`,
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
  await query("UPDATE devices SET lease_expires_at=to_timestamp($2),last_seen_at=now(),updated_at=now() WHERE id=$1", [
    device.id,
    exp,
  ]);
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
        `${connectionSelect} WHERE c.device_id=$1 AND c.deleted_at IS NULL ORDER BY c.created_at`,
        [body.device_id],
      );
      connections = rows.map((row) => ({
        ...publicConnection(row),
        proxy_name: `ht_${row.id.replaceAll("-", "")}_v${Number(row.version)}`,
        public_url: `https://${row.subdomain}.${config.tunnelDomain}`,
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
        `UPDATE devices SET applied_config_version=GREATEST(applied_config_version,$3),
           client_version=$4,agent_version=$5,last_seen_at=now(),updated_at=now()
         WHERE id=$1 AND user_id=$2 AND status='active' RETURNING id`,
        [body.device_id, actor.userId, body.applied_config_version, body.client_version ?? null, body.agent_version ?? null],
      );
      if (!updated.rows[0]) throw new HttpError(423, "DEVICE_REVOKED", "设备已撤销");
      for (const state of body.connections) {
        await client.query(
          `UPDATE runtime_states rs SET
             applied_version=GREATEST(rs.applied_version,$3),state=$4,last_error_code=$5,last_error_summary=$6,
             observed_at=now(),updated_at=now()
           FROM connections c
          WHERE rs.connection_id=c.id AND c.id=$1 AND c.device_id=$2 AND c.user_id=$7
            AND $3 <= rs.desired_version`,
          [
            state.connection_id,
            body.device_id,
            state.applied_version,
            state.state,
            state.error_code ?? null,
            state.error_summary ?? null,
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
        await client.query(
          `UPDATE runtime_states rs SET applied_version=GREATEST(rs.applied_version,$3),state=$4,
             last_error_code=$5,last_error_summary=$6,observed_at=$7,updated_at=now()
           FROM connections c WHERE rs.connection_id=c.id AND c.id=$1 AND c.device_id=$2 AND c.user_id=$8
             AND $3 <= rs.desired_version AND $7 >= rs.observed_at`,
          [
            report.connection_id,
            body.device_id,
            report.applied_version,
            report.state,
            report.error_code ?? null,
            report.error_summary ?? null,
            report.observed_at,
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
      `SELECT connection_id::text,sum(upload_bytes)::text AS upload_bytes,
              sum(download_bytes)::text AS download_bytes,sum(request_count)::text AS request_count
         FROM (
           SELECT connection_id,upload_bytes,download_bytes,request_count FROM traffic_samples WHERE user_id=$1
           UNION ALL
           SELECT connection_id,upload_bytes,download_bytes,request_count FROM traffic_hourly WHERE user_id=$1
         ) samples GROUP BY connection_id`,
      [actor.userId],
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
