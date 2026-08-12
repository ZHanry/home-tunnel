-- 网关访问控制（功能 1）：每条连接可选的 IP 白名单与 HTTP Basic Auth 前置门禁。
-- access_ip_allowlist：JSON 字符串数组（CIDR 或单 IP），NULL = 不限制来源。
-- access_basic_user / access_basic_hash：同时存在或同时为 NULL；哈希为
--   scrypt$N$r$p$saltB64$hashB64 格式，网关侧按需验证。
-- access_policy_version：纯 ACL 变更只递增该版本并写 outbox（驱动网关
--   revision），不 bump 设备 config_version，避免无谓的隧道重连。
ALTER TABLE connections ADD COLUMN access_ip_allowlist TEXT;
ALTER TABLE connections ADD COLUMN access_basic_user TEXT;
ALTER TABLE connections ADD COLUMN access_basic_hash TEXT;
ALTER TABLE connections ADD COLUMN access_policy_version INTEGER NOT NULL DEFAULT 1;
