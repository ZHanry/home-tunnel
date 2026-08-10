import type { PoolClient } from "pg";
import { pool } from "./db.js";

const maintenanceLock = 1_212_384_743;
const batchSize = 5_000;
const maximumBatchesPerRun = 20;

type MaintenanceStats = {
  traffic_samples_archived: number;
  traffic_hourly_deleted: number;
  audit_events_deleted: number;
  sessions_deleted: number;
  outbox_events_deleted: number;
};

async function runBatches(
  client: PoolClient,
  text: string,
  values: unknown[],
): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < maximumBatchesPerRun; batch += 1) {
    const result = await client.query<{ processed: number }>(text, [...values, batchSize]);
    const processed = Number(result.rows[0]?.processed ?? 0);
    total += processed;
    if (processed < batchSize) break;
  }
  return total;
}

export async function runDataMaintenance(now = new Date()): Promise<MaintenanceStats | null> {
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [maintenanceLock]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return null;

    const trafficCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const hourlyCutoff = new Date(now);
    hourlyCutoff.setUTCMonth(hourlyCutoff.getUTCMonth() - 18);
    const auditCutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const sessionCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const outboxCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const trafficSamplesArchived = await runBatches(
      client,
      `WITH candidates AS MATERIALIZED (
         SELECT id,bucket_start,user_id,device_id,connection_id,upload_bytes,download_bytes,request_count,error_count
           FROM traffic_samples
          WHERE bucket_start < $1
          ORDER BY bucket_start,id
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       ), aggregated AS (
         SELECT date_trunc('hour',bucket_start) AS bucket_start,user_id,device_id,connection_id,
                sum(upload_bytes)::bigint AS upload_bytes,sum(download_bytes)::bigint AS download_bytes,
                sum(request_count)::bigint AS request_count,sum(error_count)::bigint AS error_count
           FROM candidates GROUP BY 1,2,3,4
       ), archived AS (
         INSERT INTO traffic_hourly(
           bucket_start,user_id,device_id,connection_id,upload_bytes,download_bytes,request_count,error_count)
         SELECT bucket_start,user_id,device_id,connection_id,upload_bytes,download_bytes,request_count,error_count
           FROM aggregated
         ON CONFLICT(connection_id,bucket_start) DO UPDATE SET
           upload_bytes=traffic_hourly.upload_bytes+EXCLUDED.upload_bytes,
           download_bytes=traffic_hourly.download_bytes+EXCLUDED.download_bytes,
           request_count=traffic_hourly.request_count+EXCLUDED.request_count,
           error_count=traffic_hourly.error_count+EXCLUDED.error_count,
           updated_at=now()
         RETURNING 1
       ), deleted AS (
         DELETE FROM traffic_samples sample USING candidates candidate
          WHERE sample.id=candidate.id RETURNING sample.id
       )
       SELECT count(*)::int AS processed FROM deleted`,
      [trafficCutoff],
    );

    const trafficHourlyDeleted = await runBatches(
      client,
      `WITH candidates AS (
         SELECT connection_id,bucket_start FROM traffic_hourly
          WHERE bucket_start < $1 ORDER BY bucket_start LIMIT $2
       ), deleted AS (
         DELETE FROM traffic_hourly hourly USING candidates candidate
          WHERE hourly.connection_id=candidate.connection_id AND hourly.bucket_start=candidate.bucket_start
          RETURNING 1
       ) SELECT count(*)::int AS processed FROM deleted`,
      [hourlyCutoff],
    );

    const auditEventsDeleted = await runBatches(
      client,
      `WITH candidates AS (
         SELECT id FROM audit_events WHERE created_at < $1 ORDER BY id LIMIT $2
       ), deleted AS (
         DELETE FROM audit_events event USING candidates candidate WHERE event.id=candidate.id RETURNING 1
       ) SELECT count(*)::int AS processed FROM deleted`,
      [auditCutoff],
    );

    const sessionsDeleted = await runBatches(
      client,
      `WITH candidates AS (
         SELECT id FROM sessions
          WHERE (revoked_at IS NOT NULL AND revoked_at < $1) OR refresh_expires_at < $1
          ORDER BY created_at LIMIT $2
       ), deleted AS (
         DELETE FROM sessions session USING candidates candidate WHERE session.id=candidate.id RETURNING 1
       ) SELECT count(*)::int AS processed FROM deleted`,
      [sessionCutoff],
    );

    const outboxEventsDeleted = await runBatches(
      client,
      `WITH latest AS (SELECT max(id) AS id FROM outbox_events), candidates AS (
         SELECT event.id FROM outbox_events event,latest
          WHERE event.delivered_at IS NOT NULL AND event.delivered_at < $1 AND event.id < latest.id
          ORDER BY event.id LIMIT $2
       ), deleted AS (
         DELETE FROM outbox_events event USING candidates candidate WHERE event.id=candidate.id RETURNING 1
       ) SELECT count(*)::int AS processed FROM deleted`,
      [outboxCutoff],
    );

    return {
      traffic_samples_archived: trafficSamplesArchived,
      traffic_hourly_deleted: trafficHourlyDeleted,
      audit_events_deleted: auditEventsDeleted,
      sessions_deleted: sessionsDeleted,
      outbox_events_deleted: outboxEventsDeleted,
    };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [maintenanceLock]).catch(() => undefined);
    client.release();
  }
}

export function startDataMaintenance(): { close: () => void } {
  let closed = false;
  const execute = () => {
    if (closed) return;
    void runDataMaintenance()
      .then((stats) => {
        if (!stats || !Object.values(stats).some((value) => value > 0)) return;
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
  return {
    close: () => {
      closed = true;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    },
  };
}
