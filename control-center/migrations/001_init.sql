CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    username text NOT NULL,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    password_state text NOT NULL CHECK (password_state IN ('normal', 'must_change')),
    temporary_password_expires_at timestamptz,
    role text NOT NULL CHECK (role IN ('admin', 'user')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    token_version bigint NOT NULL DEFAULT 1,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uq ON users (lower(username));

CREATE TABLE IF NOT EXISTS devices (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    name text NOT NULL,
    install_id text NOT NULL,
    fingerprint_hash text NOT NULL,
    credential_hash text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    config_version bigint NOT NULL DEFAULT 1,
    applied_config_version bigint NOT NULL DEFAULT 0,
    client_version text,
    agent_version text,
    last_seen_at timestamptz,
    lease_expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS devices_identity_uq ON devices(user_id, fingerprint_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id);
CREATE INDEX IF NOT EXISTS devices_last_seen_idx ON devices(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    device_id uuid REFERENCES devices(id),
    token_family uuid NOT NULL,
    token_version bigint NOT NULL,
    access_token_hash text NOT NULL,
    refresh_token_hash text NOT NULL,
    previous_refresh_token_hash text,
    csrf_token_hash text NOT NULL,
    access_expires_at timestamptz NOT NULL,
    refresh_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_access_hash_uq ON sessions(access_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_refresh_hash_uq ON sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS sessions_family_idx ON sessions(token_family);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS connections (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    device_id uuid NOT NULL REFERENCES devices(id),
    name text NOT NULL,
    subdomain text NOT NULL,
    local_scheme text NOT NULL CHECK (local_scheme IN ('http', 'https')),
    local_host text NOT NULL,
    local_port integer NOT NULL CHECK (local_port BETWEEN 1 AND 65535),
    enabled boolean NOT NULL DEFAULT true,
    version bigint NOT NULL DEFAULT 1,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS connections_subdomain_lower_uq ON connections(lower(subdomain)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS connections_user_idx ON connections(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS connections_device_idx ON connections(device_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS traffic_policies (
    id uuid PRIMARY KEY,
    scope_type text NOT NULL CHECK (scope_type IN ('user', 'connection')),
    scope_id uuid NOT NULL,
    bandwidth_limit_bps bigint CHECK (bandwidth_limit_bps IS NULL OR bandwidth_limit_bps > 0),
    burst_bytes bigint,
    version bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS runtime_states (
    connection_id uuid PRIMARY KEY REFERENCES connections(id),
    desired_version bigint NOT NULL,
    applied_version bigint NOT NULL DEFAULT 0,
    state text NOT NULL DEFAULT 'Pending' CHECK (state IN ('Disabled','Pending','Applying','Online','Degraded','Offline','Error')),
    last_error_code text,
    last_error_summary text,
    observed_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runtime_states_state_idx ON runtime_states(state, observed_at DESC);

CREATE TABLE IF NOT EXISTS traffic_samples (
    id bigserial PRIMARY KEY,
    batch_id uuid NOT NULL,
    bucket_start timestamptz NOT NULL,
    bucket_seconds integer NOT NULL CHECK (bucket_seconds BETWEEN 1 AND 3600),
    user_id uuid NOT NULL REFERENCES users(id),
    device_id uuid NOT NULL REFERENCES devices(id),
    connection_id uuid NOT NULL REFERENCES connections(id),
    upload_bytes bigint NOT NULL DEFAULT 0 CHECK (upload_bytes >= 0),
    download_bytes bigint NOT NULL DEFAULT 0 CHECK (download_bytes >= 0),
    request_count bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    error_count bigint NOT NULL DEFAULT 0 CHECK (error_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(connection_id, bucket_start, bucket_seconds)
);
CREATE INDEX IF NOT EXISTS traffic_samples_bucket_idx ON traffic_samples(bucket_start DESC);
CREATE INDEX IF NOT EXISTS traffic_samples_user_bucket_idx ON traffic_samples(user_id, bucket_start DESC);

CREATE TABLE IF NOT EXISTS audit_events (
    id bigserial PRIMARY KEY,
    actor_type text NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    before_value jsonb,
    after_value jsonb,
    request_id uuid NOT NULL,
    source_ip inet,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_target_idx ON audit_events(target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outbox_events (
    id bigserial PRIMARY KEY,
    event_type text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    resource_version bigint NOT NULL,
    recipient_user_id uuid,
    recipient_device_id uuid,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_events(id) WHERE delivered_at IS NULL;

INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT (version) DO NOTHING;
