import { chmodSync, mkdirSync } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { backupDatabase } from "./db.js";

const backupFilePattern = /^control-center-\d{8}T\d{6}Z\.sqlite3$/;

let lastSuccessMs = 0;

// Unix milliseconds of the most recent successful backup in this process,
// 0 when none has completed yet. Exposed through /internal/metrics.
export function backupLastSuccessAt(): number {
  return lastSuccessMs;
}

export function backupsEnabled(): boolean {
  return config.database.path !== ":memory:" && config.backup.intervalHours > 0 && config.backup.directory !== "";
}

function backupFileName(now: Date): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll("-", "").replaceAll(":", "");
  return `control-center-${stamp}.sqlite3`;
}

export async function runDatabaseBackup(now = new Date()): Promise<{ path: string; deletedCount: number }> {
  if (!config.backup.directory) {
    throw new Error("Database backups require a file-backed database or an explicit BACKUP_DIRECTORY");
  }
  mkdirSync(config.backup.directory, { recursive: true, mode: 0o700 });
  const targetPath = join(config.backup.directory, backupFileName(now));
  await backupDatabase(targetPath);
  chmodSync(targetPath, 0o600);
  lastSuccessMs = Date.now();
  // File names embed a UTC timestamp, so the lexicographic order is the
  // chronological order; everything beyond the newest retentionCount goes.
  const snapshots = (await readdir(config.backup.directory))
    .filter((name) => backupFilePattern.test(name))
    .sort();
  const excess = Math.max(0, snapshots.length - config.backup.retentionCount);
  for (let index = 0; index < excess; index += 1) {
    await unlink(join(config.backup.directory, snapshots[index]!));
  }
  return { path: targetPath, deletedCount: excess };
}

export function startDatabaseBackups(): { close: () => void } {
  if (!backupsEnabled()) return { close: () => undefined };
  let closed = false;
  const execute = () => {
    if (closed) return;
    void runDatabaseBackup()
      .then(({ path, deletedCount }) => {
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          component: "control-center",
          event_code: "BACKUP_COMPLETED",
          path,
          deleted_count: deletedCount,
        }));
      })
      .catch((error) => console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        component: "control-center",
        event_code: "BACKUP_FAILED",
        message: error instanceof Error ? error.message : "Unknown backup error",
      })));
  };
  const initialTimer = setTimeout(execute, 60_000);
  const intervalTimer = setInterval(execute, config.backup.intervalHours * 60 * 60 * 1000);
  initialTimer.unref();
  intervalTimer.unref();
  return {
    close: () => {
      closed = true;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    },
  };
}
