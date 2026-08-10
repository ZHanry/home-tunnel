CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_state TEXT NOT NULL CHECK (password_state IN ('normal', 'must_change')),
    temporary_password_expires_at TEXT,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    token_version INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uq ON users(lower(username));

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    install_id TEXT NOT NULL,
    fingerprint_hash TEXT NOT NULL,
    credential_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    config_version INTEGER NOT NULL DEFAULT 1,
    applied_config_version INTEGER NOT NULL DEFAULT 0,
    client_version TEXT,
    agent_version TEXT,
    last_seen_at TEXT,
    lease_expires_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS devices_identity_uq ON devices(user_id,fingerprint_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id);
CREATE INDEX IF NOT EXISTS devices_last_seen_idx ON devices(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    device_id TEXT REFERENCES devices(id),
    token_family TEXT NOT NULL,
    token_version INTEGER NOT NULL,
    access_token_hash TEXT NOT NULL,
    refresh_token_hash TEXT NOT NULL,
    previous_refresh_token_hash TEXT,
    csrf_token_hash TEXT NOT NULL,
    access_expires_at TEXT NOT NULL,
    refresh_expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_access_hash_uq ON sessions(access_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_refresh_hash_uq ON sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS sessions_family_idx ON sessions(token_family);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    device_id TEXT NOT NULL REFERENCES devices(id),
    name TEXT NOT NULL,
    subdomain TEXT NOT NULL,
    local_scheme TEXT NOT NULL CHECK (local_scheme IN ('http', 'https')),
    local_host TEXT NOT NULL,
    local_port INTEGER NOT NULL CHECK (local_port BETWEEN 1 AND 65535),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS connections_subdomain_lower_uq ON connections(lower(subdomain)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS connections_user_idx ON connections(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS connections_device_idx ON connections(device_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS traffic_policies (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'connection')),
    scope_id TEXT NOT NULL,
    bandwidth_limit_bps INTEGER CHECK (bandwidth_limit_bps IS NULL OR bandwidth_limit_bps > 0),
    burst_bytes INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(scope_type,scope_id)
) STRICT;

CREATE TABLE IF NOT EXISTS runtime_states (
    connection_id TEXT PRIMARY KEY REFERENCES connections(id),
    desired_version INTEGER NOT NULL,
    applied_version INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'Pending' CHECK (state IN ('Disabled','Pending','Applying','Online','Degraded','Offline','Error')),
    last_error_code TEXT,
    last_error_summary TEXT,
    observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX IF NOT EXISTS runtime_states_state_idx ON runtime_states(state,observed_at DESC);

CREATE TABLE IF NOT EXISTS traffic_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    bucket_start TEXT NOT NULL,
    bucket_seconds INTEGER NOT NULL CHECK (bucket_seconds BETWEEN 1 AND 3600),
    user_id TEXT NOT NULL REFERENCES users(id),
    device_id TEXT NOT NULL REFERENCES devices(id),
    connection_id TEXT NOT NULL REFERENCES connections(id),
    upload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (upload_bytes >= 0),
    download_bytes INTEGER NOT NULL DEFAULT 0 CHECK (download_bytes >= 0),
    request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(connection_id,bucket_start,bucket_seconds)
) STRICT;
CREATE INDEX IF NOT EXISTS traffic_samples_bucket_idx ON traffic_samples(bucket_start DESC);
CREATE INDEX IF NOT EXISTS traffic_samples_user_bucket_idx ON traffic_samples(user_id,bucket_start DESC);

CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    before_value TEXT CHECK (before_value IS NULL OR json_valid(before_value)),
    after_value TEXT CHECK (after_value IS NULL OR json_valid(after_value)),
    request_id TEXT NOT NULL,
    source_ip TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events(actor_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_target_idx ON audit_events(target_id,created_at DESC);

CREATE TABLE IF NOT EXISTS outbox_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    resource_version INTEGER NOT NULL,
    recipient_user_id TEXT,
    recipient_device_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
    delivered_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_events(id) WHERE delivered_at IS NULL;
