import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue, type StatementSync } from "node:sqlite";
import { config } from "./config.js";
import { hashPassword } from "./security.js";

export type DatabaseRow = Record<string, unknown>;

export type QueryResult<T extends DatabaseRow = DatabaseRow> = {
  rows: T[];
  rowCount: number;
};

export type DatabaseClient = {
  query<T extends DatabaseRow = DatabaseRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};

class Mutex {
  private tail = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

const dateColumns = new Set(["bucket_start"]);
const jsonColumns = new Set(["before_value", "after_value", "payload"]);
const booleanColumns = new Set(["enabled", "device_lease_valid"]);

function asIsoDate(value: string): Date | string {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : value;
}

function decodeRow<T extends DatabaseRow>(row: Record<string, SQLOutputValue>): T {
  const decoded: DatabaseRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null) {
      decoded[key] = null;
    } else if (booleanColumns.has(key) && typeof value === "number") {
      decoded[key] = value !== 0;
    } else if ((key.endsWith("_at") || dateColumns.has(key)) && typeof value === "string") {
      decoded[key] = asIsoDate(value);
    } else if (jsonColumns.has(key) && typeof value === "string") {
      try {
        decoded[key] = JSON.parse(value) as unknown;
      } catch {
        decoded[key] = value;
      }
    } else {
      decoded[key] = value;
    }
  }
  return decoded as T;
}

function bindValue(value: unknown): SQLInputValue {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) {
    throw new Error("SQLite array parameters must be expanded by the caller");
  }
  return JSON.stringify(value);
}

function databaseError(error: unknown): never {
  if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
    Object.assign(error, { code: "23505", constraint: error.message });
  }
  if (error instanceof Error && error.message.includes("FOREIGN KEY constraint failed")) {
    Object.assign(error, { code: "23503", constraint: error.message });
  }
  throw error;
}

const databasePath = config.database.path;
if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });

const database = new DatabaseSync(databasePath, {
  enableForeignKeyConstraints: true,
  enableDoubleQuotedStringLiterals: false,
});

database.function("home_tunnel_now", () => new Date().toISOString());
database.function("home_tunnel_add_seconds", (value, seconds) => {
  const milliseconds = Date.parse(String(value));
  return new Date(milliseconds + Number(seconds) * 1000).toISOString();
});
database.function("home_tunnel_from_unix", (seconds) => new Date(Number(seconds) * 1000).toISOString());
database.function("home_tunnel_hour", (value) => {
  const date = new Date(String(value));
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
});
// UTC 自然月月初（ISO），供月度配额把 traffic_samples/traffic_hourly 的
// bucket_start（同为 ISO 文本）做字典序比较，无需在每条 SQL 里传参。
database.function("home_tunnel_month_start", () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
});
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA cache_size = -8192;
  PRAGMA journal_size_limit = 16777216;
`);
if (databasePath !== ":memory:") chmodSync(databasePath, 0o600);

const mutex = new Mutex();
export const databaseEvents = new EventEmitter();
databaseEvents.setMaxListeners(128);

type PreparedQuery = {
  statement: StatementSync;
  hasRows: boolean;
  touchesOutbox: boolean;
};

// All application SQL is written as static template strings, so caching the
// prepared StatementSync avoids re-preparing on every call. The cap is
// defensive: only IN-list queries with a variable placeholder count generate
// new keys.
const statementCacheLimit = 500;
const statementCache = new Map<string, PreparedQuery>();

// All queries are written in native SQLite dialect with anonymous `?`
// placeholders. A leftover PostgreSQL-style `$n` placeholder would otherwise
// be rejected by SQLite with a confusing syntax error (or silently parsed as
// something else), so fail fast with an explicit message.
const postgresPlaceholderPattern = /\$\d+/;

function prepareQuery(text: string): PreparedQuery {
  const cached = statementCache.get(text);
  if (cached) return cached;
  if (postgresPlaceholderPattern.test(text)) {
    throw new Error(
      `SQL must use SQLite '?' placeholders, found PostgreSQL-style '$n': ${text.trim().slice(0, 120)}`,
    );
  }
  const statement = database.prepare(text);
  const entry: PreparedQuery = {
    statement,
    hasRows: statement.columns().length > 0,
    touchesOutbox: /\bINSERT\s+INTO\s+outbox_events\b/i.test(text),
  };
  if (statementCache.size >= statementCacheLimit) statementCache.clear();
  statementCache.set(text, entry);
  return entry;
}

class SqliteClient implements DatabaseClient {
  outboxChanged = false;

  async query<T extends DatabaseRow = DatabaseRow>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
    try {
      const { statement, hasRows, touchesOutbox } = prepareQuery(text);
      const bindings = values.map(bindValue);
      if (hasRows) {
        const rows = statement.all(...bindings).map((row) => decodeRow<T>(row));
        if (touchesOutbox) this.outboxChanged = true;
        return { rows, rowCount: rows.length };
      }
      const result = statement.run(...bindings);
      if (touchesOutbox) this.outboxChanged = true;
      return { rows: [], rowCount: Number(result.changes) };
    } catch (error) {
      databaseError(error);
    }
  }
}

function emitOutboxChanged(): void {
  queueMicrotask(() => databaseEvents.emit("outbox"));
}

// Detects accidental use of the module-level query()/transaction() from inside
// a transaction callback, which would deadlock on the mutex. Independent
// concurrent callers are unaffected: they run in their own async context and
// simply queue on the mutex.
const transactionContext = new AsyncLocalStorage<true>();

function assertNotInTransaction(entryPoint: string): void {
  if (transactionContext.getStore()) {
    throw new Error(`${entryPoint} must not be called inside transaction(); use the transaction client instead`);
  }
}

export async function query<T extends DatabaseRow = DatabaseRow>(text: string, values: unknown[] = []): Promise<T[]> {
  assertNotInTransaction("query()");
  return mutex.run(async () => {
    const client = new SqliteClient();
    const result = await client.query<T>(text, values);
    if (client.outboxChanged) emitOutboxChanged();
    return result.rows;
  });
}

export async function one<T extends DatabaseRow = DatabaseRow>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function transaction<T>(operation: (client: DatabaseClient) => Promise<T>): Promise<T> {
  assertNotInTransaction("transaction()");
  return mutex.run(async () =>
    transactionContext.run(true, async () => {
      const client = new SqliteClient();
      database.exec("BEGIN IMMEDIATE");
      try {
        const value = await operation(client);
        database.exec("COMMIT");
        if (client.outboxChanged) emitOutboxChanged();
        return value;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }),
  );
}

export const pool = {
  query: async <T extends DatabaseRow = DatabaseRow>(text: string, values: unknown[] = []): Promise<QueryResult<T>> => {
    const rows = await query<T>(text, values);
    return { rows, rowCount: rows.length };
  },
};

export async function migrate(): Promise<void> {
  await mutex.run(async () => {
    // DDL can invalidate cached prepared statements; drop them so any query
    // issued after (re-)migration is prepared against the new schema.
    statementCache.clear();
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
    `);
    const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
    const migrations = readdirSync(migrationsDirectory)
      .map((name) => ({ name, match: /^(\d+)_.*\.sql$/.exec(name) }))
      .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
      .map((entry) => ({ name: entry.name, version: Number(entry.match[1]) }))
      .sort((left, right) => left.version - right.version);
    if (!migrations.length || migrations.some((entry) => !Number.isSafeInteger(entry.version) || entry.version < 1)) {
      throw new Error("No valid database migrations were found");
    }
    const applied = new Set(
      database.prepare("SELECT version FROM schema_migrations").all().map((row) => Number(row.version)),
    );
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      const sql = readFileSync(join(migrationsDirectory, migration.name), "utf8");
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(sql);
        database.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES(?)").run(migration.version);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
  });
}

export async function bootstrapAdmin(): Promise<void> {
  const existing = await one<{ count: number }>("SELECT count(*) AS count FROM users WHERE role='admin'");
  if (Number(existing?.count ?? 0) > 0) return;
  if (!config.bootstrapAdminPassword) {
    throw new Error("No admin exists and BOOTSTRAP_ADMIN_PASSWORD(_FILE) is empty");
  }
  const passwordHash = await hashPassword(config.bootstrapAdminPassword);
  const userId = randomUUID();
  const policyId = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO users(id,username,display_name,password_hash,password_state,temporary_password_expires_at,role)
       VALUES(?,?,?,?,'must_change',home_tunnel_add_seconds(home_tunnel_now(),?),'admin')`,
      [userId, config.bootstrapAdminUsername, "系统管理员", passwordHash, config.temporaryPasswordSeconds],
    );
    await client.query(
      `INSERT INTO traffic_policies(id,scope_type,scope_id,bandwidth_limit_bps)
       VALUES(?,'user',?,NULL)`,
      [policyId, userId],
    );
    await client.query(
      `INSERT INTO audit_events(actor_type,action,target_type,target_id,after_value,request_id)
       VALUES('system','BootstrapAdminCreated','User',?,?,?)`,
      [userId, JSON.stringify({ username: config.bootstrapAdminUsername, role: "admin" }), randomUUID()],
    );
  });
}

// Writes a consistent point-in-time snapshot of the whole database to
// targetPath via VACUUM INTO. Runs on the shared mutex so it never interleaves
// with an open transaction; VACUUM INTO itself must not run inside one.
export async function backupDatabase(targetPath: string): Promise<void> {
  assertNotInTransaction("backupDatabase()");
  await mutex.run(async () => {
    database.exec(`VACUUM INTO '${targetPath.replaceAll("'", "''")}'`);
  });
}

export async function closeDatabase(): Promise<void> {
  await mutex.run(async () => {
    statementCache.clear();
    database.exec("PRAGMA optimize");
    database.close();
  });
}
