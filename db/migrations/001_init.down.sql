-- Reverses 001_init.sql. DESTROYS ALL UNSPIN DATA in the current schema.
-- Never run against a shared/integration database; the migration runner does not apply *.down.sql files.
DROP TABLE IF EXISTS workspace_claims;
DROP TABLE IF EXISTS shares;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS history_entries;
DROP TABLE IF EXISTS provenance;
DROP TABLE IF EXISTS dataset_version_rows;
DROP TABLE IF EXISTS dataset_versions;
DROP TABLE IF EXISTS datasets;
DROP TABLE IF EXISTS selections;
DROP TABLE IF EXISTS sources;
DELETE FROM schema_migrations WHERE version = '001_init';
