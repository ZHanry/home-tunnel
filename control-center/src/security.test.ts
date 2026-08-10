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
  assert.equal(await security.verifyPassword(first.replace("m=65536", "m=999999999"), password), false);
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
  assert.equal(security.verifyLease(security.signLease({ ...base, iat: now - 20, exp: now - 1 })), null);
  assert.equal(security.verifyLease(security.signLease({ ...base, exp: now + 86401 })), null);

  const [, body] = lease.split(".");
  assert.ok(body);
  const forgedHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT", kid: "v1" })).toString("base64url");
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
