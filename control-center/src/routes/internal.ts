import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { databaseEvents, one, query, transaction } from "../db.js";
import { asyncHandler, HttpError } from "../http.js";
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
    const allowed = await one<{ ok: number }>(
      `SELECT 1 AS ok FROM connections c
         JOIN users u ON u.id=c.user_id JOIN devices d ON d.id=c.device_id
        WHERE lower(c.subdomain)=lower($1) AND c.deleted_at IS NULL AND c.enabled=true
          AND u.status='active' AND d.status='active' LIMIT 1`,
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
    const revision = await one<{ revision: string }>("SELECT COALESCE(max(id),0)::text AS revision FROM outbox_events");
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
      device_status: string;
      device_lease_valid: boolean;
      device_lease_expires_at: Date | null;
      connection_limit_bps: string | null;
      connection_burst_bytes: string | null;
      connection_policy_version: string;
      user_limit_bps: string | null;
      user_burst_bytes: string | null;
      user_policy_version: string;
    }>(
      `SELECT c.id::text AS connection_id,c.user_id::text,c.device_id::text,c.subdomain,c.enabled,
              c.version::text AS connection_version,u.status AS user_status,d.status AS device_status,
              (d.lease_expires_at IS NOT NULL AND d.lease_expires_at > now()) AS device_lease_valid,
              d.lease_expires_at AS device_lease_expires_at,
              cp.bandwidth_limit_bps AS connection_limit_bps,cp.burst_bytes AS connection_burst_bytes,
              cp.version::text AS connection_policy_version,
              up.bandwidth_limit_bps AS user_limit_bps,up.burst_bytes AS user_burst_bytes,
              up.version::text AS user_policy_version
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
        enabled:
          row.enabled && row.user_status === "active" && row.device_status === "active" && row.device_lease_valid,
        device_lease_expires_at: row.device_lease_expires_at?.toISOString() ?? null,
        connection_version: Number(row.connection_version),
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
      const parameters = connectionIds.map((_id, index) => `$${index + 1}`).join(",");
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
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
    `SELECT d.status AS device_status,u.status AS user_status,u.token_version::text,d.config_version::text
       FROM devices d JOIN users u ON u.id=d.user_id WHERE d.id=$1 AND d.user_id=$2`,
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

function pluginAccept(response: Parameters<Parameters<typeof router.post>[1]>[1], content?: unknown): void {
  response.json({ reject: false, unchange: true, ...(content === undefined ? {} : { content }) });
}

function pluginReject(response: Parameters<Parameters<typeof router.post>[1]>[1], reason: string): void {
  response.json({ reject: true, reject_reason: reason, unchange: true });
}

function parseProxyName(proxyName: string): { connectionIdCompact: string; version: number } | null {
  const match = proxyName.match(/^ht_([0-9a-f]{32})_v([1-9][0-9]*)$/i);
  if (!match?.[1] || !match[2]) return null;
  return { connectionIdCompact: match[1].toLowerCase(), version: Number(match[2]) };
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
        `SELECT d.status AS device_status,u.status AS user_status,u.token_version::text,d.config_version::text
           FROM devices d JOIN users u ON u.id=d.user_id WHERE d.id=$1 AND d.user_id=$2`,
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
      await query("UPDATE devices SET last_seen_at=now(),lease_expires_at=to_timestamp($2),updated_at=now() WHERE id=$1", [
        lease.device_id,
        lease.exp,
      ]);
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
        `SELECT c.id::text,c.user_id::text,c.device_id::text,c.version::text,c.subdomain,c.enabled,
                u.status AS user_status,d.status AS device_status
           FROM connections c JOIN users u ON u.id=c.user_id JOIN devices d ON d.id=c.device_id
          WHERE replace(c.id::text,'-','')=$1 AND c.deleted_at IS NULL`,
        [parsed.connectionIdCompact],
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
        `UPDATE runtime_states SET state='Applying',observed_at=now(),updated_at=now()
          WHERE connection_id=$1 AND desired_version=$2`,
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
      await query("UPDATE devices SET last_seen_at=now(),updated_at=now() WHERE id=$1", [user.deviceId]);
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
        `UPDATE runtime_states SET state='Offline',observed_at=now(),updated_at=now()
          WHERE desired_version=$2 AND connection_id IN (
            SELECT id FROM connections WHERE replace(id,'-','')=$1 AND device_id=$3
          ) RETURNING connection_id`,
        [parsed.connectionIdCompact, parsed.version, user.deviceId],
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

export { router as internalRouter };
