-- Saved grid views and optional AI analysis records. Cascade from datasets.
-- Analysis is not a dataset version; it cites a version id and becomes stale when that id is no longer current.

CREATE TABLE saved_views (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  dataset_id  text NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  data        jsonb NOT NULL
);
CREATE INDEX saved_views_owner_dataset_idx ON saved_views (owner_id, dataset_id, created_at, id);

CREATE TABLE analysis_consents (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  dataset_id  text NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  version_id  text NOT NULL,
  granted_at  timestamptz NOT NULL,
  data        jsonb NOT NULL
);
CREATE INDEX analysis_consents_owner_dataset_idx ON analysis_consents (owner_id, dataset_id, granted_at);

CREATE TABLE analysis_records (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  dataset_id  text NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
  version_id  text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('overview', 'question')),
  cache_key   text NOT NULL,
  created_at  timestamptz NOT NULL,
  data        jsonb NOT NULL,
  UNIQUE (owner_id, cache_key)
);
CREATE INDEX analysis_records_owner_dataset_idx ON analysis_records (owner_id, dataset_id, created_at, id);
