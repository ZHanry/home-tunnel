-- 月度流量配额与告警（功能 2）。
-- traffic_policies.monthly_quota_bytes：user 级策略的自然月（UTC）流量配额，
--   上传+下载合计；NULL = 不限配额。仅 scope_type='user' 使用。
-- users.quota_suspended_at：非 NULL 表示该用户因超出配额被网关层软停用；
--   不改 connections.enabled、不 bump 设备 config_version，跨月自动恢复。
-- users.quota_warned_at：最近一次发送 80% 配额预警的时间；与当前月份比较即可
--   实现"一个月内只发一次"的持久去重（重启后不重发）。
-- devices.offline_alerted_at：非 NULL 表示已发送离线告警且尚未恢复；持久列
--   避免进程重启后重复告警。
ALTER TABLE traffic_policies ADD COLUMN monthly_quota_bytes INTEGER DEFAULT NULL
    CHECK (monthly_quota_bytes IS NULL OR monthly_quota_bytes > 0);
ALTER TABLE users ADD COLUMN quota_suspended_at TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN quota_warned_at TEXT DEFAULT NULL;
ALTER TABLE devices ADD COLUMN offline_alerted_at TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS users_quota_suspended_idx ON users(quota_suspended_at)
    WHERE quota_suspended_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS devices_offline_alerted_idx ON devices(offline_alerted_at)
    WHERE offline_alerted_at IS NOT NULL;
