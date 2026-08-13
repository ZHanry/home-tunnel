import { setImmediate as yieldEventLoop } from "node:timers/promises";
import { Router } from "express";
import { transaction, one, query } from "../../db.js";
import {
  asyncHandler,
  audit,
  HttpError,
  pathParam,
  requireAdmin,
  requirePasswordNormal,
} from "../../http.js";
import { adminGuard } from "./shared.js";

const router = Router();

router.get(
  "/devices",
  asyncHandler(async (request, response) => {
    requireAdmin(request);
    requirePasswordNormal(request);
    const userId = String(request.query.user_id ?? "");
    const status = String(request.query.status ?? "");
    const rows = await query<{
      id: string;
      user_id: string;
      username: string;
      name: string;
      status: string;
      config_version: string;
      applied_config_version: string;
      client_version: string | null;
      agent_version: string | null;
      last_seen_at: Date | null;
      lease_expires_at: Date | null;
      created_at: Date;
    }>(
      `SELECT d.id,d.user_id,u.username,d.name,d.status,d.config_version,
            d.applied_config_version,d.client_version,d.agent_version,d.last_seen_at,d.lease_expires_at,d.created_at
       FROM devices d JOIN users u ON u.id=d.user_id
      WHERE (?='' OR d.user_id=?) AND (?='' OR d.status=?)
      ORDER BY d.last_seen_at DESC NULLS LAST,d.created_at DESC LIMIT 200`,
      [userId, userId, status, status],
    );
    response.json({
      items: rows.map((row) => ({
        ...row,
        config_version: Number(row.config_version),
        applied_config_version: Number(row.applied_config_version),
        online: row.last_seen_at ? Date.now() - row.last_seen_at.getTime() < 90_000 : false,
      })),
    });
  }),
);

const deviceTrafficPurgeBatch = 5_000;

async function purgeDeviceTraffic(deviceId: string): Promise<void> {
  for (;;) {
    const deleted = await transaction(async (client) => {
      const rows = await client.query<{ id: number }>(
        `SELECT id FROM traffic_samples WHERE device_id=? ORDER BY id LIMIT ${deviceTrafficPurgeBatch}`,
        [deviceId],
      );
      if (!rows.rows.length) return 0;
      const ids = rows.rows.map((row) => row.id);
      return (
        await client.query(
          `DELETE FROM traffic_samples WHERE id IN (${ids.map(() => "?").join(",")})`,
          ids,
        )
      ).rowCount;
    });
    if (deleted < deviceTrafficPurgeBatch) break;
    await yieldEventLoop();
  }
  for (;;) {
    const deleted = await transaction(async (client) => {
      const rows = await client.query<{ connection_id: string; bucket_start: Date }>(
        `SELECT connection_id,bucket_start FROM traffic_hourly WHERE device_id=? LIMIT ${deviceTrafficPurgeBatch}`,
        [deviceId],
      );
      if (!rows.rows.length) return 0;
      const tuples = rows.rows.map(() => "(?,?)").join(",");
      const values = rows.rows.flatMap((row) => [row.connection_id, row.bucket_start]);
      return (
        await client.query(
          `DELETE FROM traffic_hourly WHERE (connection_id,bucket_start) IN (${tuples})`,
          values,
        )
      ).rowCount;
    });
    if (deleted < deviceTrafficPurgeBatch) break;
    await yieldEventLoop();
  }
}

const deleteDeviceHandler = asyncHandler(async (request, response) => {
  adminGuard(request);
  const deviceId = pathParam(request, "deviceId");
  if (!(await one<{ id: string }>("SELECT id FROM devices WHERE id=?", [deviceId]))) {
    throw new HttpError(404, "NOT_FOUND", "设备不存在");
  }
  await purgeDeviceTraffic(deviceId);
  await transaction(async (client) => {
    const current = await client.query<{
      id: string;
      user_id: string;
      status: string;
      config_version: string;
    }>("SELECT id,user_id,status,config_version FROM devices WHERE id=?", [deviceId]);
    const device = current.rows[0];
    if (!device) throw new HttpError(404, "NOT_FOUND", "设备不存在");
    const connections = await client.query<{ id: string }>(
      "SELECT id FROM connections WHERE device_id=?",
      [deviceId],
    );
    const connectionIds = connections.rows.map((connection) => connection.id);
    await client.query(
      `INSERT INTO outbox_events(event_type,resource_type,resource_id,resource_version,recipient_user_id,recipient_device_id,payload)
       VALUES('subject.revoked','Device',?,?,?,?,?)`,
      [
        deviceId,
        Number(device.config_version) + 1,
        device.user_id,
        deviceId,
        JSON.stringify({
          subject_type: "device",
          subject_id: deviceId,
          action: "delete",
          deleted: true,
        }),
      ],
    );
    await client.query("DELETE FROM sessions WHERE device_id=?", [deviceId]);
    await client.query("DELETE FROM traffic_hourly WHERE device_id=?", [deviceId]);
    await client.query("DELETE FROM traffic_samples WHERE device_id=?", [deviceId]);
    for (const connectionId of connectionIds) {
      await client.query("DELETE FROM custom_domains WHERE connection_id=?", [connectionId]);
      await client.query("DELETE FROM runtime_states WHERE connection_id=?", [connectionId]);
      await client.query(
        "DELETE FROM traffic_policies WHERE scope_type='connection' AND scope_id=?",
        [connectionId],
      );
    }
    await client.query("DELETE FROM connections WHERE device_id=?", [deviceId]);
    await client.query("DELETE FROM devices WHERE id=?", [deviceId]);
    await audit(
      client,
      request,
      "DeviceDeleted",
      "Device",
      deviceId,
      { status: device.status, connection_count: connectionIds.length },
      { deleted: true },
    );
  });
  response.status(204).end();
});

router.delete("/devices/:deviceId", deleteDeviceHandler);
router.post("/devices/:deviceId/revoke", deleteDeviceHandler);

export { router as devicesRouter };
