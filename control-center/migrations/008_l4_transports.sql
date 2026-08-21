-- 通用 L4 隧道：transport_type/remote_port 是新的规范字段。旧字段继续保留为
-- 兼容镜像：UDP 在旧 proxy_type 中映射为 tcp，但 tcp_remote_port 仅镜像
-- 真正的 TCP 端口，避免旧客户端把 UDP 隧道当作可用的 TCP 隧道。
ALTER TABLE connections ADD COLUMN transport_type TEXT NOT NULL DEFAULT 'http'
    CHECK (transport_type IN ('http','tcp','udp'));
ALTER TABLE connections ADD COLUMN remote_port INTEGER DEFAULT NULL
    CHECK (remote_port IS NULL OR remote_port BETWEEN 1 AND 65535);

UPDATE connections
   SET transport_type=proxy_type,
       remote_port=CASE WHEN proxy_type='tcp' THEN tcp_remote_port ELSE NULL END;

DROP INDEX IF EXISTS connections_tcp_remote_port_uq;
CREATE UNIQUE INDEX IF NOT EXISTS connections_transport_remote_port_uq
    ON connections(transport_type,remote_port)
    WHERE transport_type IN ('tcp','udp') AND deleted_at IS NULL;

-- ALTER TABLE 无法为两个新列补表级 CHECK，使用触发器保证 HTTP 不携带端口、
-- TCP/UDP 必须携带端口。应用写规范字段，后置触发器再维护旧字段镜像。
CREATE TRIGGER IF NOT EXISTS connections_transport_validate_insert
BEFORE INSERT ON connections
WHEN (NEW.transport_type='http' AND NEW.remote_port IS NOT NULL)
  OR (NEW.transport_type IN ('tcp','udp') AND NEW.remote_port IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalid connection transport/remote port');
END;

CREATE TRIGGER IF NOT EXISTS connections_transport_validate_update
BEFORE UPDATE OF transport_type,remote_port ON connections
WHEN (NEW.transport_type='http' AND NEW.remote_port IS NOT NULL)
  OR (NEW.transport_type IN ('tcp','udp') AND NEW.remote_port IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalid connection transport/remote port');
END;

CREATE TRIGGER IF NOT EXISTS connections_transport_mirror_insert
AFTER INSERT ON connections
BEGIN
  -- v3.0 writer 不认识规范字段，只会写 legacy TCP 字段；此时新列仍是
  -- DEFAULT http/null。先识别并提升为 canonical TCP，再统一生成兼容镜像。
  UPDATE connections
     SET transport_type='tcp',remote_port=NEW.tcp_remote_port
   WHERE id=NEW.id
     AND NEW.transport_type='http' AND NEW.remote_port IS NULL
     AND NEW.proxy_type='tcp' AND NEW.tcp_remote_port IS NOT NULL;

  UPDATE connections
     SET proxy_type=CASE WHEN transport_type='http' THEN 'http' ELSE 'tcp' END,
         tcp_remote_port=CASE WHEN transport_type='tcp' THEN remote_port ELSE NULL END
   WHERE id=NEW.id
     AND (proxy_type <> CASE WHEN transport_type='http' THEN 'http' ELSE 'tcp' END
       OR tcp_remote_port IS NOT CASE WHEN transport_type='tcp' THEN remote_port ELSE NULL END);
END;

CREATE TRIGGER IF NOT EXISTS connections_transport_mirror_update
AFTER UPDATE OF transport_type,remote_port ON connections
WHEN NEW.proxy_type <> CASE WHEN NEW.transport_type='http' THEN 'http' ELSE 'tcp' END
  OR NEW.tcp_remote_port IS NOT CASE WHEN NEW.transport_type='tcp' THEN NEW.remote_port ELSE NULL END
BEGIN
  UPDATE connections
     SET proxy_type=CASE WHEN NEW.transport_type='http' THEN 'http' ELSE 'tcp' END,
         tcp_remote_port=CASE WHEN NEW.transport_type='tcp' THEN NEW.remote_port ELSE NULL END
   WHERE id=NEW.id;
END;

-- 回滚后的 v3.0 writer 会把 canonical UDP 看成不完整的 TCP 镜像。禁止它
-- 通过 legacy 字段把该行临时变成可用 TCP；应先在新版本停用/删除 UDP，
-- 再执行应用回滚或恢复 008 前的数据库备份。
CREATE TRIGGER IF NOT EXISTS connections_legacy_udp_write_guard
BEFORE UPDATE OF proxy_type,tcp_remote_port ON connections
WHEN OLD.transport_type='udp'
  AND NEW.transport_type IS OLD.transport_type
  AND NEW.remote_port IS OLD.remote_port
  AND (NEW.proxy_type IS NOT OLD.proxy_type
    OR NEW.tcp_remote_port IS NOT OLD.tcp_remote_port)
  AND NOT (NEW.proxy_type='tcp' AND NEW.tcp_remote_port IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'legacy writer cannot modify canonical udp transport');
END;

-- 兼容仍在运行的 v3.0 writer：只有旧字段实际变化、且同一条语句没有修改
-- canonical 字段时才反向同步。canonical UDP 永远保持 udp；它的 legacy
-- tcp/null 只是降级镜像，不能被此触发器重新解释为 TCP。
CREATE TRIGGER IF NOT EXISTS connections_legacy_transport_update
AFTER UPDATE OF proxy_type,tcp_remote_port ON connections
WHEN OLD.transport_type IN ('http','tcp')
  AND NEW.transport_type IS OLD.transport_type
  AND NEW.remote_port IS OLD.remote_port
  AND (NEW.proxy_type IS NOT OLD.proxy_type
    OR NEW.tcp_remote_port IS NOT OLD.tcp_remote_port)
  AND (NEW.transport_type IS NOT CASE WHEN NEW.proxy_type='http' THEN 'http' ELSE 'tcp' END
    OR NEW.remote_port IS NOT CASE WHEN NEW.proxy_type='tcp' THEN NEW.tcp_remote_port ELSE NULL END)
BEGIN
  UPDATE connections
     SET transport_type=CASE WHEN NEW.proxy_type='http' THEN 'http' ELSE 'tcp' END,
         remote_port=CASE WHEN NEW.proxy_type='tcp' THEN NEW.tcp_remote_port ELSE NULL END
   WHERE id=NEW.id;
END;
