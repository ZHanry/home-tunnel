import { setImmediate as yieldEventLoop } from "node:timers/promises";
import { startDatabaseBackups } from "./backup.js";
import { transaction } from "./db.js";
import { startQuotaAndAlertChecks } from "./quota.js";

const batchSize = 5_000;
const maximumBatchesPerRun = 20;

type MaintenanceStats = {
  traffic_samples_archived: number;
  traffic_hourly_deleted: number;
  audit_events_deleted: number;
  sessions_deleted: number;
  outbox_events_deleted: number;
};

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

// Each batch commits in its own transaction and yields the event loop afterwards
// so the global database mutex is never held for the whole maintenance run.
async function deleteByIds(
  table: string,
  where: string,
  values: unknown[],
): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < maximumBatchesPerRun; batch += 1) {
    const deleted = await transaction(async (client) => {
      const rows = await client.query<{ id: number }>(
        `SELECT id FROM ${table} WHERE ${where} ORDER BY id LIMIT ${batchSize}`,
        values,
      );
      const ids = rows.rows.map((row) => row.id);
      if (!ids.length) return 0;
      const result = await client.query(
        `DELETE FROM ${table} WHERE id IN (${placeholders(ids.length)})`,
        ids,
      );
      return result.rowCount;
    });
    total += deleted;
    if (deleted < batchSize) break;
    await yieldEventLoop();
  }
  return total;
}

async function archiveTrafficSamplesBatch(cutoff: Date): Promise<{ archived: number; selectedCount: number }> {
  return transaction(async (client) => {
    const selected = await client.query<{
      id: number;
      bucket_start: Date;
      user_id: string;
      device_id: string;
      connection_id: string;
      upload_bytes: number;
      download_bytes: number;
      request_count: number;
      error_count: number;
    }    >(
      `SELECT id,bucket_start,user_id,device_id,connection_id,
              upload_bytes,download_bytes,request_count,error_count
         FROM traffic_samples WHERE bucket_start < ? ORDER BY bucket_start,id LIMIT ${batchSize}`,
      [cutoff],
    );
    if (!selected.rows.length) return { archived: 0, selectedCount: 0 };
    const aggregates = new Map<string, {
      bucketStart: string;
      userId: string;
      deviceId: string;
      connectionId: string;
      uploadBytes: number;
      downloadBytes: number;
      requestCount: number;
      errorCount: number;
    }>();
    for (const sample of selected.rows) {
      const hour = new Date(sample.bucket_start);
      hour.setUTCMinutes(0, 0, 0);
      const bucketStart = hour.toISOString();
      const key = `${sample.connection_id}:${bucketStart}`;
      const aggregate = aggregates.get(key) ?? {
        bucketStart,
        userId: sample.user_id,
        deviceId: sample.device_id,
        connectionId: sample.connection_id,
        uploadBytes: 0,
        downloadBytes: 0,
        requestCount: 0,
        errorCount: 0,
      };
      aggregate.uploadBytes += Number(sample.upload_bytes);
      aggregate.downloadBytes += Number(sample.download_bytes);
      aggregate.requestCount += Number(sample.request_count);
      aggregate.errorCount += Number(sample.error_count);
      aggregates.set(key, aggregate);
    }
    for (const aggregate of aggregates.values()) {
      await client.query(
        `INSERT INTO traffic_hourly(
           bucket_start,user_id,device_id,connection_id,upload_bytes,download_bytes,request_count,error_count)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(connection_id,bucket_start) DO UPDATE SET
           upload_bytes=traffic_hourly.upload_bytes+excluded.upload_bytes,
           download_bytes=traffic_hourly.download_bytes+excluded.download_bytes,
           request_count=traffic_hourly.request_count+excluded.request_count,
           error_count=traffic_hourly.error_count+excluded.error_count,
           updated_at=home_tunnel_now()`,
        [
          aggregate.bucketStart,
          aggregate.userId,
          aggregate.deviceId,
          aggregate.connectionId,
          aggregate.uploadBytes,
          aggregate.downloadBytes,
          aggregate.requestCount,
          aggregate.errorCount,
        ],
      );
    }
    const ids = selected.rows.map((row) => row.id);
    const deleted = await client.query(
      `DELETE FROM traffic_samples WHERE id IN (${placeholders(ids.length)})`,
      ids,
    );
    return { archived: deleted.rowCount, selectedCount: selected.rows.length };
  });
}

async function archiveTrafficSamples(cutoff: Date): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < maximumBatchesPerRun; batch += 1) {
    const { archived, selectedCount } = await archiveTrafficSamplesBatch(cutoff);
    total += archived;
    if (selectedCount < batchSize) break;
    await yieldEventLoop();
  }
  return total;
}

async function deleteTrafficHourly(cutoff: Date): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < maximumBatchesPerRun; batch += 1) {
    const result = await transaction(async (client) => {
      const selected = await client.query<{ connection_id: string; bucket_start: Date }>(
        `SELECT connection_id,bucket_start FROM traffic_hourly
          WHERE bucket_start < ? ORDER BY bucket_start LIMIT ${batchSize}`,
        [cutoff],
      );
      if (!selected.rows.length) return { deleted: 0, selectedCount: 0 };
      const tuples = selected.rows.map(() => "(?,?)").join(",");
      const values = selected.rows.flatMap((row) => [row.connection_id, row.bucket_start]);
      const deleted = await client.query(
        `DELETE FROM traffic_hourly WHERE (connection_id,bucket_start) IN (${tuples})`,
        values,
      );
      return { deleted: deleted.rowCount, selectedCount: selected.rows.length };
    });
    total += result.deleted;
    if (result.selectedCount < batchSize) break;
    await yieldEventLoop();
  }
  return total;
}

export async function runDataMaintenance(now = new Date()): Promise<MaintenanceStats> {
  const trafficCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const hourlyCutoff = new Date(now);
  hourlyCutoff.setUTCMonth(hourlyCutoff.getUTCMonth() - 18);
  const auditCutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const sessionCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const outboxCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    traffic_samples_archived: await archiveTrafficSamples(trafficCutoff),
    traffic_hourly_deleted: await deleteTrafficHourly(hourlyCutoff),
    audit_events_deleted: await deleteByIds("audit_events", "created_at < ?", [auditCutoff]),
    sessions_deleted: await deleteByIds(
      "sessions",
      "(revoked_at IS NOT NULL AND revoked_at < ?) OR refresh_expires_at < ?",
      [sessionCutoff, sessionCutoff],
    ),
    outbox_events_deleted: await deleteByIds(
      "outbox_events",
      "delivered_at IS NOT NULL AND delivered_at < ? AND id < (SELECT max(id) FROM outbox_events)",
      [outboxCutoff],
    ),
  };
}

export function startDataMaintenance(): { close: () => void } {
  let closed = false;
  const execute = () => {
    if (closed) return;
    void runDataMaintenance()
      .then((stats) => {
        if (!Object.values(stats).some((value) => value > 0)) return;
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          component: "control-center",
          event_code: "DATA_MAINTENANCE_COMPLETED",
          ...stats,
        }));
      })
      .catch((error) => console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        component: "control-center",
        event_code: "DATA_MAINTENANCE_FAILED",
        message: error instanceof Error ? error.message : "Unknown maintenance error",
      })));
  };
  const initialTimer = setTimeout(execute, 60_000);
  const intervalTimer = setInterval(execute, 6 * 60 * 60 * 1000);
  initialTimer.unref();
  intervalTimer.unref();
  // Scheduled database backups share the maintenance lifecycle; their errors
  // are contained inside the backup module and never reach the data tasks.
  const backups = startDatabaseBackups();
  // 月度配额强制与设备离线告警检查器：独立定时器（约 60 秒首跑、每 5 分钟
  // 一次），同样挂在维护生命周期上统一关闭。
  const quotaChecks = startQuotaAndAlertChecks();
  return {
    close: () => {
      closed = true;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
      backups.close();
      quotaChecks.close();
    },
  };
}
