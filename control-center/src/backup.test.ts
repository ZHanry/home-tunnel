import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";

process.env.NODE_ENV = "test";
process.env.SQLITE_PATH = ":memory:";
process.env.INTERNAL_SERVICE_KEY ??= "11".repeat(32);
process.env.FRPS_PLUGIN_KEY ??= "22".repeat(32);
process.env.LEASE_SIGNING_KEY ??= "33".repeat(32);
process.env.COOKIE_SECURE = "false";

// config.ts 在模块加载时求值，必须在 import 之前设置备份目录与保留数。
const backupDirectory = mkdtempSync(join(tmpdir(), "home-tunnel-backup-test-"));
process.env.BACKUP_DIRECTORY = backupDirectory;
process.env.BACKUP_RETENTION_COUNT = "2";

const db = await import("./db.js");
const backup = await import("./backup.js");

after(async () => {
  await db.closeDatabase();
  await rm(backupDirectory, { recursive: true, force: true });
});

test("scheduled backups stay disabled for in-memory databases", () => {
  assert.equal(backup.backupsEnabled(), false);
  assert.equal(backup.backupLastSuccessAt(), 0);
});

test("runDatabaseBackup writes a snapshot that DatabaseSync can open", async () => {
  await db.migrate();
  const result = await backup.runDatabaseBackup(new Date("2026-08-12T01:00:00Z"));
  assert.equal(result.path, join(backupDirectory, "control-center-20260812T010000Z.sqlite3"));
  assert.equal(result.deletedCount, 0);
  assert.ok(backup.backupLastSuccessAt() > 0);

  const snapshot = new DatabaseSync(result.path);
  try {
    const migrations = snapshot.prepare("SELECT count(*) AS count FROM schema_migrations").get();
    assert.ok(Number(migrations?.count) >= 2);
    const users = snapshot.prepare("SELECT count(*) AS count FROM users").get();
    assert.equal(Number(users?.count), 0);
  } finally {
    snapshot.close();
  }
});

test("retention keeps only the newest snapshots and deletes the oldest", async () => {
  await backup.runDatabaseBackup(new Date("2026-08-12T02:00:00Z"));
  const third = await backup.runDatabaseBackup(new Date("2026-08-12T03:00:00Z"));
  assert.equal(third.deletedCount, 1);
  const names = readdirSync(backupDirectory).sort();
  assert.deepEqual(names, [
    "control-center-20260812T020000Z.sqlite3",
    "control-center-20260812T030000Z.sqlite3",
  ]);
});
