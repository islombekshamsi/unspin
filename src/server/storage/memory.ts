import {
  AppError,
  type BlobStore,
  type CommitVersionArgs,
  type CreateDatasetArgs,
  type Dataset,
  type DatasetRepository,
  type DatasetVersionSnapshot,
  type HistoryEntry,
  type Job,
  type JobRecord,
  type JobRepository,
  type Owner,
  type Provenance,
  type SelectionRepository,
  type SourceRecord,
  type SourceRepository,
  type SourceSelection,
} from "@/contracts";

/**
 * Process-memory repositories. Not durable: a server restart loses everything.
 * The UI must present this mode as a local session, never as saved work.
 */

const clone = <T>(v: T): T => structuredClone(v);

interface Owned<T> {
  ownerId: string;
  value: T;
}

interface DatasetEntry {
  ownerId: string;
  dataset: Dataset;
  versions: Map<string, DatasetVersionSnapshot>;
  versionOrder: string[];
  provenance: Provenance[];
  history: HistoryEntry[];
}

class MemoryState {
  sources = new Map<string, Owned<SourceRecord>>();
  selections = new Map<string, Owned<SourceSelection>>();
  datasets = new Map<string, DatasetEntry>();
  jobs = new Map<string, JobRecord>();
  jobKeys = new Map<string, string>();
  blobs = new Map<string, Uint8Array>();
}

export function memoryState(): MemoryState {
  const g = globalThis as unknown as { __unspinMemory?: MemoryState };
  g.__unspinMemory ??= new MemoryState();
  return g.__unspinMemory;
}

export class MemorySourceRepository implements SourceRepository {
  constructor(private s = memoryState()) {}
  async create(owner: Owner, record: SourceRecord) {
    this.s.sources.set(record.source.id, { ownerId: owner.ownerId, value: clone(record) });
  }
  async get(owner: Owner, id: string) {
    const e = this.s.sources.get(id);
    return e && e.ownerId === owner.ownerId ? clone(e.value) : null;
  }
  async list(owner: Owner) {
    return [...this.s.sources.values()].filter((e) => e.ownerId === owner.ownerId).map((e) => clone(e.value.source));
  }
  async delete(owner: Owner, id: string) {
    const e = this.s.sources.get(id);
    if (!e || e.ownerId !== owner.ownerId) return false;
    this.s.sources.delete(id);
    for (const [selId, sel] of this.s.selections) if (sel.value.sourceId === id) this.s.selections.delete(selId);
    return true;
  }
}

export class MemorySelectionRepository implements SelectionRepository {
  constructor(private s = memoryState()) {}
  async create(owner: Owner, selection: SourceSelection) {
    this.s.selections.set(selection.id, { ownerId: owner.ownerId, value: clone(selection) });
  }
  async get(owner: Owner, id: string) {
    const e = this.s.selections.get(id);
    return e && e.ownerId === owner.ownerId ? clone(e.value) : null;
  }
  async listBySource(owner: Owner, sourceId: string) {
    return [...this.s.selections.values()]
      .filter((e) => e.ownerId === owner.ownerId && e.value.sourceId === sourceId)
      .map((e) => clone(e.value));
  }
}

export class MemoryDatasetRepository implements DatasetRepository {
  constructor(private s = memoryState()) {}

  private entry(owner: Owner, id: string): DatasetEntry | null {
    const e = this.s.datasets.get(id);
    return e && e.ownerId === owner.ownerId ? e : null;
  }

  async create(owner: Owner, args: CreateDatasetArgs) {
    if (this.s.datasets.has(args.dataset.id)) throw new AppError("idempotency_conflict", "Dataset already exists.");
    const v = args.initialSnapshot.version.id;
    this.s.datasets.set(args.dataset.id, {
      ownerId: owner.ownerId,
      dataset: clone(args.dataset),
      versions: new Map([[v, clone(args.initialSnapshot)]]),
      versionOrder: [v],
      provenance: clone(args.provenance),
      history: [clone(args.historyEntry)],
    });
  }
  async get(owner: Owner, id: string) {
    const e = this.entry(owner, id);
    return e ? clone(e.dataset) : null;
  }
  async listBySource(owner: Owner, sourceId: string) {
    return [...this.s.datasets.values()]
      .filter((e) => e.ownerId === owner.ownerId && e.dataset.sourceId === sourceId)
      .map((e) => clone(e.dataset));
  }
  async findBySelection(owner: Owner, selectionId: string) {
    const e = [...this.s.datasets.values()].find(
      (d) => d.ownerId === owner.ownerId && d.dataset.sourceSelectionId === selectionId,
    );
    return e ? clone(e.dataset) : null;
  }
  async getVersion(owner: Owner, datasetId: string, versionId: string) {
    const v = this.entry(owner, datasetId)?.versions.get(versionId);
    return v ? clone(v) : null;
  }
  async listVersions(owner: Owner, datasetId: string) {
    const e = this.entry(owner, datasetId);
    return e ? e.versionOrder.map((id) => clone(e.versions.get(id)!.version)) : [];
  }
  async getProvenance(owner: Owner, datasetId: string) {
    return clone(this.entry(owner, datasetId)?.provenance ?? []);
  }
  async listHistory(owner: Owner, datasetId: string) {
    return clone(this.entry(owner, datasetId)?.history ?? []);
  }
  async commitVersion(owner: Owner, args: CommitVersionArgs) {
    const e = this.entry(owner, args.datasetId);
    if (!e) throw new AppError("not_found", "Dataset not found.");
    // Single-threaded event loop: this check-and-set has no await in between.
    if (e.dataset.currentVersionId !== args.expectedVersionId) {
      throw new AppError("version_conflict", "The dataset changed since you loaded it.", {
        details: { currentVersionId: e.dataset.currentVersionId },
      });
    }
    let nextId: string;
    if (args.snapshot) {
      nextId = args.snapshot.version.id;
      e.versions.set(nextId, clone(args.snapshot));
      e.versionOrder.push(nextId);
    } else {
      if (!args.targetVersionId || !e.versions.has(args.targetVersionId)) {
        throw new AppError("not_found", "Version not found.");
      }
      nextId = args.targetVersionId;
    }
    e.provenance.push(...clone(args.newProvenance));
    e.history.push(clone(args.historyEntry));
    e.dataset = { ...e.dataset, currentVersionId: nextId };
    return clone(e.dataset);
  }
  async acknowledgeCoverage(owner: Owner, datasetId: string, expectedVersionId: string, at: string) {
    const e = this.entry(owner, datasetId);
    if (!e) throw new AppError("not_found", "Dataset not found.");
    if (e.dataset.currentVersionId !== expectedVersionId) {
      throw new AppError("version_conflict", "The dataset changed since you loaded it.", {
        details: { currentVersionId: e.dataset.currentVersionId },
      });
    }
    e.dataset = { ...e.dataset, coverageAcknowledgedAt: at };
    return clone(e.dataset);
  }
  async deleteBySource(owner: Owner, sourceId: string) {
    let n = 0;
    for (const [id, e] of this.s.datasets) {
      if (e.ownerId === owner.ownerId && e.dataset.sourceId === sourceId) {
        this.s.datasets.delete(id);
        n += 1;
      }
    }
    return n;
  }
}

export class MemoryJobRepository implements JobRepository {
  constructor(private s = memoryState()) {}
  async createOrGet(owner: Owner, job: Job, key: string) {
    const k = `${owner.ownerId}:${key}`;
    const existing = this.s.jobKeys.get(k);
    if (existing) {
      const rec = this.s.jobs.get(existing);
      if (rec) return { job: clone(rec.job), created: false };
    }
    this.s.jobs.set(job.id, { job: clone(job), owner: clone(owner), leaseOwner: null, leaseExpiresAt: null });
    this.s.jobKeys.set(k, job.id);
    return { job: clone(job), created: true };
  }
  async get(owner: Owner, id: string) {
    const r = this.s.jobs.get(id);
    return r && r.owner.ownerId === owner.ownerId ? clone(r.job) : null;
  }
  async getRecord(id: string) {
    const r = this.s.jobs.get(id);
    return r ? clone(r) : null;
  }
  async transition(id: string, expected: Job["status"][], patch: Partial<Job>) {
    const r = this.s.jobs.get(id);
    if (!r || !expected.includes(r.job.status)) return null;
    r.job = { ...r.job, ...patch };
    return clone(r.job);
  }
  async requestCancel(owner: Owner, id: string) {
    const r = this.s.jobs.get(id);
    if (!r || r.owner.ownerId !== owner.ownerId) return null;
    if (r.job.status === "queued") {
      r.job = { ...r.job, status: "cancelled", stage: "finished", cancellationRequested: true, finishedAt: new Date().toISOString() };
    } else if (r.job.status === "running") {
      r.job = { ...r.job, cancellationRequested: true };
    }
    return clone(r.job);
  }
  async claimNext(workerId: string, leaseMs: number) {
    const now = Date.now();
    const candidates = [...this.s.jobs.values()]
      .filter(
        (r) =>
          r.job.status === "queued" ||
          (r.job.status === "running" && r.leaseExpiresAt !== null && Date.parse(r.leaseExpiresAt) < now),
      )
      .sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt));
    const r = candidates[0];
    if (!r) return null;
    r.leaseOwner = workerId;
    r.leaseExpiresAt = new Date(now + leaseMs).toISOString();
    return clone(r);
  }
  async heartbeat(id: string, workerId: string, leaseMs: number) {
    const r = this.s.jobs.get(id);
    if (!r || r.leaseOwner !== workerId) return false;
    r.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    return true;
  }
}

export class MemoryBlobStore implements BlobStore {
  constructor(private s = memoryState()) {}
  async put(key: string, bytes: Uint8Array) {
    this.s.blobs.set(key, new Uint8Array(bytes));
  }
  async get(key: string) {
    const b = this.s.blobs.get(key);
    return b ? new Uint8Array(b) : null;
  }
  async delete(key: string) {
    this.s.blobs.delete(key);
  }
}
