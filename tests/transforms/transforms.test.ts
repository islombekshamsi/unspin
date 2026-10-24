import { describe, expect, it } from "vitest";
import { AppError, newId, type DatasetVersionSnapshot, type Owner, type Provenance, type TransformOperation } from "@/contracts";
import { applyTransform, getRows, previewTransform, restoreVersion } from "@/server/orchestration/datasets";
import { computeTransform, operationHash, type TransformContext } from "@/server/transforms";
import { buildCsvSelection, buildCsvSource, buildSnapshot, seedDataset, utf8, type TableSpec } from "../helpers/fixtures";
import { NOAA_SAMPLE, noaaTable } from "../helpers/noaa";
import { makeOwner } from "../helpers/owners";
import { PLACEHOLDER_REASON, isPlaceholder } from "../helpers/stubs";

function local(spec: Pick<TableSpec, "columns" | "rows">) {
  const src = buildCsvSource(utf8("fixture"));
  const sel = buildCsvSelection(src.id);
  const built = buildSnapshot(newId("ds"), src, sel, spec);
  const ctx: TransformContext = { operationId: newId("op"), now: new Date().toISOString(), sourceId: src.id, sourceSelectionId: sel.id };
  return { ...built, ctx };
}

const probe = local(noaaTable(NOAA_SAMPLE));
const transformsPlaceholder = await isPlaceholder(() =>
  computeTransform(probe.snapshot, probe.provenance, { type: "rename_column", columnId: probe.columns[3].id, newLabel: "x" }, probe.ctx),
);

function cellMap(s: { rows: DatasetVersionSnapshot["rows"] }) {
  const m = new Map<string, { rawText: string | null; currentValue: string | boolean | null; missingReason: string | null }>();
  for (const r of s.rows) for (const [col, c] of Object.entries(r.cells)) m.set(`${r.id}:${col}`, c);
  return m;
}

function compute(base: DatasetVersionSnapshot, prov: Provenance[], op: TransformOperation, ctx: TransformContext) {
  const before = structuredClone(base);
  const out = computeTransform(base, prov, op, ctx);
  expect(base).toEqual(before); // the base snapshot is never mutated
  return out;
}

/** Protocol strings for numeric parsing edge cases. Not real data. */
const PROTOCOL_NUMBERS = local({
  columns: [{ label: "value", dataType: "text" }],
  rows: [["1,234.5"], ["12.5%"], ["(123)"], ["123456789012345678901234567890"], [null], ["NA"], ["$83.22"], [" 7 "]],
});

const PROTOCOL_PERCENTS = local({
  columns: [{ label: "share", dataType: "text" }],
  rows: [["12.5%"], ["3%"], [null]],
});

describe.skipIf(transformsPlaceholder)(`transforms [skips while ${PLACEHOLDER_REASON("transforms.computeTransform")}]`, () => {
  it("is deterministic: preview and apply compute identical results for the same base and operation", () => {
    const { snapshot, provenance, columns, ctx } = local(noaaTable(NOAA_SAMPLE));
    const op: TransformOperation = { type: "mark_missing", columnId: columns[6].id, explicitTokens: ["-9.99"], rowIds: null, missingReason: "not_reported" };
    expect(compute(snapshot, provenance, op, ctx)).toEqual(compute(snapshot, provenance, op, ctx));
  });

  it("mark_missing turns the NOAA -9.99 sentinel into an explicit missing value, keeps rawText, touches nothing else", () => {
    const { snapshot, provenance, columns, ctx } = local(noaaTable(NOAA_SAMPLE));
    const sdev = columns[6].id;
    const out = compute(snapshot, provenance, { type: "mark_missing", columnId: sdev, explicitTokens: ["-9.99"], rowIds: null, missingReason: "not_reported" }, ctx);
    expect(out.affectedCount).toBe(1);
    const after = cellMap(out);
    const before = cellMap(snapshot);
    for (const [key, b] of before) {
      const a = after.get(key)!;
      expect(a.rawText).toBe(b.rawText);
      if (key.endsWith(sdev) && b.rawText === "-9.99") {
        expect(a.currentValue).toBeNull();
        expect(a.missingReason).toBe("not_reported");
      } else {
        expect(a.currentValue).toBe(b.currentValue);
      }
    }
    // ndays "-1" in the same row is a different column and is not touched.
    expect([...after.values()].filter((c) => c.rawText === "-1")[0].currentValue).toBe("-1");
  });

  it("parse_numeric: missing stays missing (never zero), failures keep the value and are flagged", () => {
    const { snapshot, provenance, columns, ctx } = PROTOCOL_NUMBERS;
    const col = columns[0].id;
    const out = compute(
      snapshot,
      provenance,
      { type: "parse_numeric", columnId: col, locale: { decimalSeparator: ".", groupingSeparator: null }, groupingPolicy: "forbid", percentPolicy: "reject", currencyPolicy: { mode: "reject" }, parenthesesNegative: false, onFailure: "keep_and_flag" },
      ctx,
    );
    const byRaw = new Map(out.rows.map((r) => [r.cells[col].rawText, r.cells[col]]));
    expect(byRaw.get(null)!.currentValue).toBeNull();
    expect(byRaw.get(null)!.missingReason).not.toBeNull();
    for (const raw of ["1,234.5", "12.5%", "(123)", "$83.22", "NA"]) {
      const c = byRaw.get(raw)!;
      expect(c.currentValue).toBe(raw);
      expect(out.failedCellIds).toContain(c.id);
    }
    expect(byRaw.get("123456789012345678901234567890")!.currentValue).toBe("123456789012345678901234567890");
    for (const c of byRaw.values()) expect(c.currentValue).not.toBe("0");
  });

  const explicitPolicies = (col: string, percentPolicy: "reject" | "keep_percent_number" | "to_fraction"): TransformOperation => ({
    type: "parse_numeric",
    columnId: col,
    locale: { decimalSeparator: ".", groupingSeparator: "," },
    groupingPolicy: "allow",
    percentPolicy,
    currencyPolicy: { mode: "strip_symbol", currency: "USD" },
    parenthesesNegative: true,
    onFailure: "keep_and_flag",
  });

  it("parse_numeric with explicit policies: grouping, parentheses, currency", () => {
    const { snapshot, provenance, columns, ctx } = PROTOCOL_NUMBERS;
    const col = columns[0].id;
    const out = compute(snapshot, provenance, explicitPolicies(col, "reject"), ctx);
    const byRaw = new Map(out.rows.map((r) => [r.cells[col].rawText, r.cells[col]]));
    expect(byRaw.get("1,234.5")!.currentValue).toBe("1234.5");
    expect(byRaw.get("(123)")!.currentValue).toBe("-123");
    expect(byRaw.get("$83.22")!.currentValue).toBe("83.22");
    expect(byRaw.get("NA")!.currentValue).toBe("NA");
    // percentPolicy "reject" leaves the percent value as flagged text.
    expect(byRaw.get("12.5%")!.currentValue).toBe("12.5%");
    expect(out.failedCellIds).toContain(byRaw.get("12.5%")!.id);
  });

  it("parse_numeric percent policies; a column mixing % and bare numbers is not given one meaning", () => {
    const mixed = PROTOCOL_NUMBERS;
    const mcol = mixed.columns[0].id;
    const m = compute(mixed.snapshot, mixed.provenance, explicitPolicies(mcol, "keep_percent_number"), mixed.ctx);
    const mByRaw = new Map(m.rows.map((r) => [r.cells[mcol].rawText, r.cells[mcol]]));
    expect(mByRaw.get("12.5%")!.currentValue).toBe("12.5");
    expect(mByRaw.get("1,234.5")!.currentValue).toBe("1,234.5");
    expect(m.failedCellIds).toContain(mByRaw.get("1,234.5")!.id);

    const { snapshot, provenance, columns, ctx } = PROTOCOL_PERCENTS;
    const col = columns[0].id;
    const run = (p: "keep_percent_number" | "to_fraction") =>
      new Map(compute(snapshot, provenance, explicitPolicies(col, p), ctx).rows.map((r) => [r.cells[col].rawText, r.cells[col].currentValue]));
    expect(run("keep_percent_number").get("12.5%")).toBe("12.5");
    expect(run("to_fraction").get("12.5%")).toBe("0.125");
    expect(run("to_fraction").get("3%")).toBe("0.03");
  });

  it("edit_cell creates a user_edit value and preserves the original rawText", () => {
    const { snapshot, provenance, columns, ctx } = local(noaaTable(NOAA_SAMPLE));
    const row = snapshot.rows[2];
    const col = columns[3].id;
    const out = compute(
      snapshot,
      provenance,
      { type: "edit_cell", rowId: row.id, columnId: col, cellId: row.cells[col].id, newValue: "331.00", explicitType: "decimal", missingReason: null, note: "checked against chart" },
      ctx,
    );
    const c = out.rows.find((r) => r.id === row.id)!.cells[col];
    expect(c).toMatchObject({ currentValue: "331.00", origin: "user_edit", rawText: row.cells[col].rawText });
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0].before.currentValue).toBe(row.cells[col].currentValue);
  });

  it("remove_exact_duplicates keeps the first in source order and reports removed rows", () => {
    // Protocol rows: an exact repeat may be a real repeated measurement, so removal is explicit and reported.
    const { snapshot, provenance, columns, ctx } = local({
      columns: [{ label: "k", dataType: "text" }, { label: "v", dataType: "decimal" }],
      rows: [["a", "1"], ["b", "2"], ["a", "1"], ["a", null], ["a", null]],
    });
    const out = compute(snapshot, provenance, { type: "remove_exact_duplicates", columnIds: columns.map((c) => c.id), retainPolicy: "first_in_source_order" }, ctx);
    expect(out.removedRowIds).toEqual([snapshot.rows[2].id, snapshot.rows[4].id]);
    expect(out.rows.map((r) => r.sourceOrder)).toEqual([0, 1, 3]);
  });

  it("an unregistered unit conversion is rejected, not guessed", () => {
    const { snapshot, provenance, columns, ctx } = local(noaaTable(NOAA_SAMPLE));
    expect(() => computeTransform(snapshot, provenance, { type: "convert_unit", columnId: columns[3].id, registeredConversionId: "ppm_to_vibes" }, ctx)).toThrow(AppError);
  });

  it("an operation naming a column that does not exist is rejected", () => {
    const { snapshot, provenance, ctx } = local(noaaTable(NOAA_SAMPLE));
    expect(() => computeTransform(snapshot, provenance, { type: "rename_column", columnId: "col_missing", newLabel: "x" }, ctx)).toThrow(AppError);
  });

  describe("through orchestration", () => {
    async function seeded(owner: Owner) {
      return seedDataset(owner, noaaTable(NOAA_SAMPLE));
    }

    it("apply commits exactly the previewed changes; undo restores the exact prior rows", async () => {
      const owner = makeOwner();
      const s = await seeded(owner);
      const op: TransformOperation = { type: "mark_missing", columnId: s.columns[6].id, explicitTokens: ["-9.99"], rowIds: null, missingReason: "not_reported" };
      const preview = await previewTransform(owner, s.dataset.id, { expectedVersionId: s.snapshot.version.id, operation: op });
      expect(preview.operationHash).toBe(operationHash(s.snapshot.version.id, op));
      const detail = await applyTransform(owner, s.dataset.id, { expectedVersionId: s.snapshot.version.id, operation: op, operationHash: preview.operationHash });
      const v2 = detail.dataset.currentVersionId;
      expect(v2).not.toBe(s.snapshot.version.id);
      expect(detail.version.rowCount).toBe(preview.rowCountAfter);
      const rows = (await getRows(owner, s.dataset.id, { versionId: v2, limit: 1000 })).rows;
      for (const ch of preview.changes) {
        const c = rows.find((r) => r.id === ch.rowId)!.cells[ch.columnId];
        expect({ rawText: c.rawText, currentValue: c.currentValue, valueType: c.valueType, missingReason: c.missingReason }).toEqual(ch.after);
      }
      const original = (await getRows(owner, s.dataset.id, { versionId: s.snapshot.version.id, limit: 1000 })).rows;
      expect(original).toEqual(s.snapshot.rows);
      const undone = await restoreVersion(owner, s.dataset.id, { expectedVersionId: v2, targetVersionId: s.snapshot.version.id });
      expect((await getRows(owner, s.dataset.id, { versionId: undone.dataset.currentVersionId, limit: 1000 })).rows).toEqual(s.snapshot.rows);
    });

    it("a second apply against the same base is a 409 conflict", async () => {
      const owner = makeOwner();
      const s = await seeded(owner);
      const op: TransformOperation = { type: "rename_column", columnId: s.columns[3].id, newLabel: "CO2 (ppm)" };
      const hash = operationHash(s.snapshot.version.id, op);
      await applyTransform(owner, s.dataset.id, { expectedVersionId: s.snapshot.version.id, operation: op, operationHash: hash });
      const err = await applyTransform(owner, s.dataset.id, { expectedVersionId: s.snapshot.version.id, operation: op, operationHash: hash }).catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("version_conflict");
    });
  });
});
