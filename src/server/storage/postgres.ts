import type { Pool, PoolClient } from "pg";
import {
  AppError,
  type CommitVersionArgs,
  type CreateDatasetArgs,
  type Dataset,
  type DatasetRepository,
  type DatasetVersion,
  type DatasetVersionSnapshot,
  type HistoryEntry,
  type Job,
  type JobRecord,
  type JobRepository,
  type Owner,
  type Provenance,
  type Row,
  type SelectionRepository,
  type Share,
  type ShareRepository,
  type Source,
  type SourceRecord,
  type SourceRepository,
  type SourceSelection,
} from "@/contracts";
import { guardPool, withTransaction, type Db } from "./pool";
import { conflict, notFound, TERMINAL_JOB_STATUSES, type ClaimResult } from "./shared";
import { PostgresAnalysisRepository, PostgresViewRepository } from "./views";

/**
 * PostgreSQL repositories implementing the frozen interfaces in src/contracts/repositories.ts.
 * Schema: db/schema/001_init.sql. Every user-facing query is filtered by owner_id; a row owned
 * by someone else is indistinguishable from a missing one.
 */

/** Rows per dataset_version_rows chunk: keeps each JSONB value bounded (20k rows => 40 chunks). */
export const ROW_CHUNK_SIZE = 500;

const json = (v: unknown) => JSON.stringify(v);

function iso(v: Date | string | null): string | null {
  if (v === null) return null;
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && (constraint === undefined || err.constraint === constraint);
}

// ---------------------------------------------------------------------------
// Sources and selections
// ---------------------------------------------------------------------------

export class PostgresSourceRepository implements SourceRepository {
  constructor(private db: Db) {}

  async create(owner: Owner, record: SourceRecord) {
    const s = record.source;
    try {
      await this.db.query(
        `INSERT INTO sources (id, owner_id, blob_key, sha256, byte_size, created_at, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [s.id, owner.ownerId, record.blobKey, s.sha256, s.byteSize, s.createdAt, json(s)],
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("Source already exists.");
      throw e;
    }
  }

  async get(owner: Owner, sourceId: string): Promise<SourceRecord | null> {
    const { rows } = await this.db.query<{ data: Source; blob_key: string }>(
      "SELECT data, blob_key FROM sources WHERE id = $1 AND owner_id = $2",
      [sourceId, owner.ownerId],
    );
    return rows[0] ? { source: rows[0].data, blobKey: rows[0].blob_key } : null;
  }

  async list(owner: Owner): Promise<Source[]> {
    const { rows } = await this.db.query<{ data: Source }>(
      "SELECT data FROM sources WHERE owner_id = $1 ORDER BY created_at, id",
      [owner.ownerId],
    );
    return rows.map((r) => r.data);
  }

  /** Cascades (FK ON DELETE CASCADE) to selections, datasets, versions, provenance, history, jobs, shares. */
  async delete(owner: Owner, sourceId: string): Promise<boolean> {
    const r = await this.db.query("DELETE FROM sources WHERE id = $1 AND owner_id = $2", [sourceId, owner.ownerId]);
    return (r.rowCount ?? 0) > 0;
  }
}

export class PostgresSelectionRepository implements SelectionRepository {
  constructor(private db: Db) {}

  async create(owner: Owner, selection: SourceSelection) {
    let r;
    try {
      r = await this.db.query(
        `INSERT INTO selections (id, owner_id, source_id, created_at, data)
         SELECT $1, $2, $3, $4, $5::jsonb
         WHERE EXISTS (SELECT 1 FROM sources WHERE id = $3 AND owner_id = $2)`,
        [selection.id, owner.ownerId, selection.sourceId, selection.createdAt, json(selection)],
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("Selection already exists.");
      throw e;
    }
    if (r.rowCount === 0) throw notFound("Source not found.");
  }

  async get(owner: Owner, selectionId: string): Promise<SourceSelection | null> {
    const { rows } = await this.db.query<{ data: SourceSelection }>(
      "SELECT data FROM selections WHERE id = $1 AND owner_id = $2",
      [selectionId, owner.ownerId],
    );
    return rows[0]?.data ?? null;
  }

  async listBySource(owner: Owner, sourceId: string): Promise<SourceSelection[]> {
    const { rows } = await this.db.query<{ data: SourceSelection }>(
      "SELECT data FROM selections WHERE owner_id = $1 AND source_id = $2 ORDER BY created_at, id",
      [owner.ownerId, sourceId],
    );
    return rows.map((r) => r.data);
  }
}

// ---------------------------------------------------------------------------
// Datasets, immutable versions, provenance, history
// ---------------------------------------------------------------------------

interface DatasetRow {
  meta: Dataset;
  current_version_id: string;
  coverage_acknowledged_at: Date | null;
}

function toDataset(r: DatasetRow): Dataset {
  return { ...r.meta, currentVersionId: r.current_version_id, coverageAcknowledgedAt: iso(r.coverage_acknowledged_at) };
}

const DATASET_COLS = "meta, current_version_id, coverage_acknowledged_at";

async function insertVersion(c: PoolClient, ownerId: string, seq: number, snapshot: DatasetVersionSnapshot) {
  const v = snapshot.version;
  await c.query(
    `INSERT INTO dataset_versions (id, dataset_id, owner_id, seq, parent_version_id, created_at, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [v.id, v.datasetId, ownerId, seq, v.parentVersionId, v.createdAt, json(v)],
  );
  const chunks: number[] = [];
  const bodies: string[] = [];
  for (let i = 0; i * ROW_CHUNK_SIZE < snapshot.rows.length; i += 1) {
    chunks.push(i);
    bodies.push(json(snapshot.rows.slice(i * ROW_CHUNK_SIZE, (i + 1) * ROW_CHUNK_SIZE)));
  }
  if (chunks.length > 0) {
    await c.query(
      `INSERT INTO dataset_version_rows (version_id, chunk, rows)
       SELECT $1, c, r FROM unnest($2::int[], $3::jsonb[]) AS t(c, r)`,
      [v.id, chunks, bodies],
    );
  }
}

async function insertProvenance(c: PoolClient, ownerId: string, datasetId: string, items: Provenance[]) {
  if (items.length === 0) return;
  await c.query(
    `INSERT INTO provenance (dataset_id, id, owner_id, data)
     SELECT $1, t.id, $2, t.d FROM unnest($3::text[], $4::jsonb[]) WITH ORDINALITY AS t(id, d, ord)
     ORDER BY t.ord
     ON CONFLICT (dataset_id, id) DO NOTHING`,
    [datasetId, ownerId, items.map((p) => p.id), items.map(json)],
  );
}

async function insertHistory(c: PoolClient, ownerId: string, entry: HistoryEntry) {
  await c.query(
    `INSERT INTO history_entries (id, dataset_id, owner_id, created_at, data) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [entry.id, entry.datasetId, ownerId, entry.createdAt, json(entry)],
  );
}

function versionConflict(currentVersionId: string): AppError {
  return new AppError("version_conflict", "The dataset changed since you loaded it.", { details: { currentVersionId } });
}

export class PostgresDatasetRepository implements DatasetRepository {
  constructor(private db: Db) {}

  async create(owner: Owner, args: CreateDatasetArgs) {
    const d = args.dataset;
    const v = args.initialSnapshot.version;
    if (v.datasetId !== d.id || d.currentVersionId !== v.id || args.historyEntry.datasetId !== d.id) {
      throw new AppError("internal", "Dataset, initial version, and history entry do not match.");
    }
    try {
      await withTransaction(this.db, async (c) => {
        const r = await c.query(
          `INSERT INTO datasets (id, owner_id, source_id, selection_id, created_at, current_version_id, coverage_acknowledged_at, meta)
           SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb
           WHERE EXISTS (SELECT 1 FROM selections WHERE id = $4 AND source_id = $3 AND owner_id = $2)`,
          [d.id, owner.ownerId, d.sourceId, d.sourceSelectionId, d.createdAt, d.currentVersionId, d.coverageAcknowledgedAt, json(d)],
        );
        if (r.rowCount === 0) throw notFound("Selection not found.");
        await insertVersion(c, owner.ownerId, 1, args.initialSnapshot);
        await insertProvenance(c, owner.ownerId, d.id, args.provenance);
        await insertHistory(c, owner.ownerId, args.historyEntry);
      });
    } catch (e) {
      if (isUniqueViolation(e, "datasets_selection_id_key")) {
        const existing = await this.findBySelection(owner, d.sourceSelectionId);
        throw conflict("A dataset already exists for this selection.", existing ? { datasetId: existing.id } : undefined);
      }
      if (isUniqueViolation(e)) throw conflict("Dataset already exists.");
      throw e;
    }
  }

  async get(owner: Owner, datasetId: string) {
    const { rows } = await this.db.query<DatasetRow>(
      `SELECT ${DATASET_COLS} FROM datasets WHERE id = $1 AND owner_id = $2`,
      [datasetId, owner.ownerId],
    );
    return rows[0] ? toDataset(rows[0]) : null;
  }

  async listBySource(owner: Owner, sourceId: string) {
    const { rows } = await this.db.query<DatasetRow>(
      `SELECT ${DATASET_COLS} FROM datasets WHERE owner_id = $1 AND source_id = $2 ORDER BY created_at, id`,
      [owner.ownerId, sourceId],
    );
    return rows.map(toDataset);
  }

  async findBySelection(owner: Owner, selectionId: string) {
    const { rows } = await this.db.query<DatasetRow>(
      `SELECT ${DATASET_COLS} FROM datasets WHERE owner_id = $1 AND selection_id = $2`,
      [owner.ownerId, selectionId],
    );
    return rows[0] ? toDataset(rows[0]) : null;
  }

  async getVersion(owner: Owner, datasetId: string, versionId: string): Promise<DatasetVersionSnapshot | null> {
    const { rows } = await this.db.query<{ version: DatasetVersion }>(
      `SELECT v.version FROM dataset_versions v
       WHERE v.id = $1 AND v.dataset_id = $2 AND v.owner_id = $3`,
      [versionId, datasetId, owner.ownerId],
    );
    if (!rows[0]) return null;
    const chunks = await this.db.query<{ rows: Row[] }>(
      "SELECT rows FROM dataset_version_rows WHERE version_id = $1 ORDER BY chunk",
      [versionId],
    );
    return { version: rows[0].version, rows: chunks.rows.flatMap((c) => c.rows) };
  }

  async listVersions(owner: Owner, datasetId: string) {
    const { rows } = await this.db.query<{ version: DatasetVersion }>(
      "SELECT version FROM dataset_versions WHERE dataset_id = $1 AND owner_id = $2 ORDER BY seq",
      [datasetId, owner.ownerId],
    );
    return rows.map((r) => r.version);
  }

  async getProvenance(owner: Owner, datasetId: string) {
    const { rows } = await this.db.query<{ data: Provenance }>(
      "SELECT data FROM provenance WHERE dataset_id = $1 AND owner_id = $2 ORDER BY seq",
      [datasetId, owner.ownerId],
    );
    return rows.map((r) => r.data);
  }

  async listHistory(owner: Owner, datasetId: string) {
    const { rows } = await this.db.query<{ data: HistoryEntry }>(
      "SELECT data FROM history_entries WHERE dataset_id = $1 AND owner_id = $2 ORDER BY seq",
      [datasetId, owner.ownerId],
    );
    return rows.map((r) => r.data);
  }

  /**
   * Compare-and-set under a row lock: the dataset row is locked FOR UPDATE, its
   * current_version_id compared with expectedVersionId, and the new version, provenance,
   * history entry, and pointer move are committed together or not at all.
   */
  async commitVersion(owner: Owner, args: CommitVersionArgs): Promise<Dataset> {
    if (args.historyEntry.datasetId !== args.datasetId || (args.snapshot && args.snapshot.version.datasetId !== args.datasetId)) {
      throw new AppError("internal", "Version or history entry belongs to another dataset.");
    }
    return withTransaction(this.db, async (c) => {
      const locked = await c.query<DatasetRow>(
        `SELECT ${DATASET_COLS} FROM datasets WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
        [args.datasetId, owner.ownerId],
      );
      const row = locked.rows[0];
      if (!row) throw notFound("Dataset not found.");
      if (row.current_version_id !== args.expectedVersionId) throw versionConflict(row.current_version_id);

      let nextId: string;
      if (args.snapshot) {
        const seq = await c.query<{ next: number }>(
          "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM dataset_versions WHERE dataset_id = $1",
          [args.datasetId],
        );
        await insertVersion(c, owner.ownerId, seq.rows[0].next, args.snapshot);
        nextId = args.snapshot.version.id;
      } else {
        const target = args.targetVersionId
          ? await c.query("SELECT 1 FROM dataset_versions WHERE id = $1 AND dataset_id = $2", [args.targetVersionId, args.datasetId])
          : null;
        if (!target || target.rowCount === 0) throw notFound("Version not found.");
        nextId = args.targetVersionId!;
      }
      await insertProvenance(c, owner.ownerId, args.datasetId, args.newProvenance);
      await insertHistory(c, owner.ownerId, args.historyEntry);
      const updated = await c.query<DatasetRow>(
        `UPDATE datasets SET current_version_id = $2 WHERE id = $1 RETURNING ${DATASET_COLS}`,
        [args.datasetId, nextId],
      );
      return toDataset(updated.rows[0]);
    });
  }

  async acknowledgeCoverage(owner: Owner, datasetId: string, expectedVersionId: string, at: string) {
    const { rows } = await this.db.query<DatasetRow>(
      `UPDATE datasets SET coverage_acknowledged_at = $4
       WHERE id = $1 AND owner_id = $2 AND current_version_id = $3
       RETURNING ${DATASET_COLS}`,
      [datasetId, owner.ownerId, expectedVersionId, at],
    );
    if (rows[0]) return toDataset(rows[0]);
    const current = await this.get(owner, datasetId);
    if (!current) throw notFound("Dataset not found.");
    throw versionConflict(current.currentVersionId);
  }

  async deleteBySource(owner: Owner, sourceId: string) {
    const r = await this.db.query("DELETE FROM datasets WHERE owner_id = $1 AND source_id = $2", [owner.ownerId, sourceId]);
    return r.rowCount ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

interface JobRow {
  data: Job;
  owner: Owner;
  lease_owner: string | null;
  lease_expires_at: Date | null;
}

const JOB_COLS = "data, owner, lease_owner, lease_expires_at";

function toJobRecord(r: JobRow): JobRecord {
  return { job: r.data, owner: r.owner, leaseOwner: r.lease_owner, leaseExpiresAt: iso(r.lease_expires_at) };
}

export class PostgresJobRepository implements JobRepository {
  constructor(private db: Db) {}

  /** INSERT ... ON CONFLICT DO NOTHING on (owner_id, idempotency_key), then read the winner. */
  async createOrGet(owner: Owner, job: Job, idempotencyKey: string) {
    const inserted = await this.db.query<{ data: Job }>(
      `INSERT INTO jobs (id, owner_id, owner, idempotency_key, selection_id, status, created_at, data)
       SELECT $1, $2, $3::jsonb, $4, $5, $6, $7, $8::jsonb
       WHERE EXISTS (SELECT 1 FROM selections WHERE id = $5 AND owner_id = $2)
       ON CONFLICT (owner_id, idempotency_key) DO NOTHING
       RETURNING data`,
      [job.id, owner.ownerId, json(owner), idempotencyKey, job.sourceSelectionId, job.status, job.createdAt, json(job)],
    );
    if (inserted.rows[0]) return { job: inserted.rows[0].data, created: true };
    const existing = await this.db.query<{ data: Job }>(
      "SELECT data FROM jobs WHERE owner_id = $1 AND idempotency_key = $2",
      [owner.ownerId, idempotencyKey],
    );
    if (existing.rows[0]) return { job: existing.rows[0].data, created: false };
    throw notFound("Selection not found.");
  }

  async get(owner: Owner, jobId: string) {
    const { rows } = await this.db.query<{ data: Job }>("SELECT data FROM jobs WHERE id = $1 AND owner_id = $2", [
      jobId,
      owner.ownerId,
    ]);
    return rows[0]?.data ?? null;
  }

  async getRecord(jobId: string) {
    const { rows } = await this.db.query<JobRow>(`SELECT ${JOB_COLS} FROM jobs WHERE id = $1`, [jobId]);
    return rows[0] ? toJobRecord(rows[0]) : null;
  }

  /** Conditional UPDATE on status: the patch applies only while status is one of expectedStatuses. */
  async transition(jobId: string, expectedStatuses: Job["status"][], patch: Partial<Job>) {
    const { rows } = await this.db.query<{ data: Job }>(
      `UPDATE jobs SET
         data = data || $3::jsonb,
         status = COALESCE($3::jsonb->>'status', status),
         lease_owner = CASE WHEN COALESCE($3::jsonb->>'status', status) = ANY($4::text[]) THEN NULL ELSE lease_owner END,
         lease_expires_at = CASE WHEN COALESCE($3::jsonb->>'status', status) = ANY($4::text[]) THEN NULL ELSE lease_expires_at END,
         updated_at = now()
       WHERE id = $1 AND status = ANY($2::text[])
       RETURNING data`,
      [jobId, expectedStatuses, json(patch), TERMINAL_JOB_STATUSES],
    );
    return rows[0]?.data ?? null;
  }

  async requestCancel(owner: Owner, jobId: string) {
    const { rows } = await this.db.query<{ data: Job }>(
      `UPDATE jobs SET
         data = CASE
           WHEN status = 'queued' THEN data || jsonb_build_object(
             'status', 'cancelled', 'stage', 'finished', 'cancellationRequested', true, 'finishedAt', $3::text)
           WHEN status = 'running' THEN data || '{"cancellationRequested": true}'::jsonb
           ELSE data END,
         lease_owner = CASE WHEN status = 'queued' THEN NULL ELSE lease_owner END,
         lease_expires_at = CASE WHEN status = 'queued' THEN NULL ELSE lease_expires_at END,
         status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
         updated_at = now()
       WHERE id = $1 AND owner_id = $2
       RETURNING data`,
      [jobId, owner.ownerId, new Date().toISOString()],
    );
    return rows[0]?.data ?? null;
  }

  /**
   * Claims the oldest queued job whose lease is free (or expired), or a running job whose
   * worker stopped heartbeating. FOR UPDATE SKIP LOCKED lets concurrent workers pass over
   * rows another worker is claiming instead of blocking on or double-claiming them.
   */
  async claimNext(workerId: string, leaseMs: number) {
    const { rows } = await this.db.query<JobRow>(
      `WITH candidate AS (
         SELECT id FROM jobs
         WHERE (status = 'queued' AND (lease_expires_at IS NULL OR lease_expires_at < now()))
            OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE jobs j SET lease_owner = $1, lease_expires_at = now() + ($2::int * interval '1 millisecond'), updated_at = now()
       FROM candidate WHERE j.id = candidate.id
       RETURNING j.data, j.owner, j.lease_owner, j.lease_expires_at`,
      [workerId, Math.max(1, Math.round(leaseMs))],
    );
    return rows[0] ? toJobRecord(rows[0]) : null;
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number) {
    const r = await this.db.query(
      `UPDATE jobs SET lease_expires_at = now() + ($3::int * interval '1 millisecond'), updated_at = now()
       WHERE id = $1 AND lease_owner = $2 AND status IN ('queued', 'running')`,
      [jobId, workerId, Math.max(1, Math.round(leaseMs))],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Crash recovery for jobs started inline (no lease) whose process died: a running job with
   * no lease that has not been updated for `olderThanMs` is failed with a retryable error.
   * Leased jobs are recovered by lease expiry in claimNext instead.
   */
  async failOrphanedInlineJobs(olderThanMs: number): Promise<number> {
    const r = await this.db.query(
      `UPDATE jobs SET
         status = 'failed',
         data = data || jsonb_build_object('status', 'failed', 'stage', 'finished', 'finishedAt', $2::text,
           'error', jsonb_build_object('code', 'internal', 'message',
             'Processing was interrupted by a server restart. Nothing was saved; you can retry.', 'retryable', true)),
         updated_at = now()
       WHERE status = 'running' AND lease_owner IS NULL
         AND updated_at < now() - ($1::int * interval '1 millisecond')`,
      [Math.max(1, Math.round(olderThanMs)), new Date().toISOString()],
    );
    return r.rowCount ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Shares
// ---------------------------------------------------------------------------

interface ShareRow {
  id: string;
  dataset_id: string;
  version_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  include_source: boolean;
}

const SHARE_COLS = "id, dataset_id, version_id, created_at, expires_at, revoked_at, include_source";

function toShare(r: ShareRow): Share {
  return {
    id: r.id,
    datasetId: r.dataset_id,
    versionId: r.version_id,
    createdAt: iso(r.created_at)!,
    expiresAt: iso(r.expires_at)!,
    revokedAt: iso(r.revoked_at),
    includeSource: r.include_source,
  };
}

export class PostgresShareRepository implements ShareRepository {
  constructor(private db: Db) {}

  async create(owner: Owner, share: Share, tokenHash: string) {
    const r = await this.db.query(
      `INSERT INTO shares (id, owner_id, owner, dataset_id, version_id, token_hash, include_source, created_at, expires_at, revoked_at)
       SELECT $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10
       WHERE EXISTS (
         SELECT 1 FROM dataset_versions v JOIN datasets d ON d.id = v.dataset_id
         WHERE v.id = $5 AND v.dataset_id = $4 AND d.owner_id = $2)`,
      [share.id, owner.ownerId, json(owner), share.datasetId, share.versionId, tokenHash, share.includeSource, share.createdAt, share.expiresAt, share.revokedAt],
    );
    if (r.rowCount === 0) throw notFound("Dataset version not found.");
  }

  async revoke(owner: Owner, shareId: string, at: string) {
    const r = await this.db.query(
      "UPDATE shares SET revoked_at = COALESCE(revoked_at, $3) WHERE id = $1 AND owner_id = $2",
      [shareId, owner.ownerId, at],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async resolve(tokenHash: string, now: string) {
    const { rows } = await this.db.query<ShareRow & { owner: Owner }>(
      `SELECT ${SHARE_COLS}, owner FROM shares
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
      [tokenHash, now],
    );
    return rows[0] ? { share: toShare(rows[0]), owner: rows[0].owner } : null;
  }

  async listByDataset(owner: Owner, datasetId: string) {
    const { rows } = await this.db.query<ShareRow>(
      `SELECT ${SHARE_COLS} FROM shares WHERE owner_id = $1 AND dataset_id = $2 ORDER BY created_at, id`,
      [owner.ownerId, datasetId],
    );
    return rows.map(toShare);
  }
}

// ---------------------------------------------------------------------------
// Guest workspace claim
// ---------------------------------------------------------------------------

const OWNED_TABLES = [
  "sources",
  "selections",
  "datasets",
  "dataset_versions",
  "provenance",
  "history_entries",
  "jobs",
  "shares",
] as const;

/**
 * Moves everything a guest owns to an account in one transaction. Idempotent for the same
 * account; a guest workspace already claimed by a different account is refused.
 */
export async function claimGuestWorkspacePg(pool: Pool, guest: Owner, account: Owner): Promise<ClaimResult> {
  return withTransaction(guardPool(pool), async (c) => {
    const claim = await c.query<{ account_owner_id: string }>(
      `INSERT INTO workspace_claims (guest_owner_id, account_owner_id) VALUES ($1, $2)
       ON CONFLICT (guest_owner_id) DO UPDATE SET guest_owner_id = workspace_claims.guest_owner_id
       RETURNING account_owner_id`,
      [guest.ownerId, account.ownerId],
    );
    if (claim.rows[0].account_owner_id !== account.ownerId) {
      throw new AppError("forbidden", "This guest workspace was already claimed by another account.");
    }
    const moved: Record<string, number> = {};
    for (const table of OWNED_TABLES) {
      const ownerJson = table === "jobs" || table === "shares" ? ", owner = $3::jsonb" : "";
      const params = ownerJson ? [account.ownerId, guest.ownerId, json(account)] : [account.ownerId, guest.ownerId];
      const r = await c.query(`UPDATE ${table} SET owner_id = $1${ownerJson} WHERE owner_id = $2`, params);
      moved[table] = r.rowCount ?? 0;
    }
    return { sources: moved.sources, datasets: moved.datasets, jobs: moved.jobs, shares: moved.shares };
  });
}

export interface PostgresRepositorySet {
  sources: PostgresSourceRepository;
  selections: PostgresSelectionRepository;
  datasets: PostgresDatasetRepository;
  jobs: PostgresJobRepository;
  shares: PostgresShareRepository;
  views: PostgresViewRepository;
  analysis: PostgresAnalysisRepository;
}

export function createPostgresRepositories(pool: Pool): PostgresRepositorySet {
  const db = guardPool(pool);
  return {
    sources: new PostgresSourceRepository(db),
    selections: new PostgresSelectionRepository(db),
    datasets: new PostgresDatasetRepository(db),
    jobs: new PostgresJobRepository(db),
    shares: new PostgresShareRepository(db),
    views: new PostgresViewRepository(db),
    analysis: new PostgresAnalysisRepository(db),
  };
}