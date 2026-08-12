-- 自定义域名（功能 3）：域名先通过独立 TXT 所有权验证，并要求 CNAME
-- 指向连接的受管域名，验证成功后才会进入 Agent、FRPS、网关与 Caddy 的
-- 授权面。域名全局唯一，防止同一公网 Host 被分配给多条连接。
CREATE TABLE IF NOT EXISTS custom_domains (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES connections(id),
    domain TEXT NOT NULL,
    verification_token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified')),
    verified_at TEXT,
    last_checked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS custom_domains_domain_lower_uq ON custom_domains(lower(domain));
CREATE INDEX IF NOT EXISTS custom_domains_connection_idx ON custom_domains(connection_id);
CREATE INDEX IF NOT EXISTS custom_domains_verified_idx ON custom_domains(connection_id,domain)
    WHERE status='verified';
