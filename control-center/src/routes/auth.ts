import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { one, transaction } from "../db.js";
import {
  asyncHandler,
  audit,
  clearSessionCookies,
  HttpError,
  issueSession,
  parseCookies,
  requireActor,
  requireCsrf,
  setSessionCookies,
} from "../http.js";
import {
  constantTimeStringEqual,
  FixedWindowLimiter,
  hashPassword,
  normalizeUsername,
  opaqueToken,
  tokenHash,
  validatePassword,
  verifyPassword,
} from "../security.js";
import { parseBody } from "../validation.js";

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  password_state: "normal" | "must_change";
  temporary_password_expires_at: Date | null;
  role: "admin" | "user";
  status: "active" | "disabled";
  token_version: string;
  version: string;
};

const router = Router();
const loginIpLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error_code: "RATE_LIMITED",
      message: "登录尝试过多，请稍后重试",
      request_id: String(response.getHeader("x-request-id") ?? ""),
    });
  },
});
const loginLimiter = new FixedWindowLimiter(8, 60_000);
const deviceLoginLimiter = new FixedWindowLimiter(20, 60_000);
const refreshLimiter = new FixedWindowLimiter(30, 60_000);
const passwordChangeLimiter = new FixedWindowLimiter(5, 10 * 60_000);
const dummyHashPromise = hashPassword("Dummy timing password 2026!");
const clientTypeSchema = z.enum(["web", "windows", "linux"]);

function publicUser(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    status: user.status,
    password_state: user.password_state,
    version: Number(user.version),
  };
}

router.post(
  "/login",
  loginIpLimiter,
  asyncHandler(async (request, response) => {
    const body = parseBody(
      z.object({
        username: z.string().min(1).max(128),
        password: z.string().min(1).max(256),
        client_type: clientTypeSchema.default("windows"),
      }),
      request.body,
    );
    const normalized = normalizeUsername(body.username);
    const limit = loginLimiter.take(`${request.ip}:${normalized}`);
    if (!limit.allowed) {
      response.setHeader("retry-after", String(limit.retryAfterSeconds));
      throw new HttpError(429, "RATE_LIMITED", "登录尝试过多，请稍后重试");
    }
    const user = await one<UserRow>("SELECT * FROM users WHERE lower(username)=lower(?)", [
      normalized,
    ]);
    const passwordValid = await verifyPassword(
      user?.password_hash ?? (await dummyHashPromise),
      body.password,
    );
    if (!user || !passwordValid) {
      await transaction(async (client) => {
        await audit(client, request, "LoginFailed", "User", user?.id ?? null, null, {
          username: normalized,
        });
      });
      throw new HttpError(401, "AUTH_INVALID", "用户名或密码错误");
    }
    if (user.status !== "active") throw new HttpError(423, "USER_DISABLED", "账号已禁用");
    if (body.client_type === "web" && user.role !== "admin") {
      throw new HttpError(403, "FORBIDDEN", "普通用户只能使用 Windows 或 Linux 客户端");
    }
    if (
      user.password_state === "must_change" &&
      user.temporary_password_expires_at &&
      user.temporary_password_expires_at.getTime() < Date.now()
    ) {
      throw new HttpError(423, "TEMPORARY_PASSWORD_EXPIRED", "临时密码已过期，请联系管理员重置");
    }
    const session = await transaction(async (client) => {
      const issued = await issueSession(client, user, null);
      await audit(
        client,
        request,
        "LoginSucceeded",
        "User",
        user.id,
        null,
        {
          client_type: body.client_type,
          password_change_required: user.password_state === "must_change",
        },
        { type: "user", id: user.id },
      );
      return issued;
    });
    if (body.client_type === "web")
      setSessionCookies(response, session.accessToken, session.refreshToken);
    response.json({
      user: publicUser(user),
      password_change_required: user.password_state === "must_change",
      access_token: body.client_type !== "web" ? session.accessToken : undefined,
      refresh_token: body.client_type !== "web" ? session.refreshToken : undefined,
      csrf_token: session.csrfToken,
      access_expires_at: session.accessExpiresAt,
      refresh_expires_at: session.refreshExpiresAt,
    });
  }),
);

router.post(
  "/device",
  asyncHandler(async (request, response) => {
    const body = parseBody(
      z.object({ device_id: z.string().uuid(), device_credential: z.string().min(32).max(256) }),
      request.body,
    );
    const limit = deviceLoginLimiter.take(`${request.ip}:${body.device_id}`);
    if (!limit.allowed) {
      response.setHeader("retry-after", String(limit.retryAfterSeconds));
      throw new HttpError(429, "RATE_LIMITED", "设备认证尝试过多，请稍后重试");
    }
    const device = await one<
      UserRow & { device_id: string; device_status: "active" | "revoked"; credential_hash: string }
    >(
      `SELECT u.*, d.id AS device_id, d.status AS device_status, d.credential_hash
         FROM devices d JOIN users u ON u.id=d.user_id WHERE d.id=?`,
      [body.device_id],
    );
    if (
      !device ||
      !constantTimeStringEqual(device.credential_hash, tokenHash(body.device_credential))
    ) {
      throw new HttpError(401, "AUTH_INVALID", "设备认证失败");
    }
    if (device.status !== "active") throw new HttpError(423, "USER_DISABLED", "账号已禁用");
    if (device.device_status !== "active") throw new HttpError(423, "DEVICE_REVOKED", "设备已撤销");
    const session = await transaction(async (client) => {
      const issued = await issueSession(client, device, device.device_id);
      await client.query(
        "UPDATE devices SET last_seen_at=home_tunnel_now(),updated_at=home_tunnel_now() WHERE id=?",
        [device.device_id],
      );
      await audit(client, request, "DeviceAuthenticated", "Device", device.device_id, null, null, {
        type: "device",
        id: device.device_id,
      });
      return issued;
    });
    response.json({
      user: publicUser(device),
      device_id: device.device_id,
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      csrf_token: session.csrfToken,
      access_expires_at: session.accessExpiresAt,
      refresh_expires_at: session.refreshExpiresAt,
    });
  }),
);

router.post(
  "/refresh",
  asyncHandler(async (request, response) => {
    const body = parseBody(
      z.object({
        refresh_token: z.string().optional(),
        client_type: clientTypeSchema.default("windows"),
      }),
      request.body ?? {},
    );
    const presented = body.refresh_token ?? parseCookies(request).ht_refresh;
    if (!presented) throw new HttpError(401, "SESSION_REVOKED", "刷新令牌缺失");
    const presentedHash = tokenHash(presented);
    const limit = refreshLimiter.take(`${request.ip}:${presentedHash}`);
    if (!limit.allowed) {
      response.setHeader("retry-after", String(limit.retryAfterSeconds));
      throw new HttpError(429, "RATE_LIMITED", "刷新请求过多，请稍后重试");
    }
    const rotation = await transaction(async (client) => {
      const selected = await client.query<{
        id: string;
        user_id: string;
        token_family: string;
        token_version: string;
        user_token_version: string;
        refresh_token_hash: string;
        previous_refresh_token_hash: string | null;
        refresh_expires_at: Date;
        revoked_at: Date | null;
        status: "active" | "disabled";
      }>(
        `SELECT s.id,s.user_id,s.token_family,s.token_version,
                u.token_version AS user_token_version,s.refresh_token_hash,
                s.previous_refresh_token_hash,s.refresh_expires_at,s.revoked_at,u.status
           FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.refresh_token_hash=? OR s.previous_refresh_token_hash=?`,
        [presentedHash, presentedHash],
      );
      const session = selected.rows[0];
      if (!session) throw new HttpError(401, "SESSION_REVOKED", "刷新令牌无效");
      if (session.previous_refresh_token_hash === presentedHash) {
        await client.query(
          "UPDATE sessions SET revoked_at=COALESCE(revoked_at,home_tunnel_now()) WHERE token_family=?",
          [session.token_family],
        );
        await audit(
          client,
          request,
          "RefreshTokenReplayDetected",
          "Session",
          session.id,
          null,
          null,
          {
            type: "system",
            id: null,
          },
        );
        return { replayed: true as const };
      }
      if (
        session.revoked_at ||
        session.refresh_expires_at.getTime() <= Date.now() ||
        session.status !== "active" ||
        session.token_version !== session.user_token_version
      ) {
        throw new HttpError(401, "SESSION_REVOKED", "会话已过期或被撤销");
      }
      const accessToken = opaqueToken();
      const refreshToken = opaqueToken();
      const csrfToken = opaqueToken(24);
      const accessExpiresAt = new Date(Date.now() + config.accessTokenSeconds * 1000);
      await client.query(
        `UPDATE sessions SET previous_refresh_token_hash=refresh_token_hash,
             refresh_token_hash=?, access_token_hash=?, csrf_token_hash=?,
             access_expires_at=?, updated_at=home_tunnel_now() WHERE id=?`,
        [
          tokenHash(refreshToken),
          tokenHash(accessToken),
          tokenHash(csrfToken),
          accessExpiresAt,
          session.id,
        ],
      );
      await audit(client, request, "SessionRefreshed", "Session", session.id, null, null, {
        type: "user",
        id: session.user_id,
      });
      return {
        replayed: false as const,
        accessToken,
        refreshToken,
        csrfToken,
        accessExpiresAt,
        refreshExpiresAt: session.refresh_expires_at,
      };
    });
    if (rotation.replayed) {
      clearSessionCookies(response);
      throw new HttpError(401, "SESSION_REVOKED", "检测到旧刷新令牌重放，会话族已撤销");
    }
    if (body.client_type === "web")
      setSessionCookies(response, rotation.accessToken, rotation.refreshToken);
    response.json({
      access_token: body.client_type !== "web" ? rotation.accessToken : undefined,
      refresh_token: body.client_type !== "web" ? rotation.refreshToken : undefined,
      csrf_token: rotation.csrfToken,
      access_expires_at: rotation.accessExpiresAt.toISOString(),
      refresh_expires_at: rotation.refreshExpiresAt.toISOString(),
    });
  }),
);

router.post(
  "/logout",
  asyncHandler(async (request, response) => {
    const actor = requireActor(request);
    requireCsrf(request);
    await transaction(async (client) => {
      if (actor.deviceId) {
        const device = await client.query<{ config_version: string }>(
          `UPDATE devices SET credential_hash=?,lease_expires_at=home_tunnel_now(),config_version=config_version+1,
             updated_at=home_tunnel_now() WHERE id=? AND user_id=? AND status='active'
           RETURNING config_version`,
          [tokenHash(opaqueToken(48)), actor.deviceId, actor.userId],
        );
        const configVersion = Number(device.rows[0]?.config_version ?? 0);
        if (configVersion) {
          await client.query(
            `INSERT INTO outbox_events(
               event_type,resource_type,resource_id,resource_version,recipient_user_id,recipient_device_id,payload)
             VALUES('subject.revoked','DeviceSession',?,?,?,?,?)`,
            [
              actor.deviceId,
              configVersion,
              actor.userId,
              actor.deviceId,
              JSON.stringify({ subject_type: "device_session", subject_id: actor.deviceId }),
            ],
          );
          await audit(client, request, "DeviceSessionRevoked", "Device", actor.deviceId, null, {
            config_version: configVersion,
          });
        }
        await client.query(
          "UPDATE sessions SET revoked_at=COALESCE(revoked_at,home_tunnel_now()),updated_at=home_tunnel_now() WHERE device_id=?",
          [actor.deviceId],
        );
      } else {
        await client.query(
          "UPDATE sessions SET revoked_at=home_tunnel_now(),updated_at=home_tunnel_now() WHERE id=?",
          [actor.sessionId],
        );
      }
      await audit(client, request, "Logout", "Session", actor.sessionId, null, null);
    });
    clearSessionCookies(response);
    response.status(204).end();
  }),
);

router.post(
  "/password/change",
  asyncHandler(async (request, response) => {
    const actor = requireActor(request);
    requireCsrf(request);
    const limit = passwordChangeLimiter.take(`${request.ip}:${actor.userId}`);
    if (!limit.allowed) {
      response.setHeader("retry-after", String(limit.retryAfterSeconds));
      throw new HttpError(429, "RATE_LIMITED", "改密尝试过多，请稍后重试");
    }
    const body = parseBody(
      z.object({
        current_password: z.string().min(1).max(256),
        new_password: z.string().min(12).max(256),
      }),
      request.body,
    );
    const user = await one<UserRow>("SELECT * FROM users WHERE id=?", [actor.userId]);
    if (!user || !(await verifyPassword(user.password_hash, body.current_password))) {
      throw new HttpError(401, "AUTH_INVALID", "当前密码错误");
    }
    const validationError = validatePassword(body.new_password, user.username);
    if (validationError) {
      throw new HttpError(400, "VALIDATION_ERROR", "新密码不符合安全策略", {
        field_errors: { new_password: validationError },
      });
    }
    const newHash = await hashPassword(body.new_password);
    await transaction(async (client) => {
      await client.query(
        `UPDATE users SET password_hash=?,password_state='normal',temporary_password_expires_at=NULL,
             token_version=token_version+1,version=version+1,updated_at=home_tunnel_now() WHERE id=?`,
        [newHash, actor.userId],
      );
      await client.query(
        "UPDATE sessions SET revoked_at=COALESCE(revoked_at,home_tunnel_now()),updated_at=home_tunnel_now() WHERE user_id=?",
        [actor.userId],
      );
      await audit(
        client,
        request,
        "PasswordChanged",
        "User",
        actor.userId,
        { password_state: user.password_state },
        { password_state: "normal" },
      );
      await client.query(
        `INSERT INTO outbox_events(event_type,resource_type,resource_id,resource_version,recipient_user_id,payload)
         VALUES('subject.revoked','User',?,?,?,?)`,
        [
          actor.userId,
          Number(user.token_version) + 1,
          actor.userId,
          JSON.stringify({ subject_type: "user", subject_id: actor.userId }),
        ],
      );
    });
    clearSessionCookies(response);
    response.status(204).end();
  }),
);

router.get(
  "/me",
  asyncHandler(async (request, response) => {
    const actor = requireActor(request);
    response.json({
      id: actor.userId,
      username: actor.username,
      display_name: actor.displayName,
      role: actor.role,
      status: actor.status,
      password_state: actor.passwordState,
      device_id: actor.deviceId,
      capabilities:
        actor.role === "admin"
          ? ["admin:users", "admin:devices", "admin:connections", "admin:audit", "admin:health"]
          : ["client:devices", "client:connections", "client:sync", "client:diagnostics"],
    });
  }),
);

export { router as authRouter };
