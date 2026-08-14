import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.SQLITE_PATH = ":memory:";
process.env.INTERNAL_SERVICE_KEY = "11".repeat(32);
process.env.FRPS_PLUGIN_KEY = "22".repeat(32);
process.env.LEASE_SIGNING_KEY = "33".repeat(32);
process.env.COOKIE_SECURE = "false";
process.env.OFFLINE_LEASE_MAX_SECONDS = "86400";
process.env.PASSWORD_HASH_CONCURRENCY = "1";
process.env.PASSWORD_HASH_QUEUE_MAX = "1";

const security = await import("./security.js");

test("Argon2id password hashes are salted and verifiable", async () => {
  const password = "Correct horse battery staple 2026!";
  const first = await security.hashPassword(password);
  const second = await security.hashPassword(password);
  assert.match(first, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.notEqual(first, second);
  assert.equal(await security.verifyPassword(first, password), true);
  assert.equal(await security.verifyPassword(first, "incorrect password"), false);
  assert.equal(
    await security.verifyPassword(first.replace("m=65536", "m=999999999"), password),
    false,
  );
});

test("Argon2 work is serialized and rejects queue overflow", async () => {
  const first = security.hashPassword("Queue test password one M7!");
  const second = security.hashPassword("Queue test password two Q9!");
  await assert.rejects(
    security.hashPassword("Queue test password three R4!"),
    security.PasswordWorkQueueFullError,
  );
  const completed = await Promise.all([first, second]);
  assert.equal(completed.length, 2);
});

test("password and subdomain policies reject unsafe values", () => {
  assert.equal(security.normalizeUsername("  ＡＤＭＩＮ  "), "admin");
  assert.equal(security.normalizeSubdomain(" Service-01 "), "service-01");
  assert.equal(security.validateSubdomain("service-01"), null);
  assert.match(security.validateSubdomain("console") ?? "", /保留/);
  assert.notEqual(security.validateSubdomain("two.labels"), null);
  assert.notEqual(security.validatePassword("short", "alice"), null);
  assert.notEqual(security.validatePassword("Alice-has-a-long-password", "alice"), null);
  assert.notEqual(security.validatePassword("password1234", "alice"), null);
  assert.equal(security.validatePassword("M7!wQ2#kP9$vR4@z", "alice"), null);
});

test("signed leases enforce integrity, subject, time, and hard lifetime", () => {
  const now = Math.floor(Date.now() / 1000);
  const base = {
    sub: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    device_id: "11111111-1111-4111-8111-111111111111",
    config_version: 7,
    token_version: 3,
    iat: now,
    exp: now + 3600,
    jti: "33333333-3333-4333-8333-333333333333",
  };
  const lease = security.signLease(base);
  assert.deepEqual(security.verifyLease(lease)?.device_id, base.device_id);
  assert.equal(security.verifyLease(`${lease.slice(0, -1)}x`), null);
  assert.equal(security.verifyLease(security.signLease({ ...base, sub: base.user_id })), null);
  assert.equal(
    security.verifyLease(security.signLease({ ...base, iat: now - 20, exp: now - 1 })),
    null,
  );
  assert.equal(security.verifyLease(security.signLease({ ...base, exp: now + 86401 })), null);

  const [, body] = lease.split(".");
  assert.ok(body);
  const forgedHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT", kid: "v1" })).toString(
    "base64url",
  );
  const forgedSignature = createHmac("sha256", process.env.LEASE_SIGNING_KEY!)
    .update(`${forgedHeader}.${body}`)
    .digest("base64url");
  assert.equal(security.verifyLease(`${forgedHeader}.${body}.${forgedSignature}`), null);
});

test("fixed-window limiter returns a bounded retry delay", () => {
  const limiter = new security.FixedWindowLimiter(2, 1000);
  assert.equal(limiter.take("subject").allowed, true);
  assert.equal(limiter.take("subject").allowed, true);
  const denied = limiter.take("subject");
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterSeconds >= 1);
});

test("Basic Auth scrypt hashes are salted, verifiable, and tamper-resistant", () => {
  const password = "gate password 42!";
  const first = security.hashBasicPassword(password);
  const second = security.hashBasicPassword(password);
  assert.match(first, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(first, second, "random salts must yield distinct hashes");
  assert.equal(security.verifyBasicPassword(password, first), true);
  assert.equal(security.verifyBasicPassword(password, second), true);
  assert.equal(security.verifyBasicPassword("wrong password", first), false);
  assert.equal(security.verifyBasicPassword("", first), false);
});

test("verifyBasicPassword rejects malformed or hostile stored hashes", () => {
  const valid = security.hashBasicPassword("another gate pass 7");
  const [, , , , saltB64, hashB64] = valid.split("$");
  assert.equal(security.verifyBasicPassword("x", ""), false);
  assert.equal(security.verifyBasicPassword("x", "plaintext"), false);
  assert.equal(security.verifyBasicPassword("x", "argon2$16384$8$1$a$b"), false);
  // 篡改后的哈希体
  assert.equal(
    security.verifyBasicPassword("another gate pass 7", `${valid.slice(0, -2)}xx`),
    false,
  );
  // 非 2 的幂 / 超界的成本参数（防 CPU/内存放大）
  assert.equal(security.verifyBasicPassword("x", `scrypt$12345$8$1$${saltB64}$${hashB64}`), false);
  assert.equal(security.verifyBasicPassword("x", `scrypt$131072$8$1$${saltB64}$${hashB64}`), false);
  assert.equal(security.verifyBasicPassword("x", `scrypt$16384$99$1$${saltB64}$${hashB64}`), false);
  assert.equal(security.verifyBasicPassword("x", `scrypt$16384$8$9$${saltB64}$${hashB64}`), false);
  // 盐/哈希长度不足
  assert.equal(security.verifyBasicPassword("x", "scrypt$16384$8$1$c2FsdA==$c2hvcnQ="), false);
});

test("CIDR parsing and containment cover IPv4, IPv6, and mapped normalization", () => {
  assert.equal(security.parseCidr("not an ip"), null);
  assert.equal(security.parseCidr("192.168.1.0/33"), null);
  assert.equal(security.parseCidr("2001:db8::/129"), null);
  assert.equal(security.parseCidr("01.2.3.4"), null);

  const ipv4Rule = security.parseCidr("192.168.1.0/24");
  const ipv6Rule = security.parseCidr("2001:db8::/32");
  assert.ok(ipv4Rule && ipv6Rule);
  const contains = (rule: NonNullable<ReturnType<typeof security.parseCidr>>, ip: string) => {
    const bytes = security.parseIpBytes(ip);
    assert.ok(bytes, `ip ${ip} must parse`);
    return security.cidrContains(rule, bytes);
  };
  assert.equal(contains(ipv4Rule, "192.168.1.9"), true);
  assert.equal(contains(ipv4Rule, "192.168.2.9"), false);
  assert.equal(contains(ipv4Rule, "::ffff:192.168.1.9"), true, "IPv4-mapped must normalize");
  assert.equal(contains(ipv6Rule, "2001:db8:1::1"), true);
  assert.equal(contains(ipv6Rule, "2001:db9::1"), false);
});
