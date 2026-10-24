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
  type Share,
  type ShareRepository,
  type SourceRecord,
  type SourceRepository,
  type SourceSelection,
} from "@/contracts";
import { conflict, notFound, TERMINAL_JOB_STATUSES, type ClaimResult } from "./shared";

/**
 * Process-memory repositories. Not durable: a server restart loses everything.
 * The UI must present this mode as a local session, never as saved work.
 * Semantics mirror the PostgreSQL implementation; both run the same contract tests.
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

interface ShareEntry {
  owner: Owner;
  share: Share;
  tokenHash: string;
}

export class MemoryState {
  sources = new Map<string, Owned<SourceRecord>>();
  selections = new Map<string, Owned<SourceSelection>>();
  datasets = new Map<string, DatasetEntry>();
  jobs = new Map<string, JobRecord>();
  jobKeys = new Map<string, string>();
  blobs = new Map<string, Uint8Array>();
  shares = new Map<string, ShareEntry>();
  claims = new Map<string, string>();
}

export function memoryState(): MemoryState {
  const g = globalThis as unknown as { __unspinMemory?: MemoryState };
  g.__unspinMemory ??= new MemoryState();
  // An instance created by an older module version during HMR may lack newer maps.
  const s = g.__unspinMemory as Partial<MemoryState>;
  s.shares ??= new Map();
  s.claims ??= new Map();
  return g.__unspinMemory;
}

function cascadeSelections(s: MemoryState, selectionIds: Set<string>) {
  for (const [jobId, rec] of s.jobs) {
    if (selectionIds.has(rec.job.sourceSelectionId)) s.jobs.delete(jobId);
  }
  for (const [k, jobId] of s.jobKeys) if (!s.jobs.has(jobId)) s.jobKeys.delete(k);
  for (const id of selectionIds) s.selections.delete(id);
}

function deleteDatasetEntry(s: MemoryState, datasetId: string) {
  s.datasets.delete(datasetId);
  for (const [id, e] of s.shares) if (e.share.datasetId === datasetId) s.shares.delete(id);
}

export class MemorySourceRepository implements SourceRepository {
  constructor(private s = memoryState()) {}
  async create(owner: Owner, record: SourceRecord) {
    if (this.s.sources.has(record.source.id)) throw conflict("Source already exists.");
    this.s.sources.set(record.source.id, { ownerId: owner.ownerId, value: clone(record) });
  }
  async get(owner: Owner, id: string) {
    const e = this.s.sources.get(id);
    return e && e.ownerId === owner.ownerId ? clone(e.value) : null;
  }
  async list(owner: Owner) {
    return [...this.s.sources.values()]
      .filter((e) => e.ownerId === owner.ownerId)
      .map((e) => clone(e.value.source))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  /** Same cascade as the PostgreSQL foreign keys: selections, datasets, jobs, shares. */
  async delete(owner: Owner, id: string) {
    const e = this.s.sources.get(id);
    if (!e || e.ownerId !== owner.ownerId) return false;
    this.s.sources.delete(id);
    for (const [dsId, d] of this.s.datasets) if (d.dataset.sourceId === id) deleteDatasetEntry(this.s, dsId);
    const sels = new Set([...this.s.selections].filter(([, sel]) => sel.value.sourceId === id).map(([selId]) => selId));
    cascadeSelections(this.s, sels);
    return true;
  }
}

export class MemorySelectionRepository implements SelectionRepository {
  constructor(private s = memoryState()) {}
  async create(owner: Owner, selection: SourceSelection) {
    const src = this.s.sources.get(selection.sourceId);
    if (!src || src.ownerId !== owner.ownerId) throw notFound("Source not found.");
    if (this.s.selections.has(selection.id)) throw conflict("Selection already exists.");
    this.s.selections.set(selection.id, { ownerId: owner.ownerId, value: clone(selection) });
  }
  async get(owner: Owner, id: string) {
    const e = this.s.selections.get(id);
    return e && e.ownerId === owner.ownerId ? clone(e.value) : null;
  }
  async listBySource(owner: Owner, sourceId: string) {
    return [...this.s.selections.values()]
      .filter((e) => e.ownerId === owner.ownerId && e.value.sourceId === sourceId)
      .map((e) => clone(e.value))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
}

function versionConflict(currentVersionId: string): AppError {
  return new AppError("version_conflict", "The dataset changed since you loaded it.", { details: { currentVersionId } });
}

export class MemoryDatasetRepository implements DatasetRepository {
  constructor(private s = memoryState()) {}

  private entry(owner: Owner, id: string): DatasetEntry | null {
    const e = this.s.datasets.get(id);
    return e && e.ownerId === owner.ownerId ? e : null;
  }

  async create(owner: Owner, args: CreateDatasetArgs) {
    const d = args.dataset;
    const v = args.initialSnapshot.version.id;
    if (args.initialSnapshot.version.datasetId !== d.id || d.currentVersionId !== v || args.historyEntry.datasetId !== d.id) {
      throw new AppError("internal", "Dataset, initial version, and history entry do not match.");
    }
    const sel = this.s.selections.get(d.sourceSelectionId);
    if (!sel || sel.ownerId !== owner.ownerId || sel.value.sourceId !== d.sourceId) throw notFound("Selection not found.");
    if (this.s.datasets.has(d.id)) throw conflict("Dataset already exists.");
    const existing = [...this.s.datasets.values()].find((e) => e.dataset.sourceSelectionId === d.sourceSelectionId);
    if (existing) throw conflict("A dataset already exists for this selection.", { datasetId: existing.dataset.id });
    this.s.datasets.set(d.id, {
      ownerId: owner.ownerId,
      dataset: clone(d),
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
      .map((e) => clone(e.dataset))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
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
    if (args.historyEntry.datasetId !== args.datasetId || (args.snapshot && args.snapshot.version.datasetId !== args.datasetId)) {
      throw new AppError("internal", "Version or history entry belongs to another dataset.");
    }
    const e = this.entry(owner, args.datasetId);
    if (!e) throw notFound("Dataset not found.");
    // Single-threaded event loop: this check-and-set has no await in between.
    if (e.dataset.currentVersionId !== args.expectedVersionId) throw versionConflict(e.dataset.currentVersionId);
    let nextId: string;
    if (args.snapshot) {
      nextId = args.snapshot.version.id;
      if (e.versions.has(nextId)) throw conflict("Version already exists.");
      e.versions.set(nextId, clone(args.snapshot));
      e.versionOrder.push(nextId);
    } else {
      if (!args.targetVersionId || !e.versions.has(args.targetVersionId)) throw notFound("Version not found.");
      nextId = args.targetVersionId;
    }
    const known = new Set(e.provenance.map((p) => p.id));
    e.provenance.push(...clone(args.newProvenance).filter((p) => !known.has(p.id)));
    e.history.push(clone(args.historyEntry));
    e.dataset = { ...e.dataset, currentVersionId: nextId };
    return clone(e.dataset);
  }
  async acknowledgeCoverage(owner: Owner, datasetId: string, expectedVersionId: string, at: string) {
    const e = this.entry(owner, datasetId);
    if (!e) throw notFound("Dataset not found.");
    if (e.dataset.currentVersionId !== expectedVersionId) throw versionConflict(e.dataset.currentVersionId);
    e.dataset = { ...e.dataset, coverageAcknowledgedAt: at };
    return clone(e.dataset);
  }
  async deleteBySource(owner: Owner, sourceId: string) {
    let n = 0;
    for (const [id, e] of this.s.datasets) {
      if (e.ownerId === owner.ownerId && e.dataset.sourceId === sourceId) {
        deleteDatasetEntry(this.s, id);
        n += 1;
      }
    }
    return n;
  }
}

function leaseFree(r: JobRecord, now: number) {
  return r.leaseExpiresAt === null || Date.parse(r.leaseExpiresAt) < now;
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
    const sel = this.s.selections.get(job.sourceSelectionId);
    if (!sel || sel.ownerId !== owner.ownerId) throw notFound("Selection not found.");
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
    if (TERMINAL_JOB_STATUSES.includes(r.job.status)) {
      r.leaseOwner = null;
      r.leaseExpiresAt = null;
    }
    return clone(r.job);
  }
  async requestCancel(owner: Owner, id: string) {
    const r = this.s.jobs.get(id);
    if (!r || r.owner.ownerId !== owner.ownerId) return null;
    if (r.job.status === "queued") {
      r.job = { ...r.job, status: "cancelled", stage: "finished", cancellationRequested: true, finishedAt: new Date().toISOString() };
      r.leaseOwner = null;
      r.leaseExpiresAt = null;
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
          (r.job.status === "queued" && leaseFree(r, now)) ||
          (r.job.status === "running" && r.leaseExpiresAt !== null && Date.parse(r.leaseExpiresAt) < now),
      )
      .sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt) || a.job.id.localeCompare(b.job.id));
    const r = candidates[0];
    if (!r) return null;
    r.leaseOwner = workerId;
    r.leaseExpiresAt = new Date(now + leaseMs).toISOString();
    return clone(r);
  }
  async heartbeat(id: string, workerId: string, leaseMs: number) {
    const r = this.s.jobs.get(id);
    if (!r || r.leaseOwner !== workerId || TERMINAL_JOB_STATUSES.includes(r.job.status)) return false;
    r.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    return true;
  }
}

export class MemoryShareRepository implements ShareRepository {
  constructor(private s = memoryState()) {}
  async create(owner: Owner, share: Share, tokenHash: string) {
    const d = this.s.datasets.get(share.datasetId);
    if (!d || d.ownerId !== owner.ownerId || !d.versions.has(share.versionId)) throw notFound("Dataset version not found.");
    if (this.s.shares.has(share.id) || [...this.s.shares.values()].some((e) => e.tokenHash === tokenHash)) {
      throw conflict("Share already exists.");
    }
    this.s.shares.set(share.id, { owner: clone(owner), share: clone(share), tokenHash });
  }
  async revoke(owner: Owner, shareId: string, at: string) {
    const e = this.s.shares.get(shareId);
    if (!e || e.owner.ownerId !== owner.ownerId) return false;
    e.share = { ...e.share, revokedAt: e.share.revokedAt ?? at };
    return true;
  }
  async resolve(tokenHash: string, now: string) {
    const t = Date.parse(now);
    for (const e of this.s.shares.values()) {
      if (e.tokenHash === tokenHash && e.share.revokedAt === null && Date.parse(e.share.expiresAt) > t) {
        return { share: clone(e.share), owner: clone(e.owner) };
      }
    }
    return null;
  }
  async listByDataset(owner: Owner, datasetId: string) {
    return [...this.s.shares.values()]
      .filter((e) => e.owner.ownerId === owner.ownerId && e.share.datasetId === datasetId)
      .map((e) => clone(e.share))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
}

export function claimGuestWorkspaceMemory(s: MemoryState, guest: Owner, account: Owner): ClaimResult {
  const prior = s.claims.get(guest.ownerId);
  if (prior && prior !== account.ownerId) {
    throw new AppError("forbidden", "This guest workspace was already claimed by another account.");
  }
  s.claims.set(guest.ownerId, account.ownerId);
  const result: ClaimResult = { sources: 0, datasets: 0, jobs: 0, shares: 0 };
  for (const e of [...s.sources.values(), ...s.selections.values()]) {
    if (e.ownerId !== guest.ownerId) continue;
    e.ownerId = account.ownerId;
    if ("blobKey" in e.value) result.sources += 1;
  }
  for (const e of s.datasets.values()) {
    if (e.ownerId !== guest.ownerId) continue;
    e.ownerId = account.ownerId;
    result.datasets += 1;
  }
  for (const r of s.jobs.values()) {
    if (r.owner.ownerId !== guest.ownerId) continue;
    r.owner = clone(account);
    result.jobs += 1;
  }
  for (const [k, jobId] of [...s.jobKeys]) {
    if (!k.startsWith(`${guest.ownerId}:`)) continue;
    s.jobKeys.delete(k);
    s.jobKeys.set(`${account.ownerId}:${k.slice(guest.ownerId.length + 1)}`, jobId);
  }
  for (const e of s.shares.values()) {
    if (e.owner.ownerId !== guest.ownerId) continue;
    e.owner = clone(account);
    result.shares += 1;
  }
  return result;
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
