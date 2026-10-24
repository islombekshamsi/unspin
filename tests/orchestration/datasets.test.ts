import { beforeEach, describe, expect, it } from "vitest";
import { AppError, newId, type TransformOperation } from "@/contracts";
import {
  acknowledgeCoverage,
  applyTransform,
  chartQuery,
  createExport,
  getDatasetDetail,
  getFindings,
  getHistory,
  getRows,
  previewTransform,
  restoreVersion,
} from "@/server/orchestration/datasets";
import { deleteSource } from "@/server/orchestration/sources";
import { operationHash } from "@/server/transforms";
import { getRepositories } from "@/server/storage";
import { commitManualEdit, seedDataset, type SeededDataset } from "../helpers/fixtures";
import { NOAA_SAMPLE, noaaTable } from "../helpers/noaa";
import { makeOwner } from "../helpers/owners";

async function code(p: Promise<unknown>): Promise<{ code: string; status: number; details?: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return { code: e.code, status: e.status, details: e.details };
    throw e;
  }
  throw new Error("expected an AppError");
}

let A = makeOwner("a");
let B = makeOwner("b");
let s: SeededDataset;
const avg = () => s.columns[3].id;
const rename = (): TransformOperation => ({ type: "rename_column", columnId: avg(), newLabel: "CO2 monthly mean (ppm)" });

beforeEach(async () => {
  A = makeOwner("a");
  B = makeOwner("b");
  s = await seedDataset(A, noaaTable(NOAA_SAMPLE));
});

describe("cross-owner access through use cases returns 404 without enumeration", () => {
  it.each([
    ["detail", () => getDatasetDetail(B, s.dataset.id)],
    ["rows", () => getRows(B, s.dataset.id, { versionId: s.snapshot.version.id })],
    ["findings", () => getFindings(B, s.dataset.id, s.snapshot.version.id)],
    ["history", () => getHistory(B, s.dataset.id)],
    ["preview", () => previewTransform(B, s.dataset.id, { expectedVersionId: s.snapshot.version.id, operation: rename() })],
    ["restore", () => restoreVersion(B, s.dataset.id, { expectedVersionId: s.snapshot.version.id, targetVersionId: s.snapshot.version.id })],
    ["ack", () => acknowledgeCoverage(B, s.dataset.id, s.snapshot.version.id)],
    ["export", () => createExport(B, s.dataset.id, { versionId: s.snapshot.version.id, formats: ["csv"], scope: { kind: "full" }, acknowledgePartial: false })],
    ["chart", () => chartQuery(B, s.dataset.id, { versionId: s.snapshot.version.id, xColumnId: s.columns[2].id, yColumnIds: [avg()] })],
    ["delete source", () => deleteSource(B, s.source.id)],
  ])("%s", async (_name, call) => {
    const foreign = await code(call());
    expect(foreign.code).toBe("not_found");
    expect(foreign.status).toBe(404);
    expect(foreign.details).toBeUndefined();
  });

  it("foreign and nonexistent dataset ids produce identical errors", async () => {
    const foreign = await code(getDatasetDetail(B, s.dataset.id));
    const missing = await code(getDatasetDetail(B, newId("ds")));
    expect(foreign).toEqual(missing);
  });

  it("a version id from another dataset is not readable through this dataset", async () => {
    const other = await seedDataset(A, noaaTable([[2021, 1]]));
    expect((await code(getRows(A, s.dataset.id, { versionId: other.snapshot.version.id }))).code).toBe("not_found");
  });
});

describe("stale writes are 409 version_conflict with the current version id", () => {
  it("preview against a stale version", async () => {
    const v2 = await commitManualEdit(A, s, s.snapshot, 0, avg(), "330.00");
    const r = await code(previewTransform(A, s.dataset.id, { expectedVersionId: s.snapshot.version.id, operation: rename() }));
    expect(r).toMatchObject({ code: "version_conflict", status: 409, details: { currentVersionId: v2.version.id } });
  });

  it("apply against a stale version (checked before the hash and before any computation)", async () => {
    const v2 = await commitManualEdit(A, s, s.snapshot, 0, avg(), "330.00");
    const op = rename();
    const r = await code(
      applyTransform(A, s.dataset.id, { expectedVersionId: s.snapshot.version.id, operation: op, operationHash: operationHash(s.snapshot.version.id, op) }),
    );
    expect(r).toMatchObject({ code: "version_conflict", details: { currentVersionId: v2.version.id } });
    expect((await getHistory(A, s.dataset.id)).entries).toHaveLength(2);
  });

  it("restore against a stale version", async () => {
    const v2 = await commitManualEdit(A, s, s.snapshot, 0, avg(), "330.00");
    const r = await code(restoreVersion(A, s.dataset.id, { expectedVersionId: s.snapshot.version.id, targetVersionId: s.snapshot.version.id }));
    expect(r).toMatchObject({ code: "version_conflict", details: { currentVersionId: v2.version.id } });
  });

  it("coverage acknowledgement against a stale version", async () => {
    const v2 = await commitManualEdit(A, s, s.snapshot, 0, avg(), "330.00");
    const r = await code(acknowledgeCoverage(A, s.dataset.id, s.snapshot.version.id));
    expect(r).toMatchObject({ code: "version_conflict", details: { currentVersionId: v2.version.id } });
  });
});

describe("apply requires the exact previewed operation", () => {
  it("a hash for a different operation is preview_required and nothing is committed", async () => {
    const reviewed = rename();
    const changed: TransformOperation = { ...reviewed, newLabel: "something else" } as TransformOperation;
    const r = await code(
      applyTransform(A, s.dataset.id, {
        expectedVersionId: s.snapshot.version.id,
        operation: changed,
        operationHash: operationHash(s.snapshot.version.id, reviewed),
      }),
    );
    expect(r.code).toBe("preview_required");
    expect((await getDatasetDetail(A, s.dataset.id)).dataset.currentVersionId).toBe(s.snapshot.version.id);
  });
});

describe("restore (undo) selects an actual stored version", () => {
  it("makes the original version current again with identical rows and records a restore entry", async () => {
    const v2 = await commitManualEdit(A, s, s.snapshot, 3, avg(), "330.80");
    const detail = await restoreVersion(A, s.dataset.id, { expectedVersionId: v2.version.id, targetVersionId: s.snapshot.version.id });
    expect(detail.dataset.currentVersionId).toBe(s.snapshot.version.id);
    expect(detail.versions.map((v) => v.id)).toEqual([s.snapshot.version.id, v2.version.id]);
    const rows = await getRows(A, s.dataset.id, { versionId: detail.dataset.currentVersionId, limit: 100 });
    expect(rows.rows).toEqual(s.snapshot.rows);
    const history = await getHistory(A, s.dataset.id);
    expect(history.entries.map((e) => e.kind)).toEqual(["initial", "transform", "restore"]);
    expect(history.entries[2]).toMatchObject({ restoredVersionId: s.snapshot.version.id, baseVersionId: v2.version.id });
  });

  it("redo is another explicit restore to the later stored version", async () => {
    const v2 = await commitManualEdit(A, s, s.snapshot, 3, avg(), "330.80");
    await restoreVersion(A, s.dataset.id, { expectedVersionId: v2.version.id, targetVersionId: s.snapshot.version.id });
    const redo = await restoreVersion(A, s.dataset.id, { expectedVersionId: s.snapshot.version.id, targetVersionId: v2.version.id });
    expect(redo.dataset.currentVersionId).toBe(v2.version.id);
    const page = await getRows(A, s.dataset.id, { versionId: v2.version.id });
    expect(page.rows[3].cells[avg()].currentValue).toBe("330.80");
    expect(page.rows[3].cells[avg()].parentCellIds).toEqual([s.snapshot.rows[3].cells[avg()].id]);
  });

  it("restoring the current version is a 400, and an unknown target is a 404", async () => {
    expect((await code(restoreVersion(A, s.dataset.id, { expectedVersionId: s.snapshot.version.id, targetVersionId: s.snapshot.version.id }))).code).toBe(
      "bad_request",
    );
    expect((await code(restoreVersion(A, s.dataset.id, { expectedVersionId: s.snapshot.version.id, targetVersionId: newId("ver") }))).code).toBe(
      "not_found",
    );
  });

  it("the original raw text survives an edit in the edited version", async () => {
    const v2 = await commitManualEdit(A, s, s.snapshot, 3, avg(), "330.80");
    const page = await getRows(A, s.dataset.id, { versionId: v2.version.id });
    expect(page.rows[3].cells[avg()].rawText).toBe(s.snapshot.rows[3].cells[avg()].rawText);
  });
});

describe("rows: sort/filter are view operations", () => {
  it("sorting does not change the stored version or row ids", async () => {
    const ndays = s.columns[5].id;
    const sorted = await getRows(A, s.dataset.id, { versionId: s.snapshot.version.id, sortColumnId: ndays, sortDirection: "asc" });
    const stored = await getRepositories().datasets.getVersion(A, s.dataset.id, s.snapshot.version.id);
    expect(stored!.rows.map((r) => r.id)).toEqual(s.snapshot.rows.map((r) => r.id));
    expect(new Set(sorted.rows.map((r) => r.id))).toEqual(new Set(s.snapshot.rows.map((r) => r.id)));
  });

  it("decimal sort is numeric and negative sentinels sort as the negative numbers they are", async () => {
    const ndays = s.columns[5].id;
    const asc = await getRows(A, s.dataset.id, { versionId: s.snapshot.version.id, sortColumnId: ndays, sortDirection: "asc" });
    const values = asc.rows.map((r) => r.cells[ndays].currentValue);
    // Real NOAA ndays for 1975-09..1976-02; 1975-12 carries the -1 'not available' sentinel.
    expect(values[0]).toBe("-1");
    const nums = values.map((v) => Number(v));
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
  });

  it("missing values sort last in both directions", async () => {
    const t = await seedDataset(A, {
      // Protocol strings (not real data): a decimal column with one blank cell.
      sourceBytes: new TextEncoder().encode("v\n2\n\n10\n"),
      columns: [{ label: "v", dataType: "decimal" }],
      rows: [["2"], [null], ["10"]],
    });
    const col = t.columns[0].id;
    for (const dir of ["asc", "desc"] as const) {
      const page = await getRows(A, t.dataset.id, { versionId: t.snapshot.version.id, sortColumnId: col, sortDirection: dir });
      expect(page.rows.at(-1)!.cells[col].currentValue).toBeNull();
    }
  });

  it("filter is a case-insensitive substring of displayed text and reports the filtered total", async () => {
    const month = s.columns[1].id;
    const page = await getRows(A, s.dataset.id, { versionId: s.snapshot.version.id, filterColumnId: month, filterText: "1" });
    expect(page.rows.map((r) => r.cells[month].currentValue)).toEqual(["10", "11", "12", "1"]);
    expect(page.totalRows).toBe(4);
  });

  it("pagination covers every row exactly once", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await getRows(A, s.dataset.id, { versionId: s.snapshot.version.id, limit: 4, cursor });
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(s.snapshot.rows.map((r) => r.id));
  });

  it("unknown sort/filter columns and invalid cursors are 400", async () => {
    expect((await code(getRows(A, s.dataset.id, { versionId: s.snapshot.version.id, sortColumnId: "col_nope" }))).code).toBe("bad_request");
    expect((await code(getRows(A, s.dataset.id, { versionId: s.snapshot.version.id, cursor: "-5" }))).code).toBe("bad_request");
    expect((await code(getRows(A, s.dataset.id, { versionId: s.snapshot.version.id, cursor: "abc" }))).code).toBe("bad_request");
  });
});

describe("exports: guards that do not depend on the export module", () => {
  it("partial coverage requires acknowledgement before export", async () => {
    const p = await seedDataset(A, { ...noaaTable(NOAA_SAMPLE), coverage: "partial_selection", coverageNote: "Fixture: only six months selected" });
    const r = await code(createExport(A, p.dataset.id, { versionId: p.snapshot.version.id, formats: ["csv"], scope: { kind: "full" }, acknowledgePartial: false }));
    expect(r.code).toBe("partial_ack_required");
    expect(r.details).toMatchObject({ coverage: "partial_selection" });
  });

  it("a view scope that names rows/columns outside the version is rejected", async () => {
    const r = await code(
      createExport(A, s.dataset.id, {
        versionId: s.snapshot.version.id,
        formats: ["csv"],
        scope: { kind: "view", rowIds: [newId("row")], columnIds: [avg()], description: "x" },
        acknowledgePartial: false,
      }),
    );
    expect(r.code).toBe("bad_request");
  });
});

describe("chart query guards", () => {
  it("unknown columns are a 400, not an empty chart", async () => {
    const r = await code(chartQuery(A, s.dataset.id, { versionId: s.snapshot.version.id, xColumnId: s.columns[2].id, yColumnIds: [newId("col")] }));
    expect(r.code).toBe("bad_request");
  });
});

describe("source deletion", () => {
  it("removes the owner's datasets, selections, and blob; another owner's data is untouched", async () => {
    const other = await seedDataset(B, noaaTable([[2021, 1]]));
    const res = await deleteSource(A, s.source.id);
    expect(res.deletedDatasets).toBe(1);
    expect(await getRepositories().sources.get(A, s.source.id)).toBeNull();
    expect(await getRepositories().selections.get(A, s.selection.id)).toBeNull();
    expect(await getRepositories().datasets.get(A, s.dataset.id)).toBeNull();
    expect(await getRepositories().datasets.get(B, other.dataset.id)).not.toBeNull();
  });
});
