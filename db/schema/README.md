# Schema proposals (infrastructure)

`001_init.sql` is the proposed initial schema; `001_init.down.sql` reverses it for disposable
databases only. The coordinator reviews and copies `001_init.sql` to `db/migrations/`; the runner
(`src/server/storage/migrate.ts`, `npm run db:migrate`) applies `db/migrations/NNN_name.sql` files in
order, once each, and never applies `*.down.sql`.

## Design decisions

- **Versions are JSONB snapshots, rows chunked.** A `DatasetVersionSnapshot` is immutable and always
  read whole (`getVersion`), so each version stores its metadata in `dataset_versions.version` and its
  rows in `dataset_version_rows` chunks of 500. One version read is two indexed queries; commits insert
  rows in one statement. Chunking keeps each JSONB value bounded (20,000 rows × 64 columns ≈ 40 chunks)
  instead of one value of hundreds of MB. A normalized cell table would multiply rows by
  columns × versions (≈1.3 M rows per version at the limits) with no query that needs it today.
  Cost: each version is a full copy (TOAST-compressed). If storage becomes the bottleneck, the next
  step is content-addressed row chunks shared between versions, without an API change.
- **Mutable dataset fields are columns.** `current_version_id` and `coverage_acknowledged_at` are the
  only mutable dataset fields; they are typed columns (authoritative) so compare-and-set is a plain
  `SELECT … FOR UPDATE` / conditional `UPDATE`. The rest of the `Dataset` document is `meta` JSONB.
- **One dataset per selection** (`datasets.selection_id UNIQUE`): duplicate job completions under
  at-least-once delivery cannot produce two datasets.
- **Jobs** keep `status`, lease fields, and `(owner_id, idempotency_key) UNIQUE` as columns for
  claiming and idempotent creation; the `Job` document is JSONB.
- **Shares** store `sha256(token)` only, with a CHECK on its format.
- **Deletion** cascades from `sources` through every derived table (see `deployment/DATA_POLICY.md`).
- **No extensions, no hypertables.** Runs on stock PostgreSQL 14+ and Tiger Data unchanged.
