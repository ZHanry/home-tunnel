import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { transaction, one, query } from "../../db.js";
import {
  asyncHandler,
  audit,
  HttpError,
  parseExpectedVersion,
  pathParam,
  requireAdmin,
  requirePasswordNormal,
} from "../../http.js";
import { bumpDeviceConfig } from "../../domain.js";
import { generateTemporaryPassword, hashPassword, normalizeUsername } from "../../security.js";
import { nullableBandwidth, parseBody } from "../../validation.js";
import { config } from "../../config.js";
import { adminGuard } from "./shared.js";

const router = Router();

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
        `INSERT INTO users(id,username,display_name,password_hash,password_state,temporary_password_expires_at,role)
       VALUES(?,?,?,?,'must_change',home_tunnel_add_seconds(home_tunnel_now(),?),?)`,
        [
          userId,
          username,
          body.display_name,
          passwordHash,
          config.temporaryPasswordSeconds,
          body.role,
        ],
      );
      await client.query(
        `INSERT INTO traffic_policies(id,scope_type,scope_id,bandwidth_limit_bps) VALUES(?,'user',?,?)`,
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
        `SELECT ${userFields} FROM users u LEFT JOIN traffic_policies tp
        ON tp.scope_type='user' AND tp.scope_id=u.id WHERE u.id=?`,
        [userId],
      );
      return result.rows[0] ?? null;
    });
    response
      .status(201)
      .json({ user: created ? publicUser(created) : null, temporary_password: temporaryPassword });
  }),
);

router.get(
  "/users/:userId",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const row = await one<UserSummary>(
      `SELECT ${userFields} FROM users u LEFT JOIN traffic_policies tp
      ON tp.scope_type='user' AND tp.scope_id=u.id WHERE u.id=?`,
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
        `SELECT ${userFields} FROM users u LEFT JOIN traffic_policies tp
        ON tp.scope_type='user' AND tp.scope_id=u.id WHERE u.id=?`,
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
        [
          body.display_name ?? before.display_name,
          body.role ?? before.role,
          userId,
          expectedVersion,
        ],
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
        await client.query(
          "UPDATE devices SET lease_expires_at=home_tunnel_now(),updated_at=home_tunnel_now() WHERE user_id=?",
          [userId],
        );
      }
      const devices = await client.query<{ id: string }>(
        "SELECT id FROM devices WHERE user_id=? AND status='active'",
        [userId],
      );
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
    response.json({
      temporary_password: temporaryPassword,
      expires_in_seconds: config.temporaryPasswordSeconds,
    });
  }),
);

export { router as usersRouter };
