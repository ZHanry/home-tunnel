import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { argon2id } from "hash-wasm";
import { config } from "./config.js";

const ARGON_MEMORY_KIB = 65_536;
const ARGON_ITERATIONS = 3;
const ARGON_PARALLELISM = 1;

export class PasswordWorkQueueFullError extends Error {
  constructor() {
    super("Password hashing queue is full");
    this.name = "PasswordWorkQueueFullError";
  }
}

class PasswordWorkLimiter {
  private active = 0;
  private readonly queued: Array<{
    operation: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.queued.length >= config.passwordHashQueueMax) throw new PasswordWorkQueueFullError();
    return new Promise<T>((resolve, reject) => {
      this.queued.push({
        operation,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < config.passwordHashConcurrency) {
      const job = this.queued.shift();
      if (!job) return;
      this.active += 1;
      void job.operation()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

const passwordWork = new PasswordWorkLimiter();

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
  const hash = await passwordWork.run(() => argon2id({
    password,
    salt,
    parallelism: ARGON_PARALLELISM,
    iterations: ARGON_ITERATIONS,
    memorySize: ARGON_MEMORY_KIB,
    hashLength: 32,
    outputType: "hex",
  }));
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
    const actualHex = await passwordWork.run(() => argon2id({
      password,
      salt,
      parallelism,
      iterations,
      memorySize,
      hashLength: expected.length,
      outputType: "hex",
    }));
    const actual = Buffer.from(actualHex, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch (error) {
    if (error instanceof PasswordWorkQueueFullError) throw error;
    return false;
  }
}

// 隧道 Basic Auth 门禁口令使用 scrypt（node:crypto 内置，零新依赖）：
// 网关侧可以低成本地按需验证，与 hash-wasm Argon2（账号登录密码）互不混用。
// 输出格式 scrypt$N$r$p$saltB64$hashB64，网关按同一格式独立实现验证。
const BASIC_SCRYPT_COST = 16_384;
const BASIC_SCRYPT_BLOCK_SIZE = 8;
const BASIC_SCRYPT_PARALLELISM = 1;
const BASIC_SCRYPT_KEY_LENGTH = 32;
const BASIC_SCRYPT_MAXMEM = 256 * 1024 * 1024;

export function hashBasicPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, BASIC_SCRYPT_KEY_LENGTH, {
    N: BASIC_SCRYPT_COST,
    r: BASIC_SCRYPT_BLOCK_SIZE,
    p: BASIC_SCRYPT_PARALLELISM,
    maxmem: BASIC_SCRYPT_MAXMEM,
  });
  return `scrypt$${BASIC_SCRYPT_COST}$${BASIC_SCRYPT_BLOCK_SIZE}$${BASIC_SCRYPT_PARALLELISM}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyBasicPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const cost = Number(parts[1]);
    const blockSize = Number(parts[2]);
    const parallelism = Number(parts[3]);
    if (!Number.isInteger(cost) || cost < 1024 || cost > 65_536 || (cost & (cost - 1)) !== 0) return false;
    if (!Number.isInteger(blockSize) || blockSize < 1 || blockSize > 16) return false;
    if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > 4) return false;
    const salt = Buffer.from(parts[4] ?? "", "base64");
    const expected = Buffer.from(parts[5] ?? "", "base64");
    if (salt.length < 8 || expected.length < 16 || expected.length > 64) return false;
    const actual = scryptSync(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelism,
      maxmem: BASIC_SCRYPT_MAXMEM,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function parseIpv4Bytes(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    // 拒绝空段、非数字与前导零（避免八进制歧义解释）
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith("0"))) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

// 统一解析为 16 字节：IPv4 与 IPv4-mapped IPv6 都归一到 ::ffff:a.b.c.d 的
// 字节形式，使 IPv4/IPv6 白名单条目可在同一字节域内按前缀比较。
export function parseIpBytes(text: string): Uint8Array | null {
  const value = text.trim();
  if (!value) return null;
  if (!value.includes(":")) {
    const ipv4 = parseIpv4Bytes(value);
    if (!ipv4) return null;
    const bytes = new Uint8Array(16);
    bytes[10] = 0xff;
    bytes[11] = 0xff;
    bytes.set(ipv4, 12);
    return bytes;
  }
  let head = value;
  let tail: string | null = null;
  const marker = value.indexOf("::");
  if (marker >= 0) {
    if (value.indexOf("::", marker + 1) >= 0) return null;
    head = value.slice(0, marker);
    tail = value.slice(marker + 2);
  }
  const parseGroups = (part: string): number[] | null => {
    if (!part) return [];
    const groups = part.split(":");
    const words: number[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index] ?? "";
      if (group.includes(".")) {
        // 内嵌 IPv4 只允许出现在最后一组
        if (index !== groups.length - 1) return null;
        const ipv4 = parseIpv4Bytes(group);
        if (!ipv4) return null;
        words.push(((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0), ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0));
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
        words.push(Number.parseInt(group, 16));
      }
    }
    return words;
  };
  const headWords = parseGroups(head);
  const tailWords = tail === null ? [] : parseGroups(tail);
  if (!headWords || !tailWords) return null;
  const total = headWords.length + tailWords.length;
  if (tail === null ? total !== 8 : total > 7) return null;
  const words = [...headWords, ...Array.from({ length: 8 - total }, () => 0), ...tailWords];
  const bytes = new Uint8Array(16);
  words.forEach((word, index) => {
    bytes[index * 2] = word >> 8;
    bytes[index * 2 + 1] = word & 0xff;
  });
  return bytes;
}

export type CidrRule = { bytes: Uint8Array; prefixBits: number };

// 接受单 IP（等价 /32、/128）或 CIDR。IPv4 前缀映射到 IPv4-mapped 空间
// （prefix + 96），与 parseIpBytes 的 16 字节归一保持一致。
export function parseCidr(text: string): CidrRule | null {
  const value = text.trim();
  if (!value) return null;
  const slash = value.indexOf("/");
  const ipText = slash >= 0 ? value.slice(0, slash) : value;
  const isIpv4 = !ipText.includes(":");
  const bytes = parseIpBytes(ipText);
  if (!bytes) return null;
  let prefixBits = 128;
  if (slash >= 0) {
    const prefixText = value.slice(slash + 1);
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    const prefix = Number(prefixText);
    if (prefix > (isIpv4 ? 32 : 128)) return null;
    prefixBits = isIpv4 ? prefix + 96 : prefix;
  }
  return { bytes, prefixBits };
}

export function cidrContains(rule: CidrRule, ip: Uint8Array): boolean {
  if (rule.bytes.length !== ip.length) return false;
  const fullBytes = rule.prefixBits >> 3;
  for (let index = 0; index < fullBytes; index += 1) {
    if (rule.bytes[index] !== ip[index]) return false;
  }
  const remainder = rule.prefixBits & 7;
  if (!remainder) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (((rule.bytes[fullBytes] ?? 0) ^ (ip[fullBytes] ?? 0)) & mask) === 0;
}

export function opaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  // randomInt draws uniformly, avoiding the modulo bias of `byte % length`.
  return Array.from({ length: 24 }, () => alphabet[randomInt(alphabet.length)]).join("");
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
  // Keys contain attacker-controlled input (ip:username), so the map is capped:
  // reaching the cap first sweeps expired windows, then evicts oldest entries.
  static readonly maxEntries = 10_000;

  private readonly buckets = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const current = this.buckets.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      if (!current && this.buckets.size >= FixedWindowLimiter.maxEntries) this.evict(now);
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

  private evict(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(key);
    }
    let overflow = this.buckets.size - FixedWindowLimiter.maxEntries + 1;
    if (overflow <= 0) return;
    // Map iteration order is insertion order, so this drops the oldest windows.
    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      overflow -= 1;
      if (overflow <= 0) break;
    }
  }
}
