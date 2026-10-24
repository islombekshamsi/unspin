import type { Dataset, DatasetVersion, DatasetVersionSnapshot } from "./dataset";
import type { Job } from "./job";
import type { Actor, HistoryEntry } from "./operations";
import type { Provenance } from "./provenance";
import type { Source, SourceSelection } from "./source";

/**
 * Server-derived identity. Never constructed from request bodies.
 * Every repository lookup is scoped by owner; a resource owned by someone
 * else is indistinguishable from a missing one (returns null).
 */
export interface Owner {
  ownerId: string;
  kind: "guest" | "account";
  actor: Actor;
}

export interface SourceRecord {
  source: Source;
  /** Server-generated private storage key; never shown to clients. */
  blobKey: string;
}

export interface SourceRepository {
  create(owner: Owner, record: SourceRecord): Promise<void>;
  get(owner: Owner, sourceId: string): Promise<SourceRecord | null>;
  list(owner: Owner): Promise<Source[]>;
  /** Deletes the source row; callers delete derivatives and blobs. Returns false when not found/owned. */
  delete(owner: Owner, sourceId: string): Promise<boolean>;
}

export interface SelectionRepository {
  create(owner: Owner, selection: SourceSelection): Promise<void>;
  get(owner: Owner, selectionId: string): Promise<SourceSelection | null>;
  listBySource(owner: Owner, sourceId: string): Promise<SourceSelection[]>;
}

export interface CreateDatasetArgs {
  dataset: Dataset;
  initialSnapshot: DatasetVersionSnapshot;
  provenance: Provenance[];
  historyEntry: HistoryEntry;
}

export interface CommitVersionArgs {
  datasetId: string;
  /** Must equal the dataset's currentVersionId at commit time, else version_conflict (409). */
  expectedVersionId: string;
  /** New immutable version content; for restores this is null and targetVersionId is used. */
  snapshot: DatasetVersionSnapshot | null;
  /** For restore: the stored version that becomes current again. */
  targetVersionId: string | null;
  newProvenance: Provenance[];
  historyEntry: HistoryEntry;
}

export interface DatasetRepository {
  /** Atomically stores dataset + initial version + provenance + history entry. */
  create(owner: Owner, args: CreateDatasetArgs): Promise<void>;
  get(owner: Owner, datasetId: string): Promise<Dataset | null>;
  listBySource(owner: Owner, sourceId: string): Promise<Dataset[]>;
  /** Existing dataset produced from this selection (idempotent extraction completion). */
  findBySelection(owner: Owner, selectionId: string): Promise<Dataset | null>;
  getVersion(owner: Owner, datasetId: string, versionId: string): Promise<DatasetVersionSnapshot | null>;
  listVersions(owner: Owner, datasetId: string): Promise<DatasetVersion[]>;
  getProvenance(owner: Owner, datasetId: string): Promise<Provenance[]>;
  listHistory(owner: Owner, datasetId: string): Promise<HistoryEntry[]>;
  /**
   * Transactional compare-and-set on currentVersionId. Throws AppError("version_conflict")
   * with details.currentVersionId when expectedVersionId is stale.
   */
  commitVersion(owner: Owner, args: CommitVersionArgs): Promise<Dataset>;
  acknowledgeCoverage(owner: Owner, datasetId: string, expectedVersionId: string, at: string): Promise<Dataset>;
  deleteBySource(owner: Owner, sourceId: string): Promise<number>;
}

export interface JobRecord {
  job: Job;
  owner: Owner;
  /** Lease holder for durable worker mode. */
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

export interface JobRepository {
  /** Idempotent per (owner, idempotencyKey): returns the existing job when present. */
  createOrGet(owner: Owner, job: Job, idempotencyKey: string): Promise<{ job: Job; created: boolean }>;
  get(owner: Owner, jobId: string): Promise<Job | null>;
  /** System-level access for the job runner; never exposed through routes. */
  getRecord(jobId: string): Promise<JobRecord | null>;
  /** Applies a patch only if the job's status is one of `expectedStatuses`; returns null otherwise. */
  transition(jobId: string, expectedStatuses: Job["status"][], patch: Partial<Job>): Promise<Job | null>;
  requestCancel(owner: Owner, jobId: string): Promise<Job | null>;
  /** Claims the oldest queued (or lease-expired running) job for a worker. */
  claimNext(workerId: string, leaseMs: number): Promise<JobRecord | null>;
  heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
}

export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export interface Share {
  id: string;
  datasetId: string;
  versionId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  includeSource: boolean;
}

export interface ShareRepository {
  create(owner: Owner, share: Share, tokenHash: string): Promise<void>;
  revoke(owner: Owner, shareId: string, at: string): Promise<boolean>;
  /** Resolves an unrevoked, unexpired share by token hash. */
  resolve(tokenHash: string, now: string): Promise<{ share: Share; owner: Owner } | null>;
  listByDataset(owner: Owner, datasetId: string): Promise<Share[]>;
}

export interface Repositories {
  mode: "memory" | "postgres";
  durable: boolean;
  blobMode: "memory" | "filesystem" | "s3";
  sources: SourceRepository;
  selections: SelectionRepository;
  datasets: DatasetRepository;
  jobs: JobRepository;
  blobs: BlobStore;
  shares: ShareRepository | null;
  /** Readiness probe (e.g. SELECT 1); never throws. */
  ready(): Promise<boolean>;
}
