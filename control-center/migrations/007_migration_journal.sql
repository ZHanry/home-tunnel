-- Additive-only migration metadata. Existing 001-006 files remain immutable.
-- The checksum column records a digest for migrations applied after this schema
-- becomes available; historical rows remain NULL because their original bytes
-- were not recorded at application time.
ALTER TABLE schema_migrations ADD COLUMN checksum_sha256 TEXT DEFAULT NULL
    CHECK (checksum_sha256 IS NULL OR length(checksum_sha256) = 64);
