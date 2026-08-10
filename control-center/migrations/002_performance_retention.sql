CREATE TABLE IF NOT EXISTS traffic_hourly (
    bucket_start timestamptz NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id),
    device_id uuid NOT NULL REFERENCES devices(id),
    connection_id uuid NOT NULL REFERENCES connections(id),
    upload_bytes bigint NOT NULL DEFAULT 0 CHECK (upload_bytes >= 0),
    download_bytes bigint NOT NULL DEFAULT 0 CHECK (download_bytes >= 0),
    request_count bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    error_count bigint NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(connection_id, bucket_start)
);
CREATE INDEX IF NOT EXISTS traffic_hourly_bucket_idx ON traffic_hourly(bucket_start DESC);
CREATE INDEX IF NOT EXISTS traffic_hourly_user_bucket_idx ON traffic_hourly(user_id, bucket_start DESC);

CREATE OR REPLACE FUNCTION notify_home_tunnel_outbox() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_notify('home_tunnel_outbox', NEW.id::text);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outbox_notify_insert ON outbox_events;
CREATE TRIGGER outbox_notify_insert
AFTER INSERT ON outbox_events
FOR EACH ROW EXECUTE FUNCTION notify_home_tunnel_outbox();

INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT (version) DO NOTHING;
