-- TCP 隧道（功能 4）：默认关闭，只有管理员在部署层开启端口范围后才能创建。
-- 每个远程端口在当前未删除连接中唯一；HTTP 连接不得携带远程端口。
ALTER TABLE connections ADD COLUMN proxy_type TEXT NOT NULL DEFAULT 'http'
    CHECK (proxy_type IN ('http','tcp'));
ALTER TABLE connections ADD COLUMN tcp_remote_port INTEGER DEFAULT NULL
    CHECK (tcp_remote_port IS NULL OR tcp_remote_port BETWEEN 1 AND 65535);
CREATE UNIQUE INDEX IF NOT EXISTS connections_tcp_remote_port_uq
    ON connections(tcp_remote_port)
    WHERE proxy_type='tcp' AND deleted_at IS NULL;
