import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "./db.js";
import { z } from "zod";
import { config } from "./config.js";
import { HttpError } from "./http.js";
import { hashBasicPassword, normalizeSubdomain, parseCidr, validateSubdomain } from "./security.js";

// Basic Auth 用户名：1..64，禁止控制字符；同时禁止冒号（Basic 凭据以首个
// 冒号分隔 user:pass，含冒号的用户名无法无歧义还原）。
// eslint-disable-next-line no-control-regex
const basicAuthUsernamePattern = /^[^\u0000-\u001f\u007f:]{1,64}$/;

export const connectionAccessSchema = z.object({
  ip_allowlist: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(64)
        .refine((value) => parseCidr(value) !== null, "必须是合法的 IPv4/IPv6 地址或 CIDR"),
    )
    .min(1)
    .max(64)
    .nullable()
    .optional(),
  basic_auth: z
    .object({
      username: z.string().refine((value) => basicAuthUsernamePattern.test(value), "用户名为 1-64 个字符，且不能包含控制字符或冒号"),
      password: z.string().min(8).max(128),
    })
    .nullable()
    .optional(),
});

export const connectionInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subdomain: z.string().trim().min(1).max(63),
  local_scheme: z.enum(["http", "https"]),
  local_host: z.string().trim().min(1).max(255),
  local_port: z.number().int().min(1).max(65_535),
  enabled: z.boolean().default(true),
  bandwidth_limit_bps: z.number().int().positive().max(10_000_000_000).nullable().optional(),
  access: connectionAccessSchema.optional(),
});

// zod 的 .partial() 不会移除 .default()：直接 partial 化 input schema 会让每次
// PATCH 解析都注入 enabled=true（把纯 ACL 编辑误判成 Agent 变更，还会隐式
// re-enable 已停用的连接）。先覆盖掉 default 再 partial。
export const connectionPatchSchema = connectionInputSchema
  .extend({ enabled: z.boolean() })
  .partial()
  .extend({ expected_version: z.number().int().positive().optional() });

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
  access_ip_allowlist?: string | null;
  access_basic_user?: string | null;
  access_basic_hash?: string | null;
  access_policy_version?: string | number;
  state?: string;
  applied_version?: string | number;
  last_error_code?: string | null;
  bandwidth_limit_bps?: string | number | null;
  policy_version?: string | number;
  username?: string;
  device_name?: string;
};

export function parseStoredAllowlist(value: string | null | undefined): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every((item) => typeof item === "string")
      ? (parsed as string[])
      : null;
  } catch {
    return null;
  }
}

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
    // 门禁配置仅暴露白名单与"是否启用 Basic Auth"，绝不返回哈希或口令。
    access_ip_allowlist: parseStoredAllowlist(row.access_ip_allowlist),
    access_basic_auth_enabled: row.access_basic_user != null,
    access_policy_version: Number(row.access_policy_version ?? 1),
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
  const access = input.access;
  const accessAllowlistJson = access?.ip_allowlist?.length ? JSON.stringify(access.ip_allowlist) : null;
  const accessBasicUser = access?.basic_auth?.username ?? null;
  const accessBasicHash = access?.basic_auth ? hashBasicPassword(access.basic_auth.password) : null;
  const connection = await client.query<ConnectionRow>(
    `INSERT INTO connections(
       id,user_id,device_id,name,subdomain,local_scheme,local_host,local_port,enabled,
       access_ip_allowlist,access_basic_user,access_basic_hash)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
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
      accessAllowlistJson,
      accessBasicUser,
      accessBasicHash,
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

const connectionDetailSelect = `
  SELECT c.*,tp.bandwidth_limit_bps,tp.version AS policy_version,
         rs.state,rs.applied_version,rs.last_error_code
    FROM connections c
    LEFT JOIN traffic_policies tp ON tp.scope_type='connection' AND tp.scope_id=c.id
    LEFT JOIN runtime_states rs ON rs.connection_id=c.id
   WHERE c.id=? AND c.deleted_at IS NULL`;

// 会触发 Agent 重配（bump 设备 config_version、递增连接 version）的字段；
// access 门禁在网关侧执行，刻意不在此列。
const agentPatchFields = [
  "name",
  "subdomain",
  "local_scheme",
  "local_host",
  "local_port",
  "enabled",
  "bandwidth_limit_bps",
] as const;

export async function updateConnection(
  client: DatabaseClient,
  connectionId: string,
  expectedVersion: number,
  patch: ConnectionPatch,
  ownerUserId?: string,
): Promise<{ before: ConnectionRow; after: ConnectionRow }> {
  const currentResult = await client.query<ConnectionRow>(connectionDetailSelect, [connectionId]);
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
  const accessPatch = Object.hasOwn(patch, "access") ? patch.access : undefined;
  // 纯 ACL 编辑（patch 仅含 access）不递增 connections.version、不 bump 设备
  // config_version：门禁在网关侧执行，Agent 无需重配，隧道不会重连。空 patch
  // 保持既有“重新应用”语义，仍走 Agent 路径。
  const agentChange =
    agentPatchFields.some((name) => Object.hasOwn(patch, name)) || accessPatch === undefined;

  if (agentChange) {
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
    if (Object.hasOwn(patch, "bandwidth_limit_bps")) {
      await client.query(
        `UPDATE traffic_policies SET bandwidth_limit_bps=?,version=version+1,updated_at=home_tunnel_now()
          WHERE scope_type='connection' AND scope_id=?`,
        [patch.bandwidth_limit_bps ?? null, connectionId],
      );
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
  }

  if (accessPatch) {
    let allowlistJson = current.access_ip_allowlist ?? null;
    if (Object.hasOwn(accessPatch, "ip_allowlist")) {
      allowlistJson = accessPatch.ip_allowlist?.length ? JSON.stringify(accessPatch.ip_allowlist) : null;
    }
    let basicUser = current.access_basic_user ?? null;
    let basicHash = current.access_basic_hash ?? null;
    if (Object.hasOwn(accessPatch, "basic_auth")) {
      if (accessPatch.basic_auth) {
        basicUser = accessPatch.basic_auth.username;
        basicHash = hashBasicPassword(accessPatch.basic_auth.password);
      } else {
        basicUser = null;
        basicHash = null;
      }
    }
    const accessUpdated = await client.query<{ access_policy_version: string }>(
      `UPDATE connections SET
         access_ip_allowlist=?,access_basic_user=?,access_basic_hash=?,
         access_policy_version=access_policy_version+1,updated_at=home_tunnel_now()
        WHERE id=? AND deleted_at IS NULL RETURNING access_policy_version`,
      [allowlistJson, basicUser, basicHash, connectionId],
    );
    const accessPolicyVersion = Number(accessUpdated.rows[0]?.access_policy_version ?? 0);
    if (!accessPolicyVersion) throw new HttpError(409, "VERSION_CONFLICT", "连接已被其他操作修改");
    // 直接写 outbox 让网关快照 revision 前进并收到推送；刻意绕过
    // bumpDeviceConfig，避免 ACL 编辑触发 Agent 重配和隧道重连。
    await client.query(
      `INSERT INTO outbox_events(
         event_type,resource_type,resource_id,resource_version,recipient_user_id,recipient_device_id,payload)
       VALUES('access.policy.changed','Connection',?,?,?,?,?)`,
      [
        connectionId,
        accessPolicyVersion,
        current.user_id,
        current.device_id,
        JSON.stringify({
          connection_id: connectionId,
          access_policy_version: accessPolicyVersion,
          ip_allowlist_set: allowlistJson != null,
          basic_auth_enabled: basicUser != null,
        }),
      ],
    );
  }

  const afterResult = await client.query<ConnectionRow>(connectionDetailSelect, [connectionId]);
  const after = afterResult.rows[0];
  if (!after) throw new HttpError(409, "VERSION_CONFLICT", "连接已被其他操作修改");
  return { before: current, after };
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
