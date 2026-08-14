import assert from "node:assert/strict";
import test, { after } from "node:test";

process.env.NODE_ENV = "test";
process.env.SQLITE_PATH = ":memory:";
process.env.INTERNAL_SERVICE_KEY ??= "11".repeat(32);
process.env.FRPS_PLUGIN_KEY ??= "22".repeat(32);
process.env.LEASE_SIGNING_KEY ??= "33".repeat(32);
process.env.COOKIE_SECURE = "false";

const db = await import("./db.js");

after(async () => {
  await db.closeDatabase();
});

test("leftover PostgreSQL-style $n placeholders are rejected with an explicit error", async () => {
  await assert.rejects(
    db.query("SELECT * FROM sqlite_master WHERE name=$1", ["users"]),
    /SQL must use SQLite '\?' placeholders/,
  );
  await assert.rejects(
    db.transaction(async (client) => client.query("SELECT $2 AS answer", [1, 2])),
    /SQL must use SQLite '\?' placeholders/,
  );
});

test("custom SQLite functions cover the retired PostgreSQL time expressions", async () => {
  const row = await db.one<{ now: string; shifted: string; from_unix: string; hour: string }>(
    `SELECT home_tunnel_now() AS now,
            home_tunnel_add_seconds('2026-08-12T11:59:30.000Z', 30) AS shifted,
            home_tunnel_from_unix(1755000000) AS from_unix,
            home_tunnel_hour('2026-08-12T12:34:56.789Z') AS hour`,
  );
  assert.ok(row);
  assert.match(row.now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Math.abs(Date.parse(row.now) - Date.now()) < 5_000);
  assert.equal(row.shifted, "2026-08-12T12:00:00.000Z");
  assert.equal(row.from_unix, new Date(1755000000 * 1000).toISOString());
  assert.equal(row.hour, "2026-08-12T12:00:00.000Z");
});

test("repeated values bind positionally when passed once per placeholder", async () => {
  const row = await db.one<{ matches: number }>("SELECT (? = ?) AS matches", ["same", "same"]);
  assert.equal(row?.matches, 1);
});

test("query reuses cached prepared statements across calls and after migrate", async () => {
  const first = await db.query<{ answer: number }>("SELECT ? AS answer", [41]);
  const second = await db.query<{ answer: number }>("SELECT ? AS answer", [42]);
  assert.equal(first[0]?.answer, 41);
  assert.equal(second[0]?.answer, 42);
  await db.migrate();
  const users = await db.one<{ count: number }>("SELECT count(*) AS count FROM users");
  assert.equal(users?.count, 0);
});

test("transaction rejects re-entrant module-level query and nested transaction", async () => {
  await assert.rejects(
    db.transaction(async () => {
      await db.query("SELECT 1 AS one");
    }),
    /must not be called inside transaction/,
  );
  await assert.rejects(
    db.transaction(async () => db.transaction(async () => undefined)),
    /must not be called inside transaction/,
  );
  await assert.rejects(
    db.transaction(async () => db.backupDatabase("unused.sqlite3")),
    /must not be called inside transaction/,
  );
});

test("sequential and concurrent independent calls are not treated as re-entrant", async () => {
  const inTransaction = await db.transaction(async (client) => {
    const rows = await client.query<{ one: number }>("SELECT 1 AS one");
    return rows.rows[0]?.one;
  });
  assert.equal(inTransaction, 1);
  const afterTransaction = await db.one<{ one: number }>("SELECT 1 AS one");
  assert.equal(afterTransaction?.one, 1);
  const [transactional, direct] = await Promise.all([
    db.transaction(
      async (client) => (await client.query<{ one: number }>("SELECT 1 AS one")).rows[0]?.one,
    ),
    db.query<{ one: number }>("SELECT 1 AS one"),
  ]);
  assert.equal(transactional, 1);
  assert.equal(direct[0]?.one, 1);
});

test("outbox notifications leave the writer transaction context", async () => {
  const notification = new Promise<void>((resolve, reject) => {
    db.databaseEvents.once("outbox", () => {
      void db
        .one<{ one: number }>("SELECT 1 AS one")
        .then(
          (row) =>
            row?.one === 1 ? resolve() : reject(new Error("unexpected outbox query result")),
          reject,
        );
    });
  });
  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO outbox_events(event_type,resource_type,resource_id,resource_version,payload)
       VALUES(?,?,?,?,?)`,
      ["test.context", "test", "context", 1, {}],
    );
  });
  await notification;
});
