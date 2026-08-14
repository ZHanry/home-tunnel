import { scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { metrics } from "./observability.js";
import type { Policy } from "./policy.js";

export function constantTimeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function clientIp(request: IncomingMessage): string {
  const forwarded = String(request.headers["x-forwarded-for"] ?? "")
    .split(",")
    .at(-1)
    ?.trim();
  return forwarded && /^[0-9a-f:.]+$/i.test(forwarded)
    ? forwarded
    : (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
export const accessStats = { scryptVerifications: 0, basicCacheHits: 0 };

async function verifyScryptHash(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const cost = Number(parts[1]);
    const blockSize = Number(parts[2]);
    const parallelism = Number(parts[3]);
    if (!Number.isInteger(cost) || cost < 1024 || cost > 65_536 || (cost & (cost - 1)) !== 0)
      return false;
    if (!Number.isInteger(blockSize) || blockSize < 1 || blockSize > 16) return false;
    if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > 4) return false;
    const salt = Buffer.from(parts[4] ?? "", "base64");
    const expected = Buffer.from(parts[5] ?? "", "base64");
    if (salt.length < 8 || expected.length < 16 || expected.length > 64) return false;
    const actual = await scryptAsync(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelism,
      maxmem: 256 * 1024 * 1024,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function parseBasicAuthorization(header: string): { username: string; password: string } | null {
  const match = /^basic\s+([a-z0-9+/=_-]+)$/i.exec(header.trim());
  if (!match?.[1]) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  return colon < 0
    ? null
    : { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

const basicAuthCacheTtlMs = 5 * 60 * 1000;
const basicAuthCacheMaxEntries = 1000;
const basicAuthCache = new Map<string, number>();
function basicAuthCacheGet(key: string): boolean {
  const expiresAt = basicAuthCache.get(key);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    basicAuthCache.delete(key);
    return false;
  }
  basicAuthCache.delete(key);
  basicAuthCache.set(key, expiresAt);
  return true;
}
function basicAuthCachePut(key: string): void {
  if (basicAuthCache.size >= basicAuthCacheMaxEntries) {
    const oldest = basicAuthCache.keys().next().value;
    if (oldest !== undefined) basicAuthCache.delete(oldest);
  }
  basicAuthCache.set(key, Date.now() + basicAuthCacheTtlMs);
}

export async function verifyBasicAuthorization(policy: Policy, header: string): Promise<boolean> {
  if (!policy.access_basic_user || !policy.access_basic_hash) return false;
  const cacheKey = `${policy.connection_id}:${policy.access_policy_version}:${header}`;
  if (basicAuthCacheGet(cacheKey)) {
    accessStats.basicCacheHits += 1;
    return true;
  }
  const credentials = parseBasicAuthorization(header);
  if (!credentials) return false;
  accessStats.scryptVerifications += 1;
  const usernameMatches = constantTimeStringEqual(credentials.username, policy.access_basic_user);
  const passwordMatches = await verifyScryptHash(credentials.password, policy.access_basic_hash);
  if (!usernameMatches || !passwordMatches) return false;
  basicAuthCachePut(cacheKey);
  return true;
}

export function basicAuthChallenge(response: ServerResponse): void {
  metrics.accessDeniedTotal.basic += 1;
  if (response.destroyed) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "www-authenticate": 'Basic realm="Home Tunnel"',
  });
  response.end(
    JSON.stringify({
      error_code: "ACCESS_BASIC_UNAUTHORIZED",
      message: "该连接要求 Basic Auth 凭据",
    }),
  );
}
