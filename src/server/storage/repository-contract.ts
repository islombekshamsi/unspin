import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AppError,
  newId,
  type DatasetRepository,
  type JobRepository,
  type Owner,
  type SelectionRepository,
  type Share,
  type ShareRepository,
  type SourceRepository,
} from "@/contracts";
import type { ClaimResult } from "./shared";
import * as fx from "./test-fixtures";

/**
 * One behavioral contract for every repository implementation. memory.test.ts and
 * postgres.test.ts run this same suite, so both backends must agree on ownership,
 * compare-and-set, idempotency, lease, share, deletion, and claim semantics.
 */

export interface RepoSet {
  sources: SourceRepository;
  selections: SelectionRepository;
  datasets: DatasetRepository;
  jobs: JobRepository;
  shares: ShareRepository;
  claim(guest: Owner, account: Owner): Promise<ClaimResult>;
}

export interface RepoContext {
  repos: RepoSet;
  cleanup(): Promise<void>;
}

async function rejectsWith(p: Promise<unknown>, code: AppError["code"]): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(code);
    return e as AppError;
  }
  throw new Error(`expected rejection with ${code}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function runRepositoryContract(name: string, makeContext: () => Promise<RepoContext>) {
  describe(`${name} repositories`, () => {
    let ctx: RepoContext;
    let r: RepoSet;
    beforeEach(async () => {
      ctx = await makeContext();
      r = ctx.repos;
    });
    afterEach(async () => {
      await ctx.cleanup();
    });

    async function seed(owner: Owner, opts: Parameters<typeof fx.datasetFor>[2] = {}) {
      const src = fx.source();
      const blobKey = `sources/${owner.ownerId}/${src.id}`;
      await r.sources.create(owner, { source: src, blobKey });
      const sel = fx.selection(src.id);
      await r.selections.create(owner, sel);
      const d = fx.datasetFor(owner, sel, opts);
      await r.datasets.create(owner, {
        dataset: d.dataset,
        initialSnapshot: d.snapshot,
        provenance: d.provenance,
        historyEntry: d.history,
      });
      return { src, blobKey, sel, ...d };
    }

    async function commitChild(owner: Owner, s: Awaited<ReturnType<typeof seed>>, expected = s.snapshot.version.id) {
      const child = fx.childSnapshot(s.snapshot);
      const ds = await r.datasets.commitVersion(owner, {
        datasetId: s.dataset.id,
        expectedVersionId: expected,
        snapshot: child,
        targetVersionId: null,
        newProvenance: [],
        historyEntry: fx.historyEntry(owner, s.dataset.id, "transform", expected, child.version.id, child.rows.length),
      });
      return { child, ds };
    }

    function share(datasetId: string, versionId: string, overrides: Partial<Share> = {}): Share {
      return {
        id: newId("shr"),
        datasetId,
        versionId,
        createdAt: fx.ts(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        revokedAt: null,
        includeSource: false,
        ...overrides,
      };
    }

    // -----------------------------------------------------------------------
    describe("ownership isolation", () => {
      it("hides sources and refuses deletion by another owner", async () => {
        const a = fx.guest();
        const b = fx.guest();
        const s = await seed(a);
        expect(await r.sources.get(b, s.src.id)).toBeNull();
        expect(await r.sources.list(b)).toEqual([]);
        expect(await r.sources.delete(b, s.src.id)).toBe(false);
        expect((await r.sources.get(a, s.src.id))?.blobKey).toBe(s.blobKey);
        expect((await r.sources.list(a)).map((x) => x.id)).toEqual([s.src.id]);
      });

      it("hides selections and refuses selections on another owner's source", async () => {
        const a = fx.guest();
        const b = fx.guest();
        const s = await seed(a);
        expect(await r.selections.get(b, s.sel.id)).toBeNull();
        expect(await r.selections.listBySource(b, s.src.id)).toEqual([]);
        await rejectsWith(r.selections.create(b, fx.selection(s.src.id)), "not_found");
        expect(await r.selections.listBySource(a, s.src.id)).toHaveLength(1);
      });

      it("hides every dataset read and refuses every dataset write by another owner", async () => {
        const a = fx.guest();
        const b = fx.guest();
        const s = await seed(a);
        const v = s.snapshot.version.id;
        expect(await r.datasets.get(b, s.dataset.id)).toBeNull();
        expect(await r.datasets.listBySource(b, s.src.id)).toEqual([]);
        expect(await r.datasets.findBySelection(b, s.sel.id)).toBeNull();
        expect(await r.datasets.getVersion(b, s.dataset.id, v)).toBeNull();
        expect(await r.datasets.listVersions(b, s.dataset.id)).toEqual([]);
        expect(await r.datasets.getProvenance(b, s.dataset.id)).toEqual([]);
        expect(await r.datasets.listHistory(b, s.dataset.id)).toEqual([]);
        const child = fx.childSnapshot(s.snapshot);
        await rejectsWith(
          r.datasets.commitVersion(b, {
            datasetId: s.dataset.id,
            expectedVersionId: v,
            snapshot: child,
            targetVersionId: null,
            newProvenance: [],
            historyEntry: fx.historyEntry(b, s.dataset.id, "transform", v, child.version.id, 3),
          }),
          "not_found",
        );
        await rejectsWith(r.datasets.acknowledgeCoverage(b, s.dataset.id, v, fx.ts()), "not_found");
        expect(await r.datasets.deleteBySource(b, s.src.id)).toBe(0);
        const other = fx.datasetFor(b, s.sel);
        await rejectsWith(
          r.datasets.create(b, { dataset: other.dataset, initialSnapshot: other.snapshot, provenance: [], historyEntry: other.history }),
          "not_found",
        );
        expect((await r.datasets.get(a, s.dataset.id))?.currentVersionId).toBe(v);
        expect(await r.datasets.listVersions(a, s.dataset.id)).toHaveLength(1);
      });

      it("hides jobs, refuses cancel, and refuses jobs on another owner's selection", async () => {
        const a = fx.guest();
        const b = fx.guest();
        const s = await seed(a);
        const { job } = await r.jobs.createOrGet(a, fx.job(s.sel.id), "k1");
        expect(await r.jobs.get(b, job.id)).toBeNull();
        expect(await r.jobs.requestCancel(b, job.id)).toBeNull();
        expect((await r.jobs.get(a, job.id))?.status).toBe("queued");
        await rejectsWith(r.jobs.createOrGet(b, fx.job(s.sel.id), "k1"), "not_found");
        expect((await r.jobs.getRecord(job.id))?.owner.ownerId).toBe(a.ownerId);
      });

      it("refuses shares on another owner's dataset and hides/refuses revoke", async () => {
        const a = fx.guest();
        const b = fx.guest();
        const s = await seed(a);
        await rejectsWith(r.shares.create(b, share(s.dataset.id, s.snapshot.version.id), "b".repeat(64)), "not_found");
        const sh = share(s.dataset.id, s.snapshot.version.id);
        await r.shares.create(a, sh, "c".repeat(64));
        expect(await r.shares.listByDataset(b, s.dataset.id)).toEqual([]);
        expect(await r.shares.revoke(b, sh.id, fx.ts())).toBe(false);
        expect((await r.shares.resolve("c".repeat(64), new Date().toISOString()))?.share.id).toBe(sh.id);
      });
    });

    // -----------------------------------------------------------------------
    describe("datasets and immutable versions", () => {
      it("round-trips a snapshot exactly, including more rows than one storage chunk", async () => {
        const a = fx.guest();
        const s = await seed(a, { rowCount: 1201 });
        const got = await r.datasets.getVersion(a, s.dataset.id, s.snapshot.version.id);
        expect(got).toEqual(s.snapshot);
        expect(got!.rows.map((x) => x.sourceOrder)).toEqual(s.snapshot.rows.map((x) => x.sourceOrder));
        expect(await r.datasets.get(a, s.dataset.id)).toEqual(s.dataset);
        expect(await r.datasets.getProvenance(a, s.dataset.id)).toEqual(s.provenance);
      });

      it("allows only one dataset per selection", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const again = fx.datasetFor(a, s.sel);
        const err = await rejectsWith(
          r.datasets.create(a, { dataset: again.dataset, initialSnapshot: again.snapshot, provenance: [], historyEntry: again.history }),
          "idempotency_conflict",
        );
        expect(err.details?.datasetId).toBe(s.dataset.id);
        expect(await r.datasets.listBySource(a, s.src.id)).toHaveLength(1);
      });

      it("commits a new version and appends history and provenance", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const { child, ds } = await commitChild(a, s);
        expect(ds.currentVersionId).toBe(child.version.id);
        expect((await r.datasets.listVersions(a, s.dataset.id)).map((v) => v.id)).toEqual([s.snapshot.version.id, child.version.id]);
        expect((await r.datasets.listHistory(a, s.dataset.id)).map((h) => h.kind)).toEqual(["initial", "transform"]);
        expect(await r.datasets.getVersion(a, s.dataset.id, s.snapshot.version.id)).toEqual(s.snapshot);
      });

      it("rejects a stale expectedVersionId with version_conflict and the current id", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const { child } = await commitChild(a, s);
        const err = await rejectsWith(commitChild(a, s, s.snapshot.version.id), "version_conflict");
        expect(err.details?.currentVersionId).toBe(child.version.id);
        expect(await r.datasets.listVersions(a, s.dataset.id)).toHaveLength(2);
        expect(await r.datasets.listHistory(a, s.dataset.id)).toHaveLength(2);
      });

      it("lets exactly one of several concurrent commits on the same base win", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const results = await Promise.allSettled(Array.from({ length: 5 }, () => commitChild(a, s)));
        const ok = results.filter((x) => x.status === "fulfilled");
        const failed = results.filter((x): x is PromiseRejectedResult => x.status === "rejected");
        expect(ok).toHaveLength(1);
        expect(failed).toHaveLength(4);
        for (const f of failed) expect((f.reason as AppError).code).toBe("version_conflict");
        expect(await r.datasets.listVersions(a, s.dataset.id)).toHaveLength(2);
        expect(await r.datasets.listHistory(a, s.dataset.id)).toHaveLength(2);
      });

      it("restores a stored version without creating a new version and records the restore", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const { child } = await commitChild(a, s);
        const restored = await r.datasets.commitVersion(a, {
          datasetId: s.dataset.id,
          expectedVersionId: child.version.id,
          snapshot: null,
          targetVersionId: s.snapshot.version.id,
          newProvenance: [],
          historyEntry: fx.historyEntry(a, s.dataset.id, "restore", child.version.id, s.snapshot.version.id, 3),
        });
        expect(restored.currentVersionId).toBe(s.snapshot.version.id);
        expect(await r.datasets.listVersions(a, s.dataset.id)).toHaveLength(2);
        expect((await r.datasets.listHistory(a, s.dataset.id)).map((h) => h.kind)).toEqual(["initial", "transform", "restore"]);
        expect(await r.datasets.getVersion(a, s.dataset.id, restored.currentVersionId)).toEqual(s.snapshot);
      });

      it("refuses restoring a version that is missing or belongs to another dataset", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const t = await seed(a);
        for (const target of ["ver_missing", t.snapshot.version.id]) {
          await rejectsWith(
            r.datasets.commitVersion(a, {
              datasetId: s.dataset.id,
              expectedVersionId: s.snapshot.version.id,
              snapshot: null,
              targetVersionId: target,
              newProvenance: [],
              historyEntry: fx.historyEntry(a, s.dataset.id, "restore", s.snapshot.version.id, target, 3),
            }),
            "not_found",
          );
        }
        expect((await r.datasets.get(a, s.dataset.id))?.currentVersionId).toBe(s.snapshot.version.id);
        expect(await r.datasets.listHistory(a, s.dataset.id)).toHaveLength(1);
      });

      it("acknowledges coverage only against the current version", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const at = fx.ts();
        await commitChild(a, s);
        await rejectsWith(r.datasets.acknowledgeCoverage(a, s.dataset.id, s.snapshot.version.id, at), "version_conflict");
        const current = (await r.datasets.get(a, s.dataset.id))!.currentVersionId;
        const ds = await r.datasets.acknowledgeCoverage(a, s.dataset.id, current, at);
        expect(ds.coverageAcknowledgedAt).toBe(at);
        expect((await r.datasets.get(a, s.dataset.id))?.coverageAcknowledgedAt).toBe(at);
      });
    });

    // -----------------------------------------------------------------------
    describe("jobs", () => {
      it("createOrGet is idempotent per owner and key, including under concurrency", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const results = await Promise.all(Array.from({ length: 5 }, () => r.jobs.createOrGet(a, fx.job(s.sel.id), "same")));
        expect(results.filter((x) => x.created)).toHaveLength(1);
        expect(new Set(results.map((x) => x.job.id)).size).toBe(1);
        const other = await r.jobs.createOrGet(a, fx.job(s.sel.id), "different");
        expect(other.created).toBe(true);
      });

      it("transition applies only from an expected status", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const { job } = await r.jobs.createOrGet(a, fx.job(s.sel.id), "k");
        expect(await r.jobs.transition(job.id, ["running"], { status: "completed" })).toBeNull();
        const running = await r.jobs.transition(job.id, ["queued"], { status: "running", stage: "preparing_input", attemptCount: 1 });
        expect(running).toMatchObject({ status: "running", stage: "preparing_input", attemptCount: 1 });
        const done = await r.jobs.transition(job.id, ["running"], { status: "completed", stage: "finished", resultDatasetId: s.dataset.id });
        expect(done?.status).toBe("completed");
        expect(await r.jobs.transition(job.id, ["queued", "running"], { status: "failed" })).toBeNull();
        expect((await r.jobs.get(a, job.id))?.status).toBe("completed");
        expect(await r.jobs.transition("job_missing", ["queued"], { status: "running" })).toBeNull();
      });

      it("cancels queued jobs immediately and flags running ones", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const q = (await r.jobs.createOrGet(a, fx.job(s.sel.id), "q")).job;
        const run = (await r.jobs.createOrGet(a, fx.job(s.sel.id), "r")).job;
        await r.jobs.transition(run.id, ["queued"], { status: "running" });
        expect(await r.jobs.requestCancel(a, q.id)).toMatchObject({ status: "cancelled", stage: "finished", cancellationRequested: true });
        expect(await r.jobs.requestCancel(a, run.id)).toMatchObject({ status: "running", cancellationRequested: true });
        expect(await r.jobs.claimNext("w", 10_000)).toBeNull();
      });

      it("two concurrent workers never claim the same job", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const { job } = await r.jobs.createOrGet(a, fx.job(s.sel.id), "one");
        const [x, y] = await Promise.all([r.jobs.claimNext("w1", 10_000), r.jobs.claimNext("w2", 10_000)]);
        const claimed = [x, y].filter((c) => c !== null);
        expect(claimed).toHaveLength(1);
        expect(claimed[0]!.job.id).toBe(job.id);
        expect(claimed[0]!.owner.ownerId).toBe(a.ownerId);
        expect(await r.jobs.claimNext("w3", 10_000)).toBeNull();
      });

      it("two workers claim two different jobs, oldest first", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const j1 = (await r.jobs.createOrGet(a, fx.job(s.sel.id), "a")).job;
        const j2 = (await r.jobs.createOrGet(a, fx.job(s.sel.id), "b")).job;
        const first = await r.jobs.claimNext("w1", 10_000);
        const second = await r.jobs.claimNext("w2", 10_000);
        expect(first?.job.id).toBe(j1.id);
        expect(second?.job.id).toBe(j2.id);
        expect(first?.leaseOwner).toBe("w1");
        expect(Date.parse(first!.leaseExpiresAt!)).toBeGreaterThan(Date.now());
      });

      it("reclaims a job after its lease expires; heartbeat extends only the holder's lease", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const { job } = await r.jobs.createOrGet(a, fx.job(s.sel.id), "lease");
        await r.jobs.claimNext("w1", 60);
        await r.jobs.transition(job.id, ["queued"], { status: "running", attemptCount: 1 });
        expect(await r.jobs.heartbeat(job.id, "w2", 60)).toBe(false);
        expect(await r.jobs.heartbeat(job.id, "w1", 60)).toBe(true);
        expect(await r.jobs.claimNext("w2", 10_000)).toBeNull();
        await sleep(150);
        const stolen = await r.jobs.claimNext("w2", 10_000);
        expect(stolen?.job.id).toBe(job.id);
        expect(stolen?.job.attemptCount).toBe(1);
        expect(stolen?.leaseOwner).toBe("w2");
        expect(await r.jobs.heartbeat(job.id, "w1", 60)).toBe(false);
        await r.jobs.transition(job.id, ["running"], { status: "completed", stage: "finished" });
        expect(await r.jobs.heartbeat(job.id, "w2", 60)).toBe(false);
        expect((await r.jobs.getRecord(job.id))?.leaseOwner).toBeNull();
      });
    });

    // -----------------------------------------------------------------------
    describe("shares", () => {
      it("resolves only unrevoked, unexpired shares by token hash", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const v = s.snapshot.version.id;
        const live = share(s.dataset.id, v);
        const expired = share(s.dataset.id, v, { expiresAt: new Date(Date.now() - 1000).toISOString() });
        await r.shares.create(a, live, "1".repeat(64));
        await r.shares.create(a, expired, "2".repeat(64));
        await rejectsWith(r.shares.create(a, share(s.dataset.id, "ver_missing"), "3".repeat(64)), "not_found");
        const now = new Date().toISOString();
        const got = await r.shares.resolve("1".repeat(64), now);
        expect(got?.share).toEqual(live);
        expect(got?.owner.ownerId).toBe(a.ownerId);
        expect(await r.shares.resolve("2".repeat(64), now)).toBeNull();
        expect(await r.shares.resolve("f".repeat(64), now)).toBeNull();
        const at = fx.ts();
        expect(await r.shares.revoke(a, live.id, at)).toBe(true);
        expect(await r.shares.revoke(a, live.id, fx.ts())).toBe(true);
        expect(await r.shares.resolve("1".repeat(64), now)).toBeNull();
        const listed = await r.shares.listByDataset(a, s.dataset.id);
        expect(listed.map((x) => x.id)).toEqual([live.id, expired.id]);
        expect(listed[0].revokedAt).toBe(at);
      });
    });

    // -----------------------------------------------------------------------
    describe("deletion", () => {
      it("deleting a source removes its selections, datasets, versions, history, jobs, and shares", async () => {
        const a = fx.guest();
        const s = await seed(a);
        const keep = await seed(a);
        await commitChild(a, s);
        const { job } = await r.jobs.createOrGet(a, fx.job(s.sel.id), "del");
        await r.shares.create(a, share(s.dataset.id, s.snapshot.version.id), "4".repeat(64));
        expect(await r.datasets.deleteBySource(a, s.src.id)).toBe(1);
        expect(await r.sources.delete(a, s.src.id)).toBe(true);
        expect(await r.sources.get(a, s.src.id)).toBeNull();
        expect(await r.selections.get(a, s.sel.id)).toBeNull();
        expect(await r.datasets.get(a, s.dataset.id)).toBeNull();
        expect(await r.datasets.getVersion(a, s.dataset.id, s.snapshot.version.id)).toBeNull();
        expect(await r.datasets.listHistory(a, s.dataset.id)).toEqual([]);
        expect(await r.datasets.getProvenance(a, s.dataset.id)).toEqual([]);
        expect(await r.jobs.getRecord(job.id)).toBeNull();
        expect(await r.shares.resolve("4".repeat(64), new Date().toISOString())).toBeNull();
        expect(await r.sources.delete(a, s.src.id)).toBe(false);
        expect(await r.datasets.get(a, keep.dataset.id)).not.toBeNull();
      });

      it("source deletion alone cascades to derivatives", async () => {
        const a = fx.guest();
        const s = await seed(a);
        expect(await r.sources.delete(a, s.src.id)).toBe(true);
        expect(await r.datasets.get(a, s.dataset.id)).toBeNull();
        expect(await r.datasets.listBySource(a, s.src.id)).toEqual([]);
      });
    });

    // -----------------------------------------------------------------------
    describe("guest workspace claim", () => {
      it("moves a guest's resources to an account, idempotently, and only once", async () => {
        const g = fx.guest();
        const acct = fx.account();
        const s = await seed(g);
        const { job } = await r.jobs.createOrGet(g, fx.job(s.sel.id), "claim");
        await r.shares.create(g, share(s.dataset.id, s.snapshot.version.id), "5".repeat(64));
        const moved = await r.claim(g, acct);
        expect(moved).toEqual({ sources: 1, datasets: 1, jobs: 1, shares: 1 });
        expect(await r.sources.get(g, s.src.id)).toBeNull();
        expect(await r.sources.get(acct, s.src.id)).not.toBeNull();
        expect(await r.datasets.getVersion(acct, s.dataset.id, s.snapshot.version.id)).toEqual(s.snapshot);
        expect(await r.datasets.listHistory(acct, s.dataset.id)).toHaveLength(1);
        expect((await r.jobs.getRecord(job.id))?.owner.ownerId).toBe(acct.ownerId);
        expect((await r.jobs.createOrGet(acct, fx.job(s.sel.id), "claim")).created).toBe(false);
        expect((await r.shares.resolve("5".repeat(64), new Date().toISOString()))?.owner.ownerId).toBe(acct.ownerId);
        expect(await r.claim(g, acct)).toEqual({ sources: 0, datasets: 0, jobs: 0, shares: 0 });
        await rejectsWith(r.claim(g, fx.account()), "forbidden");
      });
    });
  });
}
