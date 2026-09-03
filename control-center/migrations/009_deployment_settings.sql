CREATE TABLE IF NOT EXISTS deployment_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

INSERT OR IGNORE INTO deployment_settings(key, value) VALUES ('subdomain_prefix_policy', 'suggest');
