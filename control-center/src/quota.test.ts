import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import type { AlertEvent } from "./notifications.js";

process.env.NODE_ENV = "test";
process.env.SQLITE_PATH = ":memory:";
process.env.INTERNAL_SERVICE_KEY ??= "11".repeat(32);
process.env.FRPS_PLUGIN_KEY ??= "22".repeat(32);
process.env.LEASE_SIGNING_KEY ??= "33".repeat(32);

const db = await import("./db.js");
const quota = await import("./quota.js");

const events: AlertEvent[] = [];
const dispatch = async (event: AlertEvent) => {
  events.push(event);
  return { delivered: true, deduplicated: false, results: [] };
};
const latest = (type: string) => [...events].reverse().find((event) => event.event_type === type);

const userId = randomUUID();
const deviceId = randomUUID();
const connectionId = randomUUID();

before(async () => {
  await db.migrate();
  await db.query(
    `INSERT INTO users(id,username,display_name,password_hash,password_state,role)
     VALUES(?,?,?,?,'normal','user')`,
    [userId, "quota-user", "Quota User", "unused-hash"],
  );
  await db.query(
    "INSERT INTO traffic_policies(id,scope_type,scope_id,monthly_quota_bytes) VALUES(?,'user',?,?)",
    [randomUUID(), userId, 1000],
  );
  await db.query(
    `INSERT INTO devices(id,user_id,name,install_id,fingerprint_hash,credential_hash,status,last_seen_at)
     VALUES(?,?,?,?,?,?, 'active', home_tunnel_now())`,
    [deviceId, userId, "quota-device", "install", "fingerprint", "credential"],
  );
  await db.query(
    `INSERT INTO connections(id,user_id,device_id,name,subdomain,local_scheme,local_host,local_port,enabled)
     VALUES(?,?,?,?,?, 'http','127.0.0.1',8080,1)`,
    [connectionId, userId, deviceId, "quota-conn", "quota"],
  );
});

after(async () => {
  await db.closeDatabase();
});

async function addSampleBytes(upload: number, download: number): Promise<void> {
  await db.query(
    `INSERT INTO traffic_samples(batch_id,bucket_start,bucket_seconds,user_id,device_id,connection_id,
       upload_bytes,download_bytes,request_count,error_count)
     VALUES(?,home_tunnel_now(),60,?,?,?,?,?,1,0)`,
    [randomUUID(), userId, deviceId, connectionId, upload, download],
  );
}

test("month-to-date usage merges traffic_samples and traffic_hourly without double counting", async () => {
  await addSampleBytes(300, 200);
  await db.query(
    `INSERT INTO traffic_hourly(bucket_start,user_id,device_id,connection_id,upload_bytes,download_bytes,request_count,error_count)
     VALUES(home_tunnel_hour(home_tunnel_now()),?,?,?,100,50,1,0)`,
    [userId, deviceId, connectionId],
  );
  const usage = await quota.monthToDateUsage();
  const row = usage.find((entry) => entry.userId === userId);
  assert.ok(row);
  assert.equal(row.usedBytes, 650);
  assert.equal(row.quotaBytes, 1000);
});

test("crossing 80% raises a single warning without suspending", async () => {
  await addSampleBytes(200, 0); // total 850 / 1000 = 85%
  const stats = await quota.runQuotaEnforcement(dispatch);
  assert.equal(stats.warned, 1);
  assert.equal(stats.suspended, 0);
  assert.equal(latest("quota.warning")?.severity, "warning");
  const user = await db.one<{ quota_suspended_at: string | null; quota_warned_at: string | null }>(
    "SELECT quota_suspended_at,quota_warned_at FROM users WHERE id=?",
    [userId],
  );
  assert.equal(user?.quota_suspended_at, null);
  assert.ok(user?.quota_warned_at);
  // 同一月内不重复预警。
  const again = await quota.runQuotaEnforcement(dispatch);
  assert.equal(again.warned, 0);
});

test("reaching the quota suspends the user, writes outbox, and never bumps device config", async () => {
  const before = await db.one<{ config_version: string }>(
    "SELECT config_version FROM devices WHERE id=?",
    [deviceId],
  );
  await addSampleBytes(200, 0); // total 1050 / 1000 = 105%
  const stats = await quota.runQuotaEnforcement(dispatch);
  assert.equal(stats.suspended, 1);
  assert.equal(latest("quota.suspended")?.severity, "critical");
  const user = await db.one<{ quota_suspended_at: string | null }>(
    "SELECT quota_suspended_at FROM users WHERE id=?",
    [userId],
  );
  assert.ok(user?.quota_suspended_at);
  const outbox = await db.one<{ count: number }>(
    "SELECT count(*) AS count FROM outbox_events WHERE event_type='quota.suspended' AND recipient_user_id=?",
    [userId],
  );
  assert.ok(Number(outbox?.count) >= 1);
  const after = await db.one<{ config_version: string }>(
    "SELECT config_version FROM devices WHERE id=?",
    [deviceId],
  );
  assert.equal(Number(after?.config_version), Number(before?.config_version));
});

test("raising the quota above usage restores the user", async () => {
  await db.query(
    "UPDATE traffic_policies SET monthly_quota_bytes=? WHERE scope_type='user' AND scope_id=?",
    [10_000_000, userId],
  );
  const stats = await quota.runQuotaEnforcement(dispatch);
  assert.equal(stats.restored, 1);
  assert.equal(latest("quota.restored")?.severity, "info");
  const user = await db.one<{ quota_suspended_at: string | null }>(
    "SELECT quota_suspended_at FROM users WHERE id=?",
    [userId],
  );
  assert.equal(user?.quota_suspended_at, null);
});

test("clearing the quota restores a user suspended under an earlier limit", async () => {
  await db.query(
    "UPDATE traffic_policies SET monthly_quota_bytes=? WHERE scope_type='user' AND scope_id=?",
    [1, userId],
  );
  const suspend = await quota.runQuotaEnforcement(dispatch);
  assert.equal(suspend.suspended, 1);
  await db.query(
    "UPDATE traffic_policies SET monthly_quota_bytes=NULL WHERE scope_type='user' AND scope_id=?",
    [userId],
  );
  const restore = await quota.runQuotaEnforcement(dispatch);
  assert.equal(restore.restored, 1);
  const user = await db.one<{ quota_suspended_at: string | null }>(
    "SELECT quota_suspended_at FROM users WHERE id=?",
    [userId],
  );
  assert.equal(user?.quota_suspended_at, null);
});

test("device offline and recovery alerts flip on the persisted flag", async () => {
  await db.query(
    "UPDATE devices SET last_seen_at=home_tunnel_add_seconds(home_tunnel_now(),-600) WHERE id=?",
    [deviceId],
  );
  const offline = await quota.runDeviceOfflineCheck(dispatch);
  assert.equal(offline.offline, 1);
  assert.equal(latest("device.offline")?.severity, "warning");
  const flagged = await db.one<{ offline_alerted_at: string | null }>(
    "SELECT offline_alerted_at FROM devices WHERE id=?",
    [deviceId],
  );
  assert.ok(flagged?.offline_alerted_at);
  // 再次检查不重复告警。
  const stable = await quota.runDeviceOfflineCheck(dispatch);
  assert.equal(stable.offline, 0);

  await db.query("UPDATE devices SET last_seen_at=home_tunnel_now() WHERE id=?", [deviceId]);
  const recovered = await quota.runDeviceOfflineCheck(dispatch);
  assert.equal(recovered.recovered, 1);
  assert.equal(latest("device.online")?.severity, "info");
  const cleared = await db.one<{ offline_alerted_at: string | null }>(
    "SELECT offline_alerted_at FROM devices WHERE id=?",
    [deviceId],
  );
  assert.equal(cleared?.offline_alerted_at, null);
});
