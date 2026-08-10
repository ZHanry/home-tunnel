import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { PoolClient } from "pg";
import { config } from "./config.js";
import { one, query } from "./db.js";
import { constantTimeStringEqual, opaqueToken, tokenHash } from "./security.js";
import type { AuthenticatedActor, AuthenticatedRequest } from "./types.js";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function asyncHandler(
  handler: (request: AuthenticatedRequest, response: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (request, response, next) => {
    void handler(request as AuthenticatedRequest, response, next).catch(next);
  };
}

export function requestContext(request: AuthenticatedRequest, response: Response, next: NextFunction): void {
  const candidate = request.header("x-request-id");
  request.requestId = candidate && /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : randomUUID();
  response.setHeader("x-request-id", request.requestId);
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self' wss:; img-src 'self' data:; style-src 'self'; script-src 'self'",
  );
  next();
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const cookie = cookieHeader ?? "";
  const output: Record<string, string> = {};
  for (const part of cookie.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    try {
      output[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return output;
}

export function parseCookies(request: Request): Record<string, string> {
  return parseCookieHeader(request.headers.cookie);
}

export function pathParam(request: Request, name: string): string {
  const raw = request.params[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    throw new HttpError(400, "VALIDATION_ERROR", `缺少路径参数 ${name}`);
  }
  return value;
}

export function setSessionCookies(
  response: Response,
  accessToken: string,
  refreshToken: string,
): void {
  const secure = config.cookieSecure ? "; Secure" : "";
  response.append(
    "set-cookie",
    `ht_access=${encodeURIComponent(accessToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.accessTokenSeconds}${secure}`,
  );
  response.append(
    "set-cookie",
    `ht_refresh=${encodeURIComponent(refreshToken)}; Path=/api/v1/auth; HttpOnly; SameSite=Strict; Max-Age=${config.refreshTokenSeconds}${secure}`,
  );
}

export function clearSessionCookies(response: Response): void {
  const secure = config.cookieSecure ? "; Secure" : "";
  response.append("set-cookie", `ht_access=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
  response.append(
    "set-cookie",
    `ht_refresh=; Path=/api/v1/auth; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  );
}

type SessionRow = {
  session_id: string;
  user_id: string;
  device_id: string | null;
  username: string;
  display_name: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  password_state: "normal" | "must_change";
  token_version: string;
  session_token_version: string;
  csrf_token_hash: string;
};

export const authenticate: RequestHandler = asyncHandler(async (request, _response, next) => {
  const authorization = request.header("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const cookieToken = parseCookies(request).ht_access;
  const token = bearer ?? cookieToken;
  if (!token) {
    next();
    return;
  }
  const session = await one<SessionRow>(
    `SELECT s.id::text AS session_id, s.user_id::text, s.device_id::text,
            u.username, u.display_name, u.role, u.status, u.password_state,
            u.token_version::text, s.token_version::text AS session_token_version,
            s.csrf_token_hash
       FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.access_token_hash=$1 AND s.revoked_at IS NULL
        AND s.access_expires_at > now()`,
    [tokenHash(token)],
  );
  if (!session) {
    if (["/api/v1/auth/login", "/api/v1/auth/device", "/api/v1/auth/refresh"].includes(request.path)) {
      next();
      return;
    }
    throw new HttpError(401, "SESSION_REVOKED", "会话已过期或被撤销");
  }
  if (session.status !== "active") throw new HttpError(423, "USER_DISABLED", "账号已禁用");
  if (session.token_version !== session.session_token_version) {
    throw new HttpError(401, "SESSION_REVOKED", "会话版本已失效");
  }
  request.actor = {
    sessionId: session.session_id,
    userId: session.user_id,
    deviceId: session.device_id,
    username: session.username,
    displayName: session.display_name,
    role: session.role,
    status: session.status,
    passwordState: session.password_state,
    tokenVersion: Number(session.token_version),
    csrfTokenHash: session.csrf_token_hash,
    authSource: bearer ? "bearer" : "cookie",
  };
  next();
});

export function requireActor(request: AuthenticatedRequest): AuthenticatedActor {
  if (!request.actor) throw new HttpError(401, "AUTH_REQUIRED", "请先登录");
  return request.actor;
}

export function requireAdmin(request: AuthenticatedRequest): AuthenticatedActor {
  const actor = requireActor(request);
  if (actor.role !== "admin") throw new HttpError(403, "FORBIDDEN", "需要管理员权限");
  return actor;
}

export function requirePasswordNormal(request: AuthenticatedRequest): AuthenticatedActor {
  const actor = requireActor(request);
  if (actor.passwordState !== "normal") {
    throw new HttpError(423, "PASSWORD_CHANGE_REQUIRED", "首次登录必须修改密码");
  }
  return actor;
}

export function requireCsrf(request: AuthenticatedRequest): void {
  const actor = requireActor(request);
  if (actor.authSource !== "cookie" || ["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const csrf = request.header("x-csrf-token") ?? "";
  if (!csrf || !constantTimeStringEqual(tokenHash(csrf), actor.csrfTokenHash)) {
    throw new HttpError(403, "CSRF_INVALID", "请求校验失败，请刷新页面后重试");
  }
}

export type IssuedSession = {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

export async function issueSession(
  client: PoolClient,
  user: { id: string; token_version: string | number },
  deviceId: string | null,
): Promise<IssuedSession> {
  const sessionId = randomUUID();
  const family = randomUUID();
  const accessToken = opaqueToken();
  const refreshToken = opaqueToken();
  const csrfToken = opaqueToken(24);
  const accessExpiresAt = new Date(Date.now() + config.accessTokenSeconds * 1000);
  const refreshExpiresAt = new Date(Date.now() + config.refreshTokenSeconds * 1000);
  await client.query(
    `INSERT INTO sessions(
       id,user_id,device_id,token_family,token_version,access_token_hash,refresh_token_hash,
       csrf_token_hash,access_expires_at,refresh_expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      sessionId,
      user.id,
      deviceId,
      family,
      Number(user.token_version),
      tokenHash(accessToken),
      tokenHash(refreshToken),
      tokenHash(csrfToken),
      accessExpiresAt,
      refreshExpiresAt,
    ],
  );
  return {
    sessionId,
    accessToken,
    refreshToken,
    csrfToken,
    accessExpiresAt: accessExpiresAt.toISOString(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
  };
}

export function parseExpectedVersion(request: Request, bodyVersion?: unknown): number {
  const ifMatch = request.header("if-match")?.replace(/^W\//, "").replaceAll('"', "");
  const raw = ifMatch ?? bodyVersion;
  const version = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new HttpError(400, "VALIDATION_ERROR", "写请求必须携带有效的 If-Match 或 expected_version", {
      field_errors: { expected_version: "必须为正整数" },
    });
  }
  return version;
}

export function sourceIp(request: Request): string | null {
  const value = request.ip?.replace(/^::ffff:/, "") ?? "";
  return /^[0-9a-f:.]+$/i.test(value) ? value : null;
}

export async function audit(
  client: PoolClient,
  request: AuthenticatedRequest,
  action: string,
  targetType: string,
  targetId: string | null,
  beforeValue: unknown,
  afterValue: unknown,
  actorOverride?: { type: string; id: string | null },
): Promise<void> {
  const actor = request.actor;
  await client.query(
    `INSERT INTO audit_events(
       actor_type,actor_id,action,target_type,target_id,before_value,after_value,request_id,source_ip)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      actorOverride?.type ?? (actor ? "user" : "anonymous"),
      actorOverride?.id ?? actor?.userId ?? null,
      action,
      targetType,
      targetId,
      beforeValue == null ? null : JSON.stringify(beforeValue),
      afterValue == null ? null : JSON.stringify(afterValue),
      request.requestId ?? randomUUID(),
      sourceIp(request),
    ],
  );
}

export async function revokeTokenFamily(family: string): Promise<void> {
  await query("UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()), updated_at=now() WHERE token_family=$1", [
    family,
  ]);
}

export function errorMiddleware(
  error: unknown,
  request: AuthenticatedRequest,
  response: Response,
  _next: NextFunction,
): void {
  if (response.headersSent) return;
  const requestId = request.requestId ?? randomUUID();
  if (error instanceof HttpError) {
    response.status(error.status).json({
      error_code: error.errorCode,
      message: error.message,
      request_id: requestId,
      ...error.details,
    });
    return;
  }
  const databaseError = error as { code?: string; constraint?: string };
  if (databaseError?.code === "23505") {
    const subdomain = databaseError.constraint?.includes("subdomain");
    response.status(409).json({
      error_code: subdomain ? "SUBDOMAIN_CONFLICT" : "STATE_CONFLICT",
      message: subdomain ? "子域已被占用" : "唯一性约束冲突",
      request_id: requestId,
    });
    return;
  }
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      component: "control-center",
      request_id: requestId,
      event_code: "UNHANDLED_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  response.status(500).json({
    error_code: "INTERNAL_ERROR",
    message: "服务器内部错误",
    request_id: requestId,
  });
}
