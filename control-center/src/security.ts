import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { argon2id } from "hash-wasm";
import { config } from "./config.js";

const ARGON_MEMORY_KIB = 65_536;
const ARGON_ITERATIONS = 3;
const ARGON_PARALLELISM = 1;

export const reservedSubdomains = new Set([
  "console",
  "admin",
  "api",
  "auth",
  "caddy",
  "frp",
  "frps",
  "gateway",
  "status",
  "tunnel",
  "www",
]);

export function normalizeUsername(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function normalizeSubdomain(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function validateSubdomain(value: string): string | null {
  const normalized = normalizeSubdomain(value);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
    return "子域必须为 1-63 位小写字母、数字或连字符，且首尾不能为连字符";
  }
  if (reservedSubdomains.has(normalized)) return "该子域为系统保留名称";
  return null;
}

export function validatePassword(password: string, username: string): string | null {
  if (password.length < 12) return "密码至少需要 12 个字符";
  if (password.length > 256) return "密码不能超过 256 个字符";
  if (!password.trim()) return "密码不能只包含空白字符";
  if (password.toLowerCase().includes(username.toLowerCase())) return "密码不能包含用户名";
  const weak = new Set([
    "password1234",
    "password12345",
    "123456789012",
    "1234567890ab",
    "qwertyuiop12",
    "adminadmin12",
    "letmein123456",
    "welcome123456",
  ]);
  if (weak.has(password.toLowerCase())) return "该密码过于常见，请使用密码管理器生成随机密码";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2id({
    password,
    salt,
    parallelism: ARGON_PARALLELISM,
    iterations: ARGON_ITERATIONS,
    memorySize: ARGON_MEMORY_KIB,
    hashLength: 32,
    outputType: "hex",
  });
  return `$argon2id$v=19$m=${ARGON_MEMORY_KIB},t=${ARGON_ITERATIONS},p=${ARGON_PARALLELISM}$${salt.toString("base64url")}$${hash}`;
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  try {
    const parts = encoded.split("$");
    if (parts.length !== 6 || parts[1] !== "argon2id") return false;
    const params = Object.fromEntries((parts[3] ?? "").split(",").map((item) => item.split("=")));
    const memorySize = Number.parseInt(params.m ?? "", 10);
    const iterations = Number.parseInt(params.t ?? "", 10);
    const parallelism = Number.parseInt(params.p ?? "", 10);
    if (
      memorySize < 16_384 ||
      memorySize > 1_048_576 ||
      iterations < 1 ||
      iterations > 10 ||
      parallelism < 1 ||
      parallelism > 8
    ) return false;
    const salt = Buffer.from(parts[4] ?? "", "base64url");
    const expected = Buffer.from(parts[5] ?? "", "hex");
    const actualHex = await argon2id({
      password,
      salt,
      parallelism,
      iterations,
      memorySize,
      hashLength: expected.length,
      outputType: "hex",
    });
    const actual = Buffer.from(actualHex, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function opaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = randomBytes(24);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function constantTimeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type LeasePayload = {
  iss: "home-tunnel-control";
  sub: string;
  user_id: string;
  device_id: string;
  config_version: number;
  token_version: number;
  iat: number;
  exp: number;
  jti: string;
  key_id: "v1";
};

function jsonPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function signLease(payload: Omit<LeasePayload, "iss" | "key_id">): string {
  const header = jsonPart({ alg: "HS256", typ: "JWT", kid: "v1" });
  const body = jsonPart({ ...payload, iss: "home-tunnel-control", key_id: "v1" });
  const signature = createHmac("sha256", config.leaseSigningKey)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyLease(token: string): LeasePayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    if (!header || !body || !signature) return null;
    const expected = createHmac("sha256", config.leaseSigningKey)
      .update(`${header}.${body}`)
      .digest("base64url");
    if (!constantTimeStringEqual(signature, expected)) return null;
    const protectedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as {
      alg?: string;
      typ?: string;
      kid?: string;
    };
    if (protectedHeader.alg !== "HS256" || protectedHeader.typ !== "JWT" || protectedHeader.kid !== "v1") {
      return null;
    }
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LeasePayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== "home-tunnel-control" || payload.key_id !== "v1") return null;
    if (!payload.user_id || !payload.device_id || payload.sub !== payload.device_id) return null;
    if (
      !Number.isSafeInteger(payload.config_version) ||
      payload.config_version < 1 ||
      !Number.isSafeInteger(payload.token_version) ||
      payload.token_version < 1 ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= payload.iat ||
      payload.exp <= now ||
      payload.iat > now + 60
    ) return null;
    if (payload.exp - payload.iat > config.offlineLeaseMaxSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const current = this.buckets.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    current.count += 1;
    if (current.count <= this.limit) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((this.windowMs - (now - current.startedAt)) / 1000)),
    };
  }
}
