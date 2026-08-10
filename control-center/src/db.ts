import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
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

function intervalSeconds(amount: string, unit: string): number {
  const value = Number.parseInt(amount, 10);
  if (unit.startsWith("second")) return value;
  if (unit.startsWith("minute")) return value * 60;
  if (unit.startsWith("hour")) return value * 60 * 60;
  return value * 24 * 60 * 60;
}

function normalizeSql(text: string): { sql: string; bindingIndexes: number[] } {
  let sql = text;
  sql = sql.replace(/\$(\d+)::(?:uuid|text|jsonb|timestamptz|int|integer|bigint|inet)(?:\[\])?/gi, "?$1");
  sql = sql.replace(/\$(\d+)/g, "?$1");
  sql = sql.replace(/::(?:uuid|text|jsonb|timestamptz|int|integer|bigint|inet)(?:\[\])?/gi, "");
  sql = sql.replace(/\bFOR\s+UPDATE(?:\s+OF\s+[a-z_][a-z0-9_]*)?(?:\s+SKIP\s+LOCKED)?/gi, "");
  sql = sql.replace(/\bILIKE\b/gi, "LIKE");
  sql = sql.replace(/\bGREATEST\s*\(/gi, "max(");
  sql = sql.replace(
    /now\(\)\s*\+\s*make_interval\(secs\s*=>\s*\?(\d+)\)/gi,
    "home_tunnel_add_seconds(home_tunnel_now(), ?$1)",
  );
  sql = sql.replace(
    /now\(\)\s*-\s*make_interval\(hours\s*=>\s*\?(\d+)\)/gi,
    "home_tunnel_add_seconds(home_tunnel_now(), -3600 * ?$1)",
  );
  sql = sql.replace(
    /now\(\)\s*([+-])\s*interval\s*'(\d+)\s+(seconds?|minutes?|hours?|days?)'/gi,
    (_match, sign: string, amount: string, unit: string) => {
      const seconds = intervalSeconds(amount, unit) * (sign === "-" ? -1 : 1);
      return `home_tunnel_add_seconds(home_tunnel_now(), ${seconds})`;
    },
  );
  sql = sql.replace(/\bto_timestamp\s*\(/gi, "home_tunnel_from_unix(");
  sql = sql.replace(/\bdate_trunc\s*\(\s*'hour'\s*,/gi, "home_tunnel_hour(");
  sql = sql.replace(/\bnow\(\)/gi, "home_tunnel_now()");
  const bindingIndexes: number[] = [];
  sql = sql.replace(/\?(\d+)/g, (_match, index: string) => {
    bindingIndexes.push(Number(index) - 1);
    return "?";
  });
  return { sql: sql.trim(), bindingIndexes };
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

class SqliteClient implements DatabaseClient {
  outboxChanged = false;

  async query<T extends DatabaseRow = DatabaseRow>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
    const { sql, bindingIndexes } = normalizeSql(text);
    try {
      const statement = database.prepare(sql);
      const orderedValues = bindingIndexes.length
        ? bindingIndexes.map((index) => {
            if (index < 0 || index >= values.length) {
              throw new Error(`Missing SQLite binding for parameter $${index + 1}`);
            }
            return values[index];
          })
        : values;
      const bindings = orderedValues.map(bindValue);
      const hasRows = statement.columns().length > 0;
      if (hasRows) {
        const rows = statement.all(...bindings).map((row) => decodeRow<T>(row));
        if (/\bINSERT\s+INTO\s+outbox_events\b/i.test(sql)) this.outboxChanged = true;
        return { rows, rowCount: rows.length };
      }
      const result = statement.run(...bindings);
      if (/\bINSERT\s+INTO\s+outbox_events\b/i.test(sql)) this.outboxChanged = true;
      return { rows: [], rowCount: Number(result.changes) };
    } catch (error) {
      databaseError(error);
    }
  }
}

function emitOutboxChanged(): void {
  queueMicrotask(() => databaseEvents.emit("outbox"));
}

export async function query<T extends DatabaseRow = DatabaseRow>(text: string, values: unknown[] = []): Promise<T[]> {
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
  return mutex.run(async () => {
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
  });
}

export const pool = {
  query: async <T extends DatabaseRow = DatabaseRow>(text: string, values: unknown[] = []): Promise<QueryResult<T>> => {
    const rows = await query<T>(text, values);
    return { rows, rowCount: rows.length };
  },
};

export async function migrate(): Promise<void> {
  await mutex.run(async () => {
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
       VALUES($1,$2,$3,$4,'must_change',home_tunnel_add_seconds(home_tunnel_now(),$5),'admin')`,
      [userId, config.bootstrapAdminUsername, "系统管理员", passwordHash, config.temporaryPasswordSeconds],
    );
    await client.query(
      `INSERT INTO traffic_policies(id,scope_type,scope_id,bandwidth_limit_bps)
       VALUES($1,'user',$2,NULL)`,
      [policyId, userId],
    );
    await client.query(
      `INSERT INTO audit_events(actor_type,action,target_type,target_id,after_value,request_id)
       VALUES('system','BootstrapAdminCreated','User',$1,$2,$3)`,
      [userId, JSON.stringify({ username: config.bootstrapAdminUsername, role: "admin" }), randomUUID()],
    );
  });
}

export async function closeDatabase(): Promise<void> {
  await mutex.run(async () => {
    database.exec("PRAGMA optimize");
    database.close();
  });
}
