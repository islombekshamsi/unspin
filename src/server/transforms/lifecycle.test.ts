import { describe, expect, it } from "vitest";
import { AppError, type Dataset, type Owner, type TransformOperation } from "@/contracts";
import { applyTransform, getHistory, getRows, previewTransform, restoreVersion } from "@/server/orchestration/datasets";
import { getRepositories, newBlobKey } from "@/server/storage";
import { buildCsvSelection, buildCsvSource } from "../../../tests/helpers/fixtures";
import { column, snapshot } from "./test-helpers";

/** Runs the cleaning functions through the real orchestration and in-memory repository. */
const owner: Owner = { ownerId: "owner_lifecycle", kind: "guest", actor: { kind: "guest", label: "Guest session" } };

async function seed(id: string) {
  const snap = snapshot([column("v"), column("n")], [["1,200.50", "NA"], ["oops", "x"], ["3", "x"]], `ver_${id}`);
  snap.version.datasetId = id;
  const repos = getRepositories();
  const bytes = new TextEncoder().encode("v,n\n");
  const source = buildCsvSource(bytes);
  const blobKey = newBlobKey(owner.ownerId, source.id);
  await repos.blobs.put(blobKey, bytes);
  await repos.sources.create(owner, { source, blobKey });
  const selection = buildCsvSelection(source.id);
  await repos.selections.create(owner, selection);
  const dataset: Dataset = {
    id,
    sourceId: source.id,
    sourceSelectionId: selection.id,
    title: "Lifecycle",
    description: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    currentVersionId: snap.version.id,
    initialVersionId: snap.version.id,
    extractionMethod: "deterministic_parser",
    coverage: "complete_selection",
    coverageNote: null,
    coverageAcknowledgedAt: null,
    extraction: null,
    importIssues: [],
  };
  await getRepositories().datasets.create(owner, {
    dataset,
    initialSnapshot: snap,
    provenance: [],
    historyEntry: {
      id: `op_init_${id}`,
      datasetId: id,
      kind: "initial",
      baseVersionId: null,
      resultVersionId: snap.version.id,
      operation: null,
      restoredVersionId: null,
      actor: owner.actor,
      createdAt: dataset.createdAt,
      affectedCount: 0,
      rowCountBefore: null,
      rowCountAfter: snap.rows.length,
      changedCellIds: [],
      removedRowIds: [],
      summary: "Imported",
    },
  });
  return snap;
}

const parse: TransformOperation = {
  type: "parse_numeric",
  columnId: "v",
  locale: { decimalSeparator: ".", groupingSeparator: "," },
  groupingPolicy: "allow",
  percentPolicy: "reject",
  currencyPolicy: { mode: "reject" },
  parenthesesNegative: false,
  onFailure: "keep_and_flag",
};

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof AppError ? e.code : "unexpected";
  }
}

describe("preview -> apply -> undo through orchestration", () => {
  it("applies exactly what was previewed and keeps raw text", async () => {
    const base = await seed("ds_life1");
    const preview = await previewTransform(owner, "ds_life1", { expectedVersionId: base.version.id, operation: parse });
    const detail = await applyTransform(owner, "ds_life1", { expectedVersionId: base.version.id, operation: parse, operationHash: preview.operationHash });
    const page = await getRows(owner, "ds_life1", { versionId: detail.version.id });
    const byCell = new Map(page.rows.flatMap((r) => Object.values(r.cells)).map((c) => [c.id, c]));
    for (const ch of preview.changes) {
      const cell = byCell.get(ch.cellId)!;
      expect({ rawText: cell.rawText, currentValue: cell.currentValue, valueType: cell.valueType, missingReason: cell.missingReason }).toEqual(ch.after);
    }
    expect(byCell.get("c0_v")).toMatchObject({ rawText: "1,200.50", currentValue: "1200.50" });
    expect(byCell.get("c1_v")).toMatchObject({ currentValue: "oops" });
    expect(byCell.get("c1_v")!.notes.join(" ")).toMatch(/Parse as number/);
    expect(preview.failedCellIds).toEqual(["c1_v"]);
  });

  it("rejects a changed operation and a stale base version", async () => {
    const base = await seed("ds_life2");
    const preview = await previewTransform(owner, "ds_life2", { expectedVersionId: base.version.id, operation: parse });
    const altered = { ...parse, groupingPolicy: "forbid" } as TransformOperation;
    expect(await codeOf(applyTransform(owner, "ds_life2", { expectedVersionId: base.version.id, operation: altered, operationHash: preview.operationHash }))).toBe("preview_required");

    await applyTransform(owner, "ds_life2", { expectedVersionId: base.version.id, operation: parse, operationHash: preview.operationHash });
    const mark: TransformOperation = { type: "mark_missing", columnId: "n", explicitTokens: ["NA"], rowIds: null, missingReason: "not_reported" };
    expect(await codeOf(previewTransform(owner, "ds_life2", { expectedVersionId: base.version.id, operation: mark }))).toBe("version_conflict");
    expect(await codeOf(applyTransform(owner, "ds_life2", { expectedVersionId: base.version.id, operation: parse, operationHash: preview.operationHash }))).toBe("version_conflict");
  });

  it("undo makes the exact stored base version current again", async () => {
    const base = await seed("ds_life3");
    const preview = await previewTransform(owner, "ds_life3", { expectedVersionId: base.version.id, operation: { type: "remove_selected_rows", rowIds: ["r1"] } });
    const after = await applyTransform(owner, "ds_life3", { expectedVersionId: base.version.id, operation: preview.operation, operationHash: preview.operationHash });
    expect(after.version.rowCount).toBe(2);

    const history = await getHistory(owner, "ds_life3");
    const current = history.entries.find((e) => e.resultVersionId === history.currentVersionId)!;
    expect(current.baseVersionId).toBe(base.version.id);
    const restored = await restoreVersion(owner, "ds_life3", { expectedVersionId: history.currentVersionId, targetVersionId: current.baseVersionId! });
    expect(restored.dataset.currentVersionId).toBe(base.version.id);
    const rows = await getRows(owner, "ds_life3", { versionId: restored.dataset.currentVersionId });
    expect(rows.rows).toEqual(base.rows);
    expect((await getHistory(owner, "ds_life3")).entries.at(-1)!.kind).toBe("restore");
  });

  it("refuses to commit an operation that changes nothing", async () => {
    const base = await seed("ds_life4");
    const op: TransformOperation = { type: "mark_missing", columnId: "n", explicitTokens: ["absent-token"], rowIds: null, missingReason: "not_reported" };
    const preview = await previewTransform(owner, "ds_life4", { expectedVersionId: base.version.id, operation: op });
    expect(preview.affectedCount).toBe(0);
    expect(await codeOf(applyTransform(owner, "ds_life4", { expectedVersionId: base.version.id, operation: op, operationHash: preview.operationHash }))).toBe("unsupported_operation");
  });
});
