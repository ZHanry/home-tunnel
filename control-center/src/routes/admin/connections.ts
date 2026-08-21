import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { one, query, transaction } from "../../db.js";
import {
  bumpDeviceConfig,
  connectionInputSchema,
  connectionPatchSchema,
  createConnection,
  deleteConnection,
  publicConnection,
  type ConnectionRow,
  updateConnection,
} from "../../domain.js";
import {
  asyncHandler,
  audit,
  HttpError,
  parseExpectedVersion,
  pathParam,
  requireAdmin,
  requirePasswordNormal,
} from "../../http.js";
import { nullableBandwidth, nullableMonthlyQuota, parseBody } from "../../validation.js";
import { config } from "../../config.js";
import { adminConnectionSelect, customDomainsByConnection } from "../../connection-query.js";
import { triggerQuotaEnforcement } from "../../quota.js";
import { configuredAlertChannels, sendAlert } from "../../notifications.js";
import {
  applyVerifiedCustomDomain,
  createCustomDomain,
  deleteCustomDomain,
  publicCustomDomain,
  verifyCustomDomainDns,
  type CustomDomainRow,
} from "../../custom-domains.js";
import { adminGuard } from "./shared.js";

const router = Router();
const customDomainVerificationLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error_code: "RATE_LIMITED",
      message: "域名验证请求过多，请稍后重试",
      request_id: String(response.getHeader("x-request-id") ?? ""),
    });
  },
});

router.get(
  "/connections",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const search = String(request.query.search ?? "").trim();
    const userId = String(request.query.user_id ?? "");
    const rows = await query<ConnectionRow>(
      `${adminConnectionSelect}
     WHERE c.deleted_at IS NULL AND (?='' OR c.user_id=?)
       AND (?='' OR c.subdomain LIKE '%'||?||'%' OR c.name LIKE '%'||?||'%' OR u.username LIKE '%'||?||'%')
     ORDER BY c.updated_at DESC LIMIT 250`,
      [userId, userId, search, search, search, search],
    );
    const domains = await customDomainsByConnection(rows.map((row) => row.id));
    response.json({
      items: rows.map((row) => publicConnection(row, domains.get(row.id) ?? [])),
      transport_tunnels: {
        tcp: {
          enabled: config.transportTunnels.tcp.enabled,
          port_start: config.transportTunnels.tcp.portStart,
          port_end: config.transportTunnels.tcp.portEnd,
        },
        udp: {
          enabled: config.transportTunnels.udp.enabled,
          port_start: config.transportTunnels.udp.portStart,
          port_end: config.transportTunnels.udp.portEnd,
        },
      },
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
    const row = await one<ConnectionRow>(
      `${adminConnectionSelect} WHERE c.id=? AND c.deleted_at IS NULL`,
      [request.params.connectionId],
    );
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
      await audit(
        client,
        request,
        "ConnectionUpdated",
        "Connection",
        connectionId,
        publicConnection(changed.before),
        {
          ...publicConnection(changed.after),
          access_basic_user: changed.after.access_basic_user ?? null,
        },
      );
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
      await audit(
        client,
        request,
        "ConnectionDeleted",
        "Connection",
        connectionId,
        publicConnection(deleted),
        { deleted: true },
      );
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
    if (
      !rows.length &&
      !(await one("SELECT id FROM connections WHERE id=? AND deleted_at IS NULL", [connectionId]))
    ) {
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
  customDomainVerificationLimiter,
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const domainId = pathParam(request, "domainId");
    const checked = await verifyCustomDomainDns(domainId);
    const verified = await transaction(async (client) => {
      const domain = await applyVerifiedCustomDomain(
        client,
        domainId,
        checked.domain,
        checked.verification_token,
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
  "/custom-domains/:domainId",
  asyncHandler(async (request, response) => {
    adminGuard(request);
    const domainId = pathParam(request, "domainId");
    await transaction(async (client) => {
      const domain = await deleteCustomDomain(client, domainId);
      await audit(
        client,
        request,
        "CustomDomainDeleted",
        "CustomDomain",
        domain.id,
        { connection_id: domain.connection_id, domain: domain.domain, status: domain.status },
        { deleted: true },
      );
    });
    response.status(204).end();
  }),
);

router.get(
  "/traffic-policies/:scopeType/:scopeId",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const policy = await one<{
      scope_type: string;
      scope_id: string;
      bandwidth_limit_bps: string | null;
      monthly_quota_bytes: string | null;
      burst_bytes: string | null;
      version: string;
      updated_at: Date;
    }>(
      `SELECT scope_type,scope_id,bandwidth_limit_bps,monthly_quota_bytes,burst_bytes,version,updated_at
       FROM traffic_policies WHERE scope_type=? AND scope_id=?`,
      [request.params.scopeType, request.params.scopeId],
    );
    if (!policy) throw new HttpError(404, "NOT_FOUND", "策略不存在");
    response.json({
      ...policy,
      bandwidth_limit_bps:
        policy.bandwidth_limit_bps == null ? null : Number(policy.bandwidth_limit_bps),
      monthly_quota_bytes:
        policy.monthly_quota_bytes == null ? null : Number(policy.monthly_quota_bytes),
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
    const quotaProvided = Object.hasOwn(body, "monthly_quota_bytes");
    if (quotaProvided && scopeType !== "user") {
      throw new HttpError(400, "VALIDATION_ERROR", "月度配额仅适用于用户级策略", {
        field_errors: { monthly_quota_bytes: "仅用户级策略支持配额" },
      });
    }
    const expected = parseExpectedVersion(request, body.expected_version);
    const result = await transaction(async (client) => {
      const current = await client.query<{
        scope_type: string;
        scope_id: string;
        bandwidth_limit_bps: string | null;
        monthly_quota_bytes: string | null;
        version: string;
      }>(
        `SELECT scope_type,scope_id,bandwidth_limit_bps,monthly_quota_bytes,version FROM traffic_policies
        WHERE scope_type=? AND scope_id=?`,
        [scopeType, scopeId],
      );
      const policy = current.rows[0];
      if (!policy) throw new HttpError(404, "NOT_FOUND", "策略不存在");
      if (Number(policy.version) !== expected) {
        throw new HttpError(409, "VERSION_CONFLICT", "策略已被其他操作修改", {
          current_version: Number(policy.version),
        });
      }
      const nextQuota = quotaProvided
        ? (body.monthly_quota_bytes ?? null)
        : policy.monthly_quota_bytes == null
          ? null
          : Number(policy.monthly_quota_bytes);
      const updated = await client.query<{ version: string; updated_at: Date }>(
        `UPDATE traffic_policies SET bandwidth_limit_bps=?,monthly_quota_bytes=?,version=version+1,updated_at=home_tunnel_now()
        WHERE scope_type=? AND scope_id=? AND version=? RETURNING version,updated_at`,
        [body.bandwidth_limit_bps, nextQuota, scopeType, scopeId, expected],
      );
      if (!updated.rows[0]) throw new HttpError(409, "VERSION_CONFLICT", "策略已被其他操作修改");
      if (scopeType === "user") {
        const devices = await client.query<{ id: string }>(
          "SELECT id FROM devices WHERE user_id=? AND status='active'",
          [scopeId],
        );
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
      await audit(
        client,
        request,
        "TrafficPolicyUpdated",
        "TrafficPolicy",
        scopeId,
        {
          bandwidth_limit_bps:
            policy.bandwidth_limit_bps == null ? null : Number(policy.bandwidth_limit_bps),
          monthly_quota_bytes:
            policy.monthly_quota_bytes == null ? null : Number(policy.monthly_quota_bytes),
          version: Number(policy.version),
        },
        {
          bandwidth_limit_bps: body.bandwidth_limit_bps,
          monthly_quota_bytes: nextQuota,
          version: Number(updated.rows[0].version),
        },
      );
      return { ...updated.rows[0], monthly_quota_bytes: nextQuota };
    });
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
    if (!channels.webhook && !channels.telegram)
      throw new HttpError(409, "NO_ALERT_CHANNEL", "尚未配置任何告警通道");
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

export { router as connectionsRouter };
