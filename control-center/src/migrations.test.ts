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
    for (const column of [
      "access_policy_version",
      "proxy_type",
      "tcp_remote_port",
      "transport_type",
      "remote_port",
    ])
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

test("the L4 migration copies legacy TCP and mirrors canonical TCP/UDP fields", () => {
  const database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  try {
    const l4Index = migrations.findIndex((name) => name.startsWith("008_"));
    assert.ok(l4Index > 0, "008 L4 migration is present");
    apply(database, migrations.slice(0, l4Index));
    database.exec(`
      INSERT INTO users(id,username,display_name,password_hash,password_state,role)
      VALUES('user-l4','l4-user','L4 User','hash','normal','user');
      INSERT INTO devices(id,user_id,name,install_id,fingerprint_hash,credential_hash)
      VALUES('device-l4','user-l4','L4 Device','install-l4','fingerprint-l4','credential-l4');
      INSERT INTO connections(
        id,user_id,device_id,name,subdomain,local_scheme,local_host,local_port,
        proxy_type,tcp_remote_port)
      VALUES(
        'connection-tcp','user-l4','device-l4','Legacy TCP','legacy-tcp','http','127.0.0.1',22,
        'tcp',10001);
    `);

    apply(database, migrations.slice(l4Index));
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT transport_type,remote_port,proxy_type,tcp_remote_port
             FROM connections WHERE id='connection-tcp'`,
          )
          .get(),
      },
      {
        transport_type: "tcp",
        remote_port: 10001,
        proxy_type: "tcp",
        tcp_remote_port: 10001,
      },
    );

    // 模拟数据库已升级但 v3.0 进程仍在运行：INSERT 完全不提新列。
    database
      .prepare(
        `INSERT INTO connections(
           id,user_id,device_id,name,subdomain,local_scheme,local_host,local_port,
           proxy_type,tcp_remote_port)
         VALUES('connection-old-writer','user-l4','device-l4','Old writer TCP','old-writer-tcp',
                'http','127.0.0.1',22,'tcp',10002)`,
      )
      .run();
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT transport_type,remote_port,proxy_type,tcp_remote_port
               FROM connections WHERE id='connection-old-writer'`,
          )
          .get(),
      },
      {
        transport_type: "tcp",
        remote_port: 10002,
        proxy_type: "tcp",
        tcp_remote_port: 10002,
      },
    );

    // 旧 writer 只更新 legacy 端口时，canonical 端口同步前进。
    database
      .prepare(
        `UPDATE connections SET tcp_remote_port=10003
          WHERE id='connection-old-writer'`,
      )
      .run();
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT transport_type,remote_port,proxy_type,tcp_remote_port
               FROM connections WHERE id='connection-old-writer'`,
          )
          .get(),
      },
      {
        transport_type: "tcp",
        remote_port: 10003,
        proxy_type: "tcp",
        tcp_remote_port: 10003,
      },
    );

    // 旧 writer 把 TCP 改回 HTTP 时，新列与残留端口也必须同步清理。
    database
      .prepare(
        `UPDATE connections SET proxy_type='http',tcp_remote_port=NULL
          WHERE id='connection-old-writer'`,
      )
      .run();
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT transport_type,remote_port,proxy_type,tcp_remote_port
               FROM connections WHERE id='connection-old-writer'`,
          )
          .get(),
      },
      {
        transport_type: "http",
        remote_port: null,
        proxy_type: "http",
        tcp_remote_port: null,
      },
    );

    assert.throws(() =>
      database
        .prepare(
          `UPDATE connections SET proxy_type='tcp',tcp_remote_port=10001
            WHERE id='connection-old-writer'`,
        )
        .run(),
    );
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT transport_type,remote_port,proxy_type,tcp_remote_port
               FROM connections WHERE id='connection-old-writer'`,
          )
          .get(),
      },
      {
        transport_type: "http",
        remote_port: null,
        proxy_type: "http",
        tcp_remote_port: null,
      },
    );

    // 唯一约束必须在旧 INSERT 被 canonicalize 后生效，并原子回滚整次写入。
    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO connections(
             id,user_id,device_id,name,subdomain,local_scheme,local_host,local_port,
             proxy_type,tcp_remote_port)
           VALUES('connection-old-conflict','user-l4','device-l4','Old writer conflict',
                  'old-writer-conflict','http','127.0.0.1',22,'tcp',10001)`,
        )
        .run(),
    );
    assert.equal(
      database
        .prepare("SELECT count(*) AS count FROM connections WHERE id='connection-old-conflict'")
        .get()?.count,
      0,
    );

    database
      .prepare(
        `INSERT INTO connections(
           id,user_id,device_id,name,subdomain,local_scheme,local_host,local_port,
           transport_type,remote_port,proxy_type,tcp_remote_port)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "connection-udp",
        "user-l4",
        "device-l4",
        "UDP",
        "udp",
        "http",
        "127.0.0.1",
        53,
        "udp",
        10001,
        "http",
        10002,
      );
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT transport_type,remote_port,proxy_type,tcp_remote_port
             FROM connections WHERE id='connection-udp'`,
          )
          .get(),
      },
      {
        transport_type: "udp",
        remote_port: 10001,
        proxy_type: "tcp",
        tcp_remote_port: null,
      },
    );
    assert.throws(() =>
      database
        .prepare(
          `UPDATE connections SET proxy_type='tcp',tcp_remote_port=10002
            WHERE id='connection-udp'`,
        )
        .run(),
    );
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT transport_type,remote_port,proxy_type,tcp_remote_port
               FROM connections WHERE id='connection-udp'`,
          )
          .get(),
      },
      {
        transport_type: "udp",
        remote_port: 10001,
        proxy_type: "tcp",
        tcp_remote_port: null,
      },
    );
    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO connections(
             id,user_id,device_id,name,subdomain,local_scheme,local_host,local_port,
             transport_type,remote_port,proxy_type)
           VALUES('connection-udp-duplicate','user-l4','device-l4','UDP duplicate','udp-duplicate',
                  'http','127.0.0.1',53,'udp',10001,'tcp')`,
        )
        .run(),
    );
    assert.throws(() =>
      database
        .prepare(
          `UPDATE connections SET transport_type='http',remote_port=10002
            WHERE id='connection-udp'`,
        )
        .run(),
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
