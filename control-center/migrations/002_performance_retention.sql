CREATE TABLE IF NOT EXISTS traffic_hourly (
    bucket_start TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    device_id TEXT NOT NULL REFERENCES devices(id),
    connection_id TEXT NOT NULL REFERENCES connections(id),
    upload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (upload_bytes >= 0),
    download_bytes INTEGER NOT NULL DEFAULT 0 CHECK (download_bytes >= 0),
    request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(connection_id,bucket_start)
) STRICT;
CREATE INDEX IF NOT EXISTS traffic_hourly_bucket_idx ON traffic_hourly(bucket_start DESC);
CREATE INDEX IF NOT EXISTS traffic_hourly_user_bucket_idx ON traffic_hourly(user_id,bucket_start DESC);
