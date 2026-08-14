import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationsDirectory = new URL("../migrations/", import.meta.url);
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d+_.*\.sql$/.test(name))
  .sort();

function apply(database: DatabaseSync, names: string[]): void {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) STRICT;`);
  for (const name of names) {
    const version = Number(name.slice(0, 3));
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(readFileSync(new URL(name, migrationsDirectory), "utf8"));
      const hasChecksum = database
        .prepare("PRAGMA table_info(schema_migrations)")
        .all()
        .some((column) => String(column.name) === "checksum_sha256");
      if (hasChecksum) {
        database.prepare("INSERT INTO schema_migrations(version) VALUES(?)").run(version);
      } else {
        database.prepare("INSERT INTO schema_migrations(version) VALUES(?)").run(version);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

test("the earliest public database upgrades additively through every migration", () => {
  const database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  try {
    apply(database, [migrations[0]!]);
    database
      .prepare(
        `INSERT INTO users(id,username,display_name,password_hash,password_state,role)
       VALUES('user-1','alice','Alice','hash','normal','user')`,
      )
      .run();
    apply(database, migrations.slice(1));
    assert.deepEqual(
      database
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all()
        .map((row) => Number(row.version)),
      migrations.map((name) => Number(name.slice(0, 3))),
    );
    const user = database
      .prepare("SELECT username,quota_suspended_at FROM users WHERE id='user-1'")
      .get();
    assert.equal(user?.username, "alice");
    assert.equal(user?.quota_suspended_at, null);
    const columns = database
      .prepare("PRAGMA table_info(connections)")
      .all()
      .map((row) => String(row.name));
    for (const column of ["access_policy_version", "proxy_type", "tcp_remote_port"])
      assert.ok(columns.includes(column));
    assert.ok(
      database
        .prepare("PRAGMA table_info(schema_migrations)")
        .all()
        .some((row) => String(row.name) === "checksum_sha256"),
    );
  } finally {
    database.close();
  }
});

test("a file backup restores data and can continue to accept writes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "home-tunnel-restore-test-"));
  const sourcePath = join(directory, "source.sqlite3");
  const backupPath = join(directory, "backup.sqlite3");
  const restoredPath = join(directory, "restored.sqlite3");
  try {
    const source = new DatabaseSync(sourcePath, { enableForeignKeyConstraints: true });
    apply(source, migrations);
    source
      .prepare(
        `INSERT INTO users(id,username,display_name,password_hash,password_state,role)
       VALUES('user-restore','restored','Restored User','hash','normal','user')`,
      )
      .run();
    source.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
    source.close();
    copyFileSync(backupPath, restoredPath);
    const restored = new DatabaseSync(restoredPath, { enableForeignKeyConstraints: true });
    try {
      assert.equal(restored.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      assert.equal(
        restored.prepare("SELECT username FROM users WHERE id='user-restore'").get()?.username,
        "restored",
      );
      restored.prepare("UPDATE users SET display_name='Recovered' WHERE id='user-restore'").run();
      assert.equal(
        restored.prepare("SELECT display_name FROM users WHERE id='user-restore'").get()
          ?.display_name,
        "Recovered",
      );
    } finally {
      restored.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed migration rolls back its schema and migration journal atomically", () => {
  const database = new DatabaseSync(":memory:");
  try {
    apply(database, [migrations[0]!]);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec("CREATE TABLE migration_should_rollback(id INTEGER PRIMARY KEY) STRICT;");
      database.exec("THIS IS NOT VALID SQL");
      database.prepare("INSERT INTO schema_migrations(version) VALUES(999)").run();
      database.exec("COMMIT");
      assert.fail("invalid migration unexpectedly committed");
    } catch {
      database.exec("ROLLBACK");
    }
    assert.equal(
      database
        .prepare("SELECT name FROM sqlite_master WHERE name='migration_should_rollback'")
        .get(),
      undefined,
    );
    assert.equal(
      database.prepare("SELECT version FROM schema_migrations WHERE version=999").get(),
      undefined,
    );
  } finally {
    database.close();
  }
});
