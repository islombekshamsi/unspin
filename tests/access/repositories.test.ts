import { beforeEach, describe, expect, it } from "vitest";
import { AppError, newId, type Job } from "@/contracts";
import { getRepositories, newBlobKey } from "@/server/storage";
import { commitManualEdit, seedDataset, type SeededDataset } from "../helpers/fixtures";
import { NOAA_SAMPLE, noaaTable } from "../helpers/noaa";
import { makeOwner } from "../helpers/owners";

/**
 * Cross-owner isolation at the repository boundary. Runs against whatever
 * getRepositories() returns (process memory today; PostgreSQL once infrastructure
 * lands), so the same expectations hold for the durable implementation.
 */

const repos = () => getRepositories();
let A = makeOwner("a");
let B = makeOwner("b");
let seeded: SeededDataset;

beforeEach(async () => {
  A = makeOwner("a");
  B = makeOwner("b");
  seeded = await seedDataset(A, noaaTable(NOAA_SAMPLE));
});

function queuedJob(selectionId: string): Job {
  return {
    id: newId("job"),
    sourceSelectionId: selectionId,
    operationType: "structured_parse",
    status: "queued",
    stage: "queued",
    cancellationRequested: false,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    attemptCount: 0,
    measuredProgress: null,
    error: null,
    resultDatasetId: null,
  };
}

describe("sources", () => {
  it("owner sees own source; other owner gets null and an empty list", async () => {
    expect((await repos().sources.get(A, seeded.source.id))?.source.id).toBe(seeded.source.id);
    expect(await repos().sources.get(B, seeded.source.id)).toBeNull();
    expect((await repos().sources.list(B)).map((s) => s.id)).not.toContain(seeded.source.id);
    expect((await repos().sources.list(A)).map((s) => s.id)).toContain(seeded.source.id);
  });

  it("other owner cannot delete; the source survives", async () => {
    expect(await repos().sources.delete(B, seeded.source.id)).toBe(false);
    expect(await repos().sources.get(A, seeded.source.id)).not.toBeNull();
  });

  it("a missing id and a foreign id are indistinguishable (no enumeration)", async () => {
    const foreign = await repos().sources.get(B, seeded.source.id);
    const missing = await repos().sources.get(B, newId("src"));
    expect(foreign).toEqual(missing);
  });

  it("blob keys are server-generated from owner and source ids, never the filename", () => {
    const key = newBlobKey(A.ownerId, seeded.source.id);
    expect(key).not.toContain(seeded.source.filename);
    expect(key).not.toContain(".csv");
    expect(key).toContain(seeded.source.id);
    expect(newBlobKey("../../etc", "src_x")).not.toContain("..");
  });
});

describe("selections", () => {
  it("other owner cannot read or list a selection", async () => {
    expect(await repos().selections.get(B, seeded.selection.id)).toBeNull();
    expect(await repos().selections.listBySource(B, seeded.source.id)).toEqual([]);
    expect((await repos().selections.listBySource(A, seeded.source.id)).map((s) => s.id)).toEqual([seeded.selection.id]);
  });
});

describe("datasets", () => {
  it("other owner gets null/empty for every read", async () => {
    const id = seeded.dataset.id;
    const v = seeded.snapshot.version.id;
    expect(await repos().datasets.get(B, id)).toBeNull();
    expect(await repos().datasets.listBySource(B, seeded.source.id)).toEqual([]);
    expect(await repos().datasets.findBySelection(B, seeded.selection.id)).toBeNull();
    expect(await repos().datasets.getVersion(B, id, v)).toBeNull();
    expect(await repos().datasets.listVersions(B, id)).toEqual([]);
    expect(await repos().datasets.getProvenance(B, id)).toEqual([]);
    expect(await repos().datasets.listHistory(B, id)).toEqual([]);
  });

  it("other owner cannot commit a version, even with the correct expectedVersionId", async () => {
    const err = await commitManualEdit(B, seeded, seeded.snapshot, 0, seeded.columns[3].id, "1").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("not_found");
    expect((await repos().datasets.get(A, seeded.dataset.id))?.currentVersionId).toBe(seeded.snapshot.version.id);
  });

  it("other owner cannot acknowledge coverage", async () => {
    const err = await repos()
      .datasets.acknowledgeCoverage(B, seeded.dataset.id, seeded.snapshot.version.id, new Date().toISOString())
      .catch((e) => e);
    expect((err as AppError).code).toBe("not_found");
    expect((await repos().datasets.get(A, seeded.dataset.id))?.coverageAcknowledgedAt).toBeNull();
  });

  it("other owner's deleteBySource removes nothing", async () => {
    expect(await repos().datasets.deleteBySource(B, seeded.source.id)).toBe(0);
    expect(await repos().datasets.get(A, seeded.dataset.id)).not.toBeNull();
  });

  it("returned objects are copies: mutating them does not change stored state", async () => {
    const snap = await repos().datasets.getVersion(A, seeded.dataset.id, seeded.snapshot.version.id);
    const firstCell = Object.values(snap!.rows[0].cells)[3];
    firstCell.currentValue = "0";
    firstCell.rawText = "tampered";
    const again = await repos().datasets.getVersion(A, seeded.dataset.id, seeded.snapshot.version.id);
    const cell = Object.values(again!.rows[0].cells)[3];
    expect(cell.rawText).not.toBe("tampered");
    expect(cell.currentValue).not.toBe("0");
  });
});

describe("version compare-and-set", () => {
  it("a stale expectedVersionId is a version_conflict carrying currentVersionId", async () => {
    const v2 = await commitManualEdit(A, seeded, seeded.snapshot, 0, seeded.columns[3].id, "330.00");
    const err = await commitManualEdit(A, seeded, seeded.snapshot, 1, seeded.columns[3].id, "331.00").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("version_conflict");
    expect((err as AppError).status).toBe(409);
    expect((err as AppError).details?.currentVersionId).toBe(v2.version.id);
  });

  it("restore makes an actual stored version current, without creating new content", async () => {
    const v2 = await commitManualEdit(A, seeded, seeded.snapshot, 0, seeded.columns[3].id, "330.00");
    const versionsBefore = await repos().datasets.listVersions(A, seeded.dataset.id);
    await repos().datasets.commitVersion(A, {
      datasetId: seeded.dataset.id,
      expectedVersionId: v2.version.id,
      snapshot: null,
      targetVersionId: seeded.snapshot.version.id,
      newProvenance: [],
      historyEntry: {
        id: newId("op"),
        datasetId: seeded.dataset.id,
        kind: "restore",
        baseVersionId: v2.version.id,
        resultVersionId: seeded.snapshot.version.id,
        operation: null,
        restoredVersionId: seeded.snapshot.version.id,
        actor: A.actor,
        createdAt: new Date().toISOString(),
        affectedCount: 0,
        rowCountBefore: 6,
        rowCountAfter: 6,
        changedCellIds: [],
        removedRowIds: [],
        summary: "restore",
      },
    });
    const ds = await repos().datasets.get(A, seeded.dataset.id);
    expect(ds?.currentVersionId).toBe(seeded.snapshot.version.id);
    expect(await repos().datasets.listVersions(A, seeded.dataset.id)).toHaveLength(versionsBefore.length);
    const current = await repos().datasets.getVersion(A, seeded.dataset.id, ds!.currentVersionId);
    expect(current?.rows).toEqual(seeded.snapshot.rows);
  });

  it("restore to an unknown version is not_found and leaves current unchanged", async () => {
    const err = await repos()
      .datasets.commitVersion(A, {
        datasetId: seeded.dataset.id,
        expectedVersionId: seeded.snapshot.version.id,
        snapshot: null,
        targetVersionId: newId("ver"),
        newProvenance: [],
        historyEntry: {
          id: newId("op"),
          datasetId: seeded.dataset.id,
          kind: "restore",
          baseVersionId: seeded.snapshot.version.id,
          resultVersionId: seeded.snapshot.version.id,
          operation: null,
          restoredVersionId: null,
          actor: A.actor,
          createdAt: new Date().toISOString(),
          affectedCount: 0,
          rowCountBefore: 6,
          rowCountAfter: 6,
          changedCellIds: [],
          removedRowIds: [],
          summary: "restore",
        },
      })
      .catch((e) => e);
    expect((err as AppError).code).toBe("not_found");
    expect((await repos().datasets.get(A, seeded.dataset.id))?.currentVersionId).toBe(seeded.snapshot.version.id);
    expect(await repos().datasets.listHistory(A, seeded.dataset.id)).toHaveLength(1);
  });
});

describe("jobs", () => {
  it("idempotency keys are scoped per owner", async () => {
    const sel = seeded.selection;
    const bSeeded = await seedDataset(B, noaaTable(NOAA_SAMPLE));
    const key = "same-key:k";
    const a1 = await repos().jobs.createOrGet(A, queuedJob(sel.id), key);
    const a2 = await repos().jobs.createOrGet(A, queuedJob(sel.id), key);
    const b1 = await repos().jobs.createOrGet(B, queuedJob(bSeeded.selection.id), key);
    expect(a1.created).toBe(true);
    expect(a2.created).toBe(false);
    expect(a2.job.id).toBe(a1.job.id);
    expect(b1.created).toBe(true);
    expect(b1.job.id).not.toBe(a1.job.id);
  });

  it("a job cannot be attached to another owner's selection", async () => {
    const err = await repos().jobs.createOrGet(B, queuedJob(seeded.selection.id), newId("req")).catch((e) => e);
    expect((err as AppError).code).toBe("not_found");
  });

  it("other owner cannot read or cancel a job", async () => {
    const { job } = await repos().jobs.createOrGet(A, queuedJob(seeded.selection.id), newId("req"));
    expect(await repos().jobs.get(B, job.id)).toBeNull();
    expect(await repos().jobs.requestCancel(B, job.id)).toBeNull();
    expect((await repos().jobs.get(A, job.id))?.status).toBe("queued");
  });

  it("cancelling a queued job finishes it as cancelled; a completed job is not reopened", async () => {
    const { job } = await repos().jobs.createOrGet(A, queuedJob(seeded.selection.id), newId("req"));
    const c = await repos().jobs.requestCancel(A, job.id);
    expect(c?.status).toBe("cancelled");
    expect(c?.finishedAt).not.toBeNull();
    expect(await repos().jobs.transition(job.id, ["queued", "running"], { status: "completed" })).toBeNull();
  });
});
