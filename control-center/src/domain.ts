import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "./db.js";
import { z } from "zod";
import { config } from "./config.js";
import { HttpError } from "./http.js";
import { normalizeSubdomain, validateSubdomain } from "./security.js";

export const connectionInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subdomain: z.string().trim().min(1).max(63),
  local_scheme: z.enum(["http", "https"]),
  local_host: z.string().trim().min(1).max(255),
  local_port: z.number().int().min(1).max(65_535),
  enabled: z.boolean().default(true),
  bandwidth_limit_bps: z.number().int().positive().max(10_000_000_000).nullable().optional(),
});

export const connectionPatchSchema = connectionInputSchema.partial().extend({
  expected_version: z.number().int().positive().optional(),
});

export type ConnectionInput = z.infer<typeof connectionInputSchema>;
export type ConnectionPatch = z.infer<typeof connectionPatchSchema>;

export type ConnectionRow = {
  id: string;
  user_id: string;
  device_id: string;
  name: string;
  subdomain: string;
  local_scheme: "http" | "https";
  local_host: string;
  local_port: number;
  enabled: boolean;
  version: string | number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  state?: string;
  applied_version?: string | number;
  last_error_code?: string | null;
  bandwidth_limit_bps?: string | number | null;
  policy_version?: string | number;
  username?: string;
  device_name?: string;
};

export function publicConnection(row: ConnectionRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    device_id: row.device_id,
    name: row.name,
    subdomain: row.subdomain,
    public_url: `https://${row.subdomain}.${config.tunnelDomain}`,
    local_scheme: row.local_scheme,
    local_host: row.local_host,
    local_port: Number(row.local_port),
    enabled: row.enabled,
    version: Number(row.version),
    state: row.state ?? (row.enabled ? "Pending" : "Disabled"),
    applied_version: Number(row.applied_version ?? 0),
    last_error_code: row.last_error_code ?? null,
    bandwidth_limit_bps:
      row.bandwidth_limit_bps == null ? null : Number(row.bandwidth_limit_bps),
    policy_version: Number(row.policy_version ?? 1),
    username: row.username,
    device_name: row.device_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function bumpDeviceConfig(
  client: DatabaseClient,
  deviceId: string,
  eventType: string,
  resourceType: string,
  resourceId: string,
  resourceVersion: number,
  userId: string,
  payload: Record<string, unknown> = {},
): Promise<number> {
  const result = await client.query<{ config_version: string }>(
    `UPDATE devices SET config_version=config_version+1,updated_at=home_tunnel_now()
      WHERE id=? RETURNING config_version`,
    [deviceId],
  );
  const configVersion = Number(result.rows[0]?.config_version ?? 0);
  if (!configVersion) throw new HttpError(404, "DEVICE_NOT_FOUND", "设备不存在");
  await client.query(
    `INSERT INTO outbox_events(
       event_type,resource_type,resource_id,resource_version,recipient_user_id,recipient_device_id,payload)
     VALUES(?,?,?,?,?,?,?)`,
    [
      eventType,
      resourceType,
      resourceId,
      resourceVersion,
      userId,
      deviceId,
      JSON.stringify({ device_id: deviceId, config_version: configVersion, ...payload }),
    ],
  );
  return configVersion;
}

export async function createConnection(
  client: DatabaseClient,
  userId: string,
  deviceId: string,
  input: ConnectionInput,
): Promise<ConnectionRow> {
  const subdomain = normalizeSubdomain(input.subdomain);
  const error = validateSubdomain(subdomain);
  if (error) {
    throw new HttpError(409, error.includes("保留") ? "SUBDOMAIN_RESERVED" : "VALIDATION_ERROR", error, {
      field_errors: { subdomain: error },
    });
  }
  const device = await client.query<{ user_id: string; status: string }>(
    "SELECT user_id,status FROM devices WHERE id=?",
    [deviceId],
  );
  if (!device.rows[0] || device.rows[0].user_id !== userId) {
    throw new HttpError(404, "OWNERSHIP_MISMATCH", "设备不存在");
  }
  if (device.rows[0].status !== "active") throw new HttpError(423, "DEVICE_REVOKED", "设备已撤销");
  const connectionId = randomUUID();
  const connection = await client.query<ConnectionRow>(
    `INSERT INTO connections(
       id,user_id,device_id,name,subdomain,local_scheme,local_host,local_port,enabled)
     VALUES(?,?,?,?,?,?,?,?,?) RETURNING *`,
    [
      connectionId,
      userId,
      deviceId,
      input.name,
      subdomain,
      input.local_scheme,
      input.local_host,
      input.local_port,
      input.enabled,
    ],
  );
  await client.query(
    `INSERT INTO traffic_policies(id,scope_type,scope_id,bandwidth_limit_bps)
     VALUES(?,'connection',?,?)`,
    [randomUUID(), connectionId, input.bandwidth_limit_bps ?? null],
  );
  await client.query(
    `INSERT INTO runtime_states(connection_id,desired_version,state)
     VALUES(?,1,?)`,
    [connectionId, input.enabled ? "Pending" : "Disabled"],
  );
  await bumpDeviceConfig(
    client,
    deviceId,
    "config.version.changed",
    "Connection",
    connectionId,
    1,
    userId,
    { action: "created" },
  );
  return { ...connection.rows[0]!, bandwidth_limit_bps: input.bandwidth_limit_bps ?? null, policy_version: 1 };
}

export async function updateConnection(
  client: DatabaseClient,
  connectionId: string,
  expectedVersion: number,
  patch: ConnectionPatch,
  ownerUserId?: string,
): Promise<{ before: ConnectionRow; after: ConnectionRow }> {
  const currentResult = await client.query<ConnectionRow>(
    `SELECT c.*,tp.bandwidth_limit_bps,tp.version AS policy_version,
            rs.state,rs.applied_version,rs.last_error_code
       FROM connections c
       LEFT JOIN traffic_policies tp ON tp.scope_type='connection' AND tp.scope_id=c.id
       LEFT JOIN runtime_states rs ON rs.connection_id=c.id
      WHERE c.id=? AND c.deleted_at IS NULL`,
    [connectionId],
  );
  const current = currentResult.rows[0];
  if (!current || (ownerUserId && current.user_id !== ownerUserId)) {
    throw new HttpError(404, "OWNERSHIP_MISMATCH", "连接不存在");
  }
  if (Number(current.version) !== expectedVersion) {
    throw new HttpError(409, "VERSION_CONFLICT", "连接已被其他操作修改", {
      current_version: Number(current.version),
      current: publicConnection(current),
    });
  }
  const subdomain = patch.subdomain ? normalizeSubdomain(patch.subdomain) : current.subdomain;
  const subdomainError = validateSubdomain(subdomain);
  if (subdomainError) {
    throw new HttpError(
      409,
      subdomainError.includes("保留") ? "SUBDOMAIN_RESERVED" : "VALIDATION_ERROR",
      subdomainError,
      { field_errors: { subdomain: subdomainError } },
    );
  }
  const updated = await client.query<ConnectionRow>(
    `UPDATE connections SET
       name=?,subdomain=?,local_scheme=?,local_host=?,local_port=?,enabled=?,
       version=version+1,updated_at=home_tunnel_now()
      WHERE id=? AND version=? AND deleted_at IS NULL RETURNING *`,
    [
      patch.name ?? current.name,
      subdomain,
      patch.local_scheme ?? current.local_scheme,
      patch.local_host ?? current.local_host,
      patch.local_port ?? current.local_port,
      patch.enabled ?? current.enabled,
      connectionId,
      expectedVersion,
    ],
  );
  if (!updated.rows[0]) throw new HttpError(409, "VERSION_CONFLICT", "连接已被其他操作修改");
  let policyVersion = Number(current.policy_version ?? 1);
  let bandwidth = current.bandwidth_limit_bps ?? null;
  if (Object.hasOwn(patch, "bandwidth_limit_bps")) {
    bandwidth = patch.bandwidth_limit_bps ?? null;
    const policy = await client.query<{ version: string }>(
      `UPDATE traffic_policies SET bandwidth_limit_bps=?,version=version+1,updated_at=home_tunnel_now()
        WHERE scope_type='connection' AND scope_id=? RETURNING version`,
      [bandwidth, connectionId],
    );
    policyVersion = Number(policy.rows[0]?.version ?? policyVersion);
  }
  await client.query(
    `UPDATE runtime_states SET desired_version=?,state=?,last_error_code=NULL,updated_at=home_tunnel_now()
      WHERE connection_id=?`,
    [Number(updated.rows[0].version), (patch.enabled ?? current.enabled) ? "Applying" : "Disabled", connectionId],
  );
  await bumpDeviceConfig(
    client,
    current.device_id,
    patch.enabled === false ? "connection.command" : "config.version.changed",
    "Connection",
    connectionId,
    Number(updated.rows[0].version),
    current.user_id,
    { action: patch.enabled === false ? "stop" : "apply", connection_id: connectionId },
  );
  return {
    before: current,
    after: { ...updated.rows[0], bandwidth_limit_bps: bandwidth, policy_version: policyVersion },
  };
}

export async function deleteConnection(
  client: DatabaseClient,
  connectionId: string,
  expectedVersion: number,
  ownerUserId?: string,
): Promise<ConnectionRow> {
  const currentResult = await client.query<ConnectionRow>(
    `SELECT c.*,tp.bandwidth_limit_bps,tp.version AS policy_version
       FROM connections c LEFT JOIN traffic_policies tp ON tp.scope_type='connection' AND tp.scope_id=c.id
      WHERE c.id=? AND c.deleted_at IS NULL`,
    [connectionId],
  );
  const current = currentResult.rows[0];
  if (!current || (ownerUserId && current.user_id !== ownerUserId)) {
    throw new HttpError(404, "OWNERSHIP_MISMATCH", "连接不存在");
  }
  if (Number(current.version) !== expectedVersion) {
    throw new HttpError(409, "VERSION_CONFLICT", "连接已被其他操作修改", {
      current_version: Number(current.version),
      current: publicConnection(current),
    });
  }
  const deleted = await client.query<ConnectionRow>(
    `UPDATE connections SET enabled=false,deleted_at=home_tunnel_now(),version=version+1,updated_at=home_tunnel_now()
      WHERE id=? AND version=? AND deleted_at IS NULL RETURNING *`,
    [connectionId, expectedVersion],
  );
  if (!deleted.rows[0]) throw new HttpError(409, "VERSION_CONFLICT", "连接已被其他操作修改");
  await client.query(
    `UPDATE runtime_states SET desired_version=?,state='Disabled',updated_at=home_tunnel_now() WHERE connection_id=?`,
    [Number(deleted.rows[0].version), connectionId],
  );
  await bumpDeviceConfig(
    client,
    current.device_id,
    "connection.command",
    "Connection",
    connectionId,
    Number(deleted.rows[0].version),
    current.user_id,
    { action: "delete", command: "stop", connection_id: connectionId, tombstone: true },
  );
  return { ...deleted.rows[0], bandwidth_limit_bps: current.bandwidth_limit_bps, policy_version: current.policy_version };
}
