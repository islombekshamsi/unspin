-- UNSPIN initial schema (proposal; the coordinator copies the reviewed file to db/migrations/).
-- Plain relational tables only. No extension is required, so the file runs on stock
-- PostgreSQL 14+ and on Tiger Data (TimescaleDB) services alike.
--
-- Ownership: every user-visible table carries owner_id, and every repository query
-- filters on it. Owner ids are server-derived (hash of a guest capability token or of
-- an account subject); they are never taken from a request.
--
-- Contract documents (Source, SourceSelection, Dataset metadata, DatasetVersion,
-- Row chunks, Provenance, HistoryEntry, Job) are stored as JSONB exactly as validated
-- by src/contracts. Columns that queries filter, join, lock, or compare on are
-- duplicated as typed columns and are authoritative for those fields.

CREATE TABLE sources (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  -- Server-generated private storage key; never derived from the uploaded filename.
  blob_key    text NOT NULL UNIQUE,
  sha256      text NOT NULL,
  byte_size   bigint NOT NULL,
  created_at  timestamptz NOT NULL,
  data        jsonb NOT NULL
);
CREATE INDEX sources_owner_created_idx ON sources (owner_id, created_at, id);

CREATE TABLE selections (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  source_id   text NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL,
  data        jsonb NOT NULL
);
CREATE INDEX selections_owner_source_idx ON selections (owner_id, source_id, created_at, id);

CREATE TABLE datasets (
  id                        text PRIMARY KEY,
  owner_id                  text NOT NULL,
  source_id                 text NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  -- One committed dataset per selection: duplicate extraction completions under
  -- at-least-once job delivery cannot create a second dataset.
  selection_id              text NOT NULL UNIQUE REFERENCES selections (id) ON DELETE CASCADE,
  created_at                timestamptz NOT NULL,
  -- Mutable fields (authoritative; override the copies inside meta).
  current_version_id        text NOT NULL,
  coverage_acknowledged_at  timestamptz,
  -- Dataset document as created (immutable fields).
  meta                      jsonb NOT NULL
);
CREATE INDEX datasets_owner_source_idx ON datasets (owner_id, source_id, created_at, id);

-- Immutable versions. Each version is a full snapshot (DatasetVersionSnapshot):
-- metadata in dataset_versions, rows in fixed-size chunks in dataset_version_rows.
CREATE TABLE dataset_versions (
  id                 text PRIMARY KEY,
  dataset_id         text NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  owner_id           text NOT NULL,
  seq                integer NOT NULL,
  parent_version_id  text,
  created_at         timestamptz NOT NULL,
  version            jsonb NOT NULL,
  UNIQUE (dataset_id, seq)
);

CREATE TABLE dataset_version_rows (
  version_id  text NOT NULL REFERENCES dataset_versions (id) ON DELETE CASCADE,
  chunk       integer NOT NULL,
  rows        jsonb NOT NULL,
  PRIMARY KEY (version_id, chunk)
);

CREATE TABLE provenance (
  dataset_id  text NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  id          text NOT NULL,
  owner_id    text NOT NULL,
  seq         bigserial NOT NULL,
  data        jsonb NOT NULL,
  PRIMARY KEY (dataset_id, id)
);
CREATE INDEX provenance_dataset_seq_idx ON provenance (dataset_id, seq);

CREATE TABLE history_entries (
  id          text PRIMARY KEY,
  dataset_id  text NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  owner_id    text NOT NULL,
  seq         bigserial NOT NULL,
  created_at  timestamptz NOT NULL,
  data        jsonb NOT NULL
);
CREATE INDEX history_dataset_seq_idx ON history_entries (dataset_id, seq);

CREATE TABLE jobs (
  id                 text PRIMARY KEY,
  owner_id           text NOT NULL,
  -- Owner snapshot (ownerId/kind/actor) so the worker can act on the owner's behalf.
  owner              jsonb NOT NULL,
  idempotency_key    text NOT NULL,
  selection_id       text NOT NULL REFERENCES selections (id) ON DELETE CASCADE,
  status             text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  lease_owner        text,
  lease_expires_at   timestamptz,
  data               jsonb NOT NULL,
  UNIQUE (owner_id, idempotency_key)
);
-- Claim scan: oldest claimable job first.
CREATE INDEX jobs_claim_idx ON jobs (created_at, id) WHERE status IN ('queued', 'running');
CREATE INDEX jobs_owner_idx ON jobs (owner_id, created_at);

CREATE TABLE shares (
  id              text PRIMARY KEY,
  owner_id        text NOT NULL,
  owner           jsonb NOT NULL,
  dataset_id      text NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  version_id      text NOT NULL REFERENCES dataset_versions (id) ON DELETE CASCADE,
  -- sha256 hex of the bearer token. The token itself is never stored.
  token_hash      text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  include_source  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz
);
CREATE INDEX shares_owner_dataset_idx ON shares (owner_id, dataset_id, created_at);

-- Audit/idempotency record for explicit guest-workspace claims at account login.
CREATE TABLE workspace_claims (
  guest_owner_id    text PRIMARY KEY,
  account_owner_id  text NOT NULL,
  claimed_at        timestamptz NOT NULL DEFAULT now()
);
