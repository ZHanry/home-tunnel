import { randomUUID } from "node:crypto";
import { query, transaction, type DatabaseClient } from "./db.js";
import { sendAlert, type AlertEvent, type AlertSendOutcome } from "./notifications.js";

// 月度流量配额强制与设备离线告警。
// - 配额挂起是网关层的软停用：只写 users.quota_suspended_at 并写 outbox 让
//   网关快照 revision 前进；不改 connections.enabled、不 bump 设备
//   config_version，避免与管理员手动开关和 Agent 重配纠缠。
// - 当月用量 = traffic_samples 与 traffic_hourly（两表不重叠）自 UTC 月初
//   起的 upload+download 之和。
// - 跨月后当月用量自然归零（< 配额），下一次检查自动解除挂起。

const quotaWarningRatio = 0.8;
// 离线阈值取 5 分钟，比 90 秒在线判定更宽，避免心跳抖动导致告警翻转。
const offlineThresholdSeconds = 300;
const checkIntervalMs = 5 * 60 * 1000;
const initialDelayMs = 60 * 1000;

type AlertDispatch = (event: AlertEvent) => Promise<AlertSendOutcome>;

export type MonthToDateUsage = {
  userId: string;
  username: string;
  userVersion: number;
  usedBytes: number;
  quotaBytes: number;
  suspendedAt: Date | null;
  warnedAt: Date | null;
};

type QuotaUsageRow = {
  user_id: string;
  username: string;
  user_version: string | number;
  quota_bytes: string | number;
  used_bytes: string | number;
  quota_suspended_at: Date | null;
  quota_warned_at: Date | null;
};

// 设了 user 级 monthly_quota_bytes 的每个用户的当月（UTC 自然月）用量。
// 两个子查询分别命中 (user_id,bucket_start) 索引；两表按归档契约不重叠，
// 相加即无重复计数的当月总量。
export async function monthToDateUsage(): Promise<MonthToDateUsage[]> {
  const rows = await query<QuotaUsageRow>(
    `SELECT u.id AS user_id,u.username,u.version AS user_version,
            u.quota_suspended_at,u.quota_warned_at,tp.monthly_quota_bytes AS quota_bytes,
            COALESCE((SELECT sum(ts.upload_bytes+ts.download_bytes) FROM traffic_samples ts
                       WHERE ts.user_id=u.id AND ts.bucket_start>=home_tunnel_month_start()),0)
            +COALESCE((SELECT sum(th.upload_bytes+th.download_bytes) FROM traffic_hourly th
                       WHERE th.user_id=u.id AND th.bucket_start>=home_tunnel_month_start()),0) AS used_bytes
       FROM users u JOIN traffic_policies tp ON tp.scope_type='user' AND tp.scope_id=u.id
      WHERE tp.monthly_quota_bytes IS NOT NULL`,
  );
  return rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    userVersion: Number(row.user_version),
    usedBytes: Number(row.used_bytes),
    quotaBytes: Number(row.quota_bytes),
    suspendedAt: row.quota_suspended_at,
    warnedAt: row.quota_warned_at,
  }));
}

function currentUtcMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function currentUtcMonthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function writeQuotaOutboxAndAudit(
  client: DatabaseClient,
  action: "suspend" | "restore",
  usage: Pick<MonthToDateUsage, "userId" | "userVersion" | "usedBytes" | "quotaBytes">,
): Promise<void> {
  const devices = await client.query<{ id: string }>(
    "SELECT id FROM devices WHERE user_id=? AND status='active'",
    [usage.userId],
  );
  // 无 active 设备时也写一条（recipient_device_id NULL），保证网关 revision 前进。
  const recipients = devices.rows.length ? devices.rows.map((device) => device.id) : [null];
  for (const deviceId of recipients) {
    await client.query(
      `INSERT INTO outbox_events(
         event_type,resource_type,resource_id,resource_version,recipient_user_id,recipient_device_id,payload)
       VALUES(?,?,?,?,?,?,?)`,
      [
        action === "suspend" ? "quota.suspended" : "quota.restored",
        "User",
        usage.userId,
        usage.userVersion,
        usage.userId,
        deviceId,
        JSON.stringify({
          user_id: usage.userId,
          action,
          monthly_quota_bytes: usage.quotaBytes,
          month_to_date_bytes: usage.usedBytes,
        }),
      ],
    );
  }
  await client.query(
    `INSERT INTO audit_events(actor_type,action,target_type,target_id,before_value,after_value,request_id)
     VALUES('system',?,'User',?,?,?,?)`,
    [
      action === "suspend" ? "UserQuotaSuspended" : "UserQuotaRestored",
      usage.userId,
      JSON.stringify({
        quota_suspended: action !== "suspend",
        month_to_date_bytes: usage.usedBytes,
        monthly_quota_bytes: usage.quotaBytes,
      }),
      JSON.stringify({ quota_suspended: action === "suspend" }),
      randomUUID(),
    ],
  );
}

async function suspendUser(usage: MonthToDateUsage, dispatch: AlertDispatch): Promise<boolean> {
  const changed = await transaction(async (client) => {
    const updated = await client.query<{ id: string }>(
      `UPDATE users SET quota_suspended_at=home_tunnel_now(),updated_at=home_tunnel_now()
        WHERE id=? AND quota_suspended_at IS NULL RETURNING id`,
      [usage.userId],
    );
    if (!updated.rows[0]) return false;
    await writeQuotaOutboxAndAudit(client, "suspend", usage);
    return true;
  });
  if (!changed) return false;
  await dispatch({
    event_type: "quota.suspended",
    severity: "critical",
    title: `用户 ${usage.username} 已超出月度流量配额`,
    message: `当月已用 ${usage.usedBytes} 字节，配额 ${usage.quotaBytes} 字节；网关已暂停其全部连接，次月自动恢复。`,
    subject_id: `${usage.userId}:${currentUtcMonthKey()}`,
    details: {
      user_id: usage.userId,
      username: usage.username,
      month_to_date_bytes: usage.usedBytes,
      monthly_quota_bytes: usage.quotaBytes,
    },
  });
  return true;
}

async function restoreUser(
  usage: Pick<MonthToDateUsage, "userId" | "username" | "userVersion" | "usedBytes" | "quotaBytes">,
  dispatch: AlertDispatch,
): Promise<boolean> {
  const changed = await transaction(async (client) => {
    const updated = await client.query<{ id: string }>(
      `UPDATE users SET quota_suspended_at=NULL,updated_at=home_tunnel_now()
        WHERE id=? AND quota_suspended_at IS NOT NULL RETURNING id`,
      [usage.userId],
    );
    if (!updated.rows[0]) return false;
    await writeQuotaOutboxAndAudit(client, "restore", usage);
    return true;
  });
  if (!changed) return false;
  await dispatch({
    event_type: "quota.restored",
    severity: "info",
    title: `用户 ${usage.username} 的流量配额挂起已解除`,
    message: `当月已用 ${usage.usedBytes} 字节，配额 ${usage.quotaBytes || 0} 字节（0 表示已取消配额）；连接恢复可用。`,
    subject_id: `${usage.userId}:${currentUtcMonthKey()}`,
    details: {
      user_id: usage.userId,
      username: usage.username,
      month_to_date_bytes: usage.usedBytes,
      monthly_quota_bytes: usage.quotaBytes || null,
    },
  });
  return true;
}

async function warnUser(usage: MonthToDateUsage, dispatch: AlertDispatch): Promise<boolean> {
  // quota_warned_at 早于本月月初（或为空）才允许发送：一个月内 80% 只发一次，
  // 持久列保证重启后不重发。
  const monthStart = currentUtcMonthStartIso();
  const changed = await transaction(async (client) => {
    const updated = await client.query<{ id: string }>(
      `UPDATE users SET quota_warned_at=home_tunnel_now(),updated_at=home_tunnel_now()
        WHERE id=? AND quota_suspended_at IS NULL
          AND (quota_warned_at IS NULL OR quota_warned_at < ?) RETURNING id`,
      [usage.userId, monthStart],
    );
    return updated.rows.length > 0;
  });
  if (!changed) return false;
  const percent = Math.floor((usage.usedBytes / usage.quotaBytes) * 100);
  await dispatch({
    event_type: "quota.warning",
    severity: "warning",
    title: `用户 ${usage.username} 月度流量已达 ${percent}%`,
    message: `当月已用 ${usage.usedBytes} 字节，配额 ${usage.quotaBytes} 字节；达到配额后网关将暂停其连接。`,
    subject_id: `${usage.userId}:${currentUtcMonthKey()}`,
    details: {
      user_id: usage.userId,
      username: usage.username,
      month_to_date_bytes: usage.usedBytes,
      monthly_quota_bytes: usage.quotaBytes,
    },
  });
  return true;
}

export type QuotaEnforcementStats = { suspended: number; restored: number; warned: number };

export async function runQuotaEnforcement(
  dispatch: AlertDispatch = sendAlert,
): Promise<QuotaEnforcementStats> {
  const stats: QuotaEnforcementStats = { suspended: 0, restored: 0, warned: 0 };
  for (const usage of await monthToDateUsage()) {
    if (usage.suspendedAt) {
      // 进入新的自然月（当月用量归零）、上调配额或降低用量后自动恢复。
      if (usage.usedBytes < usage.quotaBytes && (await restoreUser(usage, dispatch)))
        stats.restored += 1;
      continue;
    }
    if (usage.usedBytes >= usage.quotaBytes) {
      if (await suspendUser(usage, dispatch)) stats.suspended += 1;
      continue;
    }
    if (usage.usedBytes >= usage.quotaBytes * quotaWarningRatio) {
      const warnedThisMonth =
        usage.warnedAt != null && usage.warnedAt.toISOString() >= currentUtcMonthStartIso();
      if (!warnedThisMonth && (await warnUser(usage, dispatch))) stats.warned += 1;
    }
  }
  // 配额被取消（monthly_quota_bytes 置 NULL 或策略行不存在）但仍处于挂起
  // 状态的用户：同样恢复，保持"无配额 = 不受限"的语义。
  const orphaned = await query<{
    user_id: string;
    username: string;
    user_version: string | number;
  }>(
    `SELECT u.id AS user_id,u.username,u.version AS user_version
       FROM users u LEFT JOIN traffic_policies tp ON tp.scope_type='user' AND tp.scope_id=u.id
      WHERE u.quota_suspended_at IS NOT NULL AND tp.monthly_quota_bytes IS NULL`,
  );
  for (const row of orphaned) {
    const restored = await restoreUser(
      {
        userId: row.user_id,
        username: row.username,
        userVersion: Number(row.user_version),
        usedBytes: 0,
        quotaBytes: 0,
      },
      dispatch,
    );
    if (restored) stats.restored += 1;
  }
  return stats;
}

export type OfflineCheckStats = { offline: number; recovered: number };

// 设备离线/恢复告警：只针对曾经在线（last_seen_at 非空）的 active 设备；
// offline_alerted_at 为持久去重列，重启后不会重复告警。
export async function runDeviceOfflineCheck(
  dispatch: AlertDispatch = sendAlert,
): Promise<OfflineCheckStats> {
  const stats: OfflineCheckStats = { offline: 0, recovered: 0 };
  const wentOffline = await query<{
    id: string;
    name: string;
    username: string;
    last_seen_at: Date;
  }>(
    `SELECT d.id,d.name,u.username,d.last_seen_at
       FROM devices d JOIN users u ON u.id=d.user_id
      WHERE d.status='active' AND d.offline_alerted_at IS NULL AND d.last_seen_at IS NOT NULL
        AND d.last_seen_at <= home_tunnel_add_seconds(home_tunnel_now(),?)`,
    [-offlineThresholdSeconds],
  );
  for (const device of wentOffline) {
    const marked = await query<{ id: string }>(
      `UPDATE devices SET offline_alerted_at=home_tunnel_now(),updated_at=home_tunnel_now()
        WHERE id=? AND status='active' AND offline_alerted_at IS NULL
          AND last_seen_at IS NOT NULL AND last_seen_at <= home_tunnel_add_seconds(home_tunnel_now(),?)
        RETURNING id`,
      [device.id, -offlineThresholdSeconds],
    );
    if (!marked[0]) continue;
    stats.offline += 1;
    await dispatch({
      event_type: "device.offline",
      severity: "warning",
      title: `设备 ${device.name} 已离线`,
      message: `用户 ${device.username} 的设备超过 ${offlineThresholdSeconds} 秒未上报，最后在线 ${device.last_seen_at.toISOString()}。`,
      subject_id: device.id,
      details: {
        device_id: device.id,
        username: device.username,
        last_seen_at: device.last_seen_at.toISOString(),
      },
    });
  }
  const cameBack = await query<{ id: string; name: string; username: string; last_seen_at: Date }>(
    `SELECT d.id,d.name,u.username,d.last_seen_at
       FROM devices d JOIN users u ON u.id=d.user_id
      WHERE d.status='active' AND d.offline_alerted_at IS NOT NULL AND d.last_seen_at IS NOT NULL
        AND d.last_seen_at > home_tunnel_add_seconds(home_tunnel_now(),?)`,
    [-offlineThresholdSeconds],
  );
  for (const device of cameBack) {
    const cleared = await query<{ id: string }>(
      `UPDATE devices SET offline_alerted_at=NULL,updated_at=home_tunnel_now()
        WHERE id=? AND offline_alerted_at IS NOT NULL
          AND last_seen_at > home_tunnel_add_seconds(home_tunnel_now(),?)
        RETURNING id`,
      [device.id, -offlineThresholdSeconds],
    );
    if (!cleared[0]) continue;
    stats.recovered += 1;
    await dispatch({
      event_type: "device.online",
      severity: "info",
      title: `设备 ${device.name} 已恢复在线`,
      message: `用户 ${device.username} 的设备重新上报，最后在线 ${device.last_seen_at.toISOString()}。`,
      subject_id: device.id,
      details: {
        device_id: device.id,
        username: device.username,
        last_seen_at: device.last_seen_at.toISOString(),
      },
    });
  }
  return stats;
}

function logCheckFailure(error: unknown): void {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      component: "control-center",
      event_code: "QUOTA_ALERT_CHECK_FAILED",
      message: error instanceof Error ? error.message : "Unknown quota check error",
    }),
  );
}

// 管理端改配额后立即触发一次检查（不阻塞响应；失败只记日志，下一个
// 定时 tick 仍会兜底）。
export function triggerQuotaEnforcement(): void {
  void runQuotaEnforcement().catch(logCheckFailure);
}

export function startQuotaAndAlertChecks(): { close: () => void } {
  let closed = false;
  const execute = () => {
    if (closed) return;
    void (async () => {
      const quotaStats = await runQuotaEnforcement();
      const offlineStats = await runDeviceOfflineCheck();
      const activity =
        quotaStats.suspended +
        quotaStats.restored +
        quotaStats.warned +
        offlineStats.offline +
        offlineStats.recovered;
      if (!activity) return;
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          component: "control-center",
          event_code: "QUOTA_ALERT_CHECK_COMPLETED",
          quota_suspended: quotaStats.suspended,
          quota_restored: quotaStats.restored,
          quota_warned: quotaStats.warned,
          devices_offline: offlineStats.offline,
          devices_recovered: offlineStats.recovered,
        }),
      );
    })().catch(logCheckFailure);
  };
  const initialTimer = setTimeout(execute, initialDelayMs);
  const intervalTimer = setInterval(execute, checkIntervalMs);
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
