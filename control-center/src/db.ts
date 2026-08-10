import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg, { type PoolClient, type QueryResultRow } from "pg";
import { config } from "./config.js";
import { hashPassword } from "./security.js";

const { Pool } = pg;

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: config.database.max,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: "home-tunnel-control-center",
});

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

export async function one<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(): Promise<void> {
  const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
  const migrations = (await readdir(migrationsDirectory))
    .map((name) => ({ name, match: /^(\d+)_.*\.sql$/.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({ name: entry.name, version: Number(entry.match[1]) }))
    .sort((left, right) => left.version - right.version);
  if (!migrations.length || migrations.some((entry) => !Number.isSafeInteger(entry.version) || entry.version < 1)) {
    throw new Error("No valid database migrations were found");
  }
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(1212384742)");
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version integer PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const applied = await client.query<{ version: number }>("SELECT version FROM schema_migrations");
    const appliedVersions = new Set(applied.rows.map((row) => Number(row.version)));
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      const sql = await readFile(new URL(`../migrations/${migration.name}`, import.meta.url), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT (version) DO NOTHING", [
          migration.version,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(1212384742)").catch(() => undefined);
    client.release();
  }
}

export async function bootstrapAdmin(): Promise<void> {
  const existing = await one<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE role='admin'");
  if (Number(existing?.count ?? 0) > 0) return;
  if (!config.bootstrapAdminPassword) {
    throw new Error("No admin exists and BOOTSTRAP_ADMIN_PASSWORD(_FILE) is empty");
  }
  const passwordHash = await hashPassword(config.bootstrapAdminPassword);
  const userId = randomUUID();
  const policyId = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO users(id, username, display_name, password_hash, password_state, temporary_password_expires_at, role)
       VALUES ($1,$2,$3,$4,'must_change', now() + make_interval(secs => $5), 'admin')`,
      [userId, config.bootstrapAdminUsername, "系统管理员", passwordHash, config.temporaryPasswordSeconds],
    );
    await client.query(
      `INSERT INTO traffic_policies(id, scope_type, scope_id, bandwidth_limit_bps)
       VALUES ($1,'user',$2,NULL)`,
      [policyId, userId],
    );
    await client.query(
      `INSERT INTO audit_events(actor_type, action, target_type, target_id, after_value, request_id)
       VALUES ('system','BootstrapAdminCreated','User',$1,$2,$3)`,
      [userId, JSON.stringify({ username: config.bootstrapAdminUsername, role: "admin" }), randomUUID()],
    );
  });
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
