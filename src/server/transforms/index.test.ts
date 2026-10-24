import { describe, expect, it } from "vitest";
import { AppError, CellSchema, type TransformOperation } from "@/contracts";
import { computeTransform, operationHash, type TransformComputation } from "./index";
import { column, ctx, snapshot, textCell } from "./test-helpers";

const run = (snap: ReturnType<typeof snapshot>, op: TransformOperation, operationId = "op_preview") => computeTransform(snap, [], op, ctx(operationId));

/** Everything except provenance ids that embed the operation id. */
function values(c: TransformComputation) {
  const fresh = new Set(c.newProvenance.map((p) => p.id));
  return {
    columns: c.columns,
    rows: c.rows.map((r) => ({
      id: r.id,
      sourceOrder: r.sourceOrder,
      cells: Object.fromEntries(
        Object.entries(r.cells).map(([k, cell]) => [k, { ...cell, provenanceIds: cell.provenanceIds.map((p) => (fresh.has(p) ? "NEW" : p)) }]),
      ),
    })),
    newProvenance: c.newProvenance.map(({ locator, label, locatorOrigin }) => ({ type: locator.type, label, locatorOrigin })),
    changes: c.changes,
    removedRowIds: c.removedRowIds,
    failedCellIds: c.failedCellIds,
    affectedCount: c.affectedCount,
    warnings: c.warnings,
    precisionEffects: c.precisionEffects,
    summary: c.summary,
  };
}

const parseEn = (columnId: string, patch: Partial<Extract<TransformOperation, { type: "parse_numeric" }>> = {}): TransformOperation => ({
  type: "parse_numeric",
  columnId,
  locale: { decimalSeparator: ".", groupingSeparator: "," },
  groupingPolicy: "allow",
  percentPolicy: "reject",
  currencyPolicy: { mode: "reject" },
  parenthesesNegative: false,
  onFailure: "keep_and_flag",
  ...patch,
});

function expectBadRequest(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe("bad_request");
    return;
  }
  throw new Error("expected bad_request");
}

describe("preview/apply equivalence and purity", () => {
  const snap = snapshot([column("a"), column("b")], [["1,200.5", " x "], ["bad", "y"], ["12", null]]);
  const ops: TransformOperation[] = [
    parseEn("a"),
    { type: "trim_text", columnIds: ["b"], rowIds: null },
    { type: "edit_cell", rowId: "r1", columnId: "a", cellId: "c1_a", newValue: "3.14", explicitType: "decimal", missingReason: null, note: "typo" },
    { type: "mark_missing", columnId: "a", explicitTokens: ["bad"], rowIds: null, missingReason: "invalid" },
    { type: "remove_selected_rows", rowIds: ["r2"] },
    { type: "set_review_status", cellIds: ["c0_a"], reviewStatus: "accepted" },
  ];

  it.each(ops.map((op) => [op.type, op] as const))("%s gives identical values for preview and apply", (_t, op) => {
    const before = structuredClone(snap);
    const preview = run(snap, op, "op_preview");
    const apply = run(snap, op, "op_abc123");
    expect(values(apply)).toEqual(values(preview));
    expect(snap).toEqual(before); // base snapshot is never mutated
    for (const row of apply.rows) for (const cell of Object.values(row.cells)) expect(CellSchema.safeParse(cell).success).toBe(true);
  });

  it("binds the hash to the base version and the exact operation", () => {
    const op = parseEn("a");
    const reordered = JSON.parse(JSON.stringify({ onFailure: "keep_and_flag", ...op })) as TransformOperation;
    expect(operationHash("ver_1", op)).toBe(operationHash("ver_1", reordered));
    expect(operationHash("ver_1", op)).not.toBe(operationHash("ver_2", op));
    expect(operationHash("ver_1", op)).not.toBe(operationHash("ver_1", parseEn("a", { groupingPolicy: "forbid" })));
  });
});

describe("edit_cell", () => {
  const snap = snapshot([column("a")], [["12"], ["x"]]);

  it("never changes rawText and records user_edit lineage", () => {
    const c = run(snap, { type: "edit_cell", rowId: "r0", columnId: "a", cellId: "c0_a", newValue: "13.0", explicitType: "decimal", missingReason: null, note: "Checked source" }, "op_e1");
    const cell = c.rows[0].cells.a;
    expect(cell).toMatchObject({ id: "c0_a", rawText: "12", currentValue: "13.0", valueType: "decimal", origin: "user_edit", reviewStatus: "corrected" });
    expect(cell.notes).toEqual(["Checked source"]);
    expect(cell.provenanceIds[0]).toBe("prov_c0_a");
    expect(c.newProvenance).toHaveLength(1);
    expect(c.newProvenance[0].locator).toEqual({ type: "user_edit", operationId: "op_e1" });
    expect(cell.provenanceIds[1]).toBe(c.newProvenance[0].id);
    expect(c.changes).toEqual([
      { rowId: "r0", columnId: "a", cellId: "c0_a", before: { rawText: "12", currentValue: "12", valueType: "text", missingReason: null }, after: { rawText: "12", currentValue: "13.0", valueType: "decimal", missingReason: null } },
    ]);
    expect(c.rows[1]).toBe(snap.rows[1]); // unchanged rows keep identity and ids

    const again = computeTransform({ ...snap, rows: c.rows }, [], { type: "edit_cell", rowId: "r0", columnId: "a", cellId: "c0_a", newValue: "14", explicitType: "decimal", missingReason: null, note: null }, ctx("op_e2"));
    expect(again.rows[0].cells.a.rawText).toBe("12");
    expect(again.rows[0].cells.a.provenanceIds).toHaveLength(3);
  });

  it("marks missing with a reason instead of zero", () => {
    const c = run(snap, { type: "edit_cell", rowId: "r0", columnId: "a", cellId: "c0_a", newValue: null, explicitType: "decimal", missingReason: "unreadable", note: null });
    expect(c.rows[0].cells.a).toMatchObject({ currentValue: null, missingReason: "unreadable" });
  });

  it("validates typed values and ids", () => {
    const edit = (patch: object) => () => run(snap, { type: "edit_cell", rowId: "r0", columnId: "a", cellId: "c0_a", newValue: "1", explicitType: "decimal", missingReason: null, note: null, ...patch } as TransformOperation);
    expectBadRequest(edit({ newValue: "1,000" }));
    expectBadRequest(edit({ newValue: "007" }));
    expectBadRequest(edit({ newValue: "2020-02-30", explicitType: "date" }));
    expectBadRequest(edit({ newValue: "2020-02-03T00:00:00+01:00", explicitType: "datetime" }));
    expectBadRequest(edit({ newValue: null, missingReason: null }));
    expectBadRequest(edit({ cellId: "c1_a" }));
    expectBadRequest(edit({ rowId: "r9" }));
    expectBadRequest(edit({ columnId: "zz" }));
    expect(run(snap, { type: "edit_cell", rowId: "r0", columnId: "a", cellId: "c0_a", newValue: "2020-02-29", explicitType: "date", missingReason: null, note: null }).affectedCount).toBe(1);
  });

  it("reports no change when nothing differs", () => {
    const c = run(snap, { type: "edit_cell", rowId: "r1", columnId: "a", cellId: "c1_a", newValue: "x", explicitType: "text", missingReason: null, note: null });
    expect(c.affectedCount).toBe(0);
    expect(c.changes).toHaveLength(0);
  });
});

describe("parse_numeric on a dataset", () => {
  it("parses, keeps failures unchanged and flagged, and types the column only when complete", () => {
    const snap = snapshot([column("v")], [["1,234.50"], ["n/a"], [null], ["12"]]);
    const c = run(snap, parseEn("v"));
    expect(c.rows[0].cells.v).toMatchObject({ currentValue: "1234.50", valueType: "decimal", rawText: "1,234.50" });
    expect(c.rows[1].cells.v).toMatchObject({ currentValue: "n/a", valueType: "text" });
    expect(c.rows[1].cells.v.notes[0]).toMatch(/Parse as number/);
    expect(c.rows[2].cells.v).toMatchObject({ currentValue: null, missingReason: "blank" });
    expect(c.failedCellIds).toEqual(["c1_v"]);
    expect(c.affectedCount).toBe(2);
    expect(c.warnings.join(" ")).toMatch(/1 cell could not be parsed/);
    expect(c.columns[0].dataType).toBe("text");
    expect(c.newProvenance).toHaveLength(1);
    expect(c.newProvenance[0].locator.type).toBe("derived_operation");
  });

  it("never turns missing into zero", () => {
    const snap = snapshot([column("v")], [[null], ["5"]]);
    const c = run(snap, parseEn("v"));
    expect(c.rows[0].cells.v.currentValue).toBeNull();
    expect(c.rows[0].cells.v.missingReason).toBe("blank");
    expect(c.columns[0].dataType).toBe("decimal");
  });

  it("records percent representation and refuses to guess for values without %", () => {
    const snap = snapshot([column("p")], [["12.5%"], ["3%"], ["0.4"]]);
    const c = run(snap, parseEn("p", { percentPolicy: "to_fraction" }));
    expect(c.rows.map((r) => r.cells.p.currentValue)).toEqual(["0.125", "0.03", "0.4"]);
    expect(c.rows[2].cells.p.valueType).toBe("text");
    expect(c.failedCellIds).toEqual(["c2_p"]);
    expect(c.columns[0].percentRepresentation).toBe("fraction");

    const keep = run(snapshot([column("p")], [["12.5%"], ["3%"]]), parseEn("p", { percentPolicy: "keep_percent_number" }));
    expect(keep.rows.map((r) => r.cells.p.currentValue)).toEqual(["12.5", "3"]);
    expect(keep.columns[0]).toMatchObject({ percentRepresentation: "percent_number", dataType: "decimal" });
  });

  it("records the explicit currency on the column", () => {
    const c = run(snapshot([column("m")], [["$1,000"], ["$2.50"]]), parseEn("m", { currencyPolicy: { mode: "strip_symbol", currency: "USD" } }));
    expect(c.columns[0]).toMatchObject({ currency: "USD", dataType: "decimal" });
    expectBadRequest(() =>
      run(snapshot([column("m", { currency: "EUR" })], [["$1"]]), parseEn("m", { currencyPolicy: { mode: "strip_symbol", currency: "USD" } })),
    );
  });

  it("parses de locale", () => {
    const c = run(snapshot([column("v")], [["1.234,5"], ["0,25"]]), parseEn("v", { locale: { decimalSeparator: ",", groupingSeparator: "." } }));
    expect(c.rows.map((r) => r.cells.v.currentValue)).toEqual(["1234.5", "0.25"]);
  });
});

describe("parse_date on a dataset", () => {
  it("parses with the chosen order and records the column policy", () => {
    const c = run(snapshot([column("d")], [["03/04/2020"], ["12/25/2020"]]), { type: "parse_date", columnId: "d", format: "MM/DD/YYYY", timezonePolicy: "date_only", onFailure: "keep_and_flag" });
    expect(c.rows.map((r) => r.cells.d.currentValue)).toEqual(["2020-03-04", "2020-12-25"]);
    expect(c.columns[0]).toMatchObject({ dataType: "date", datePolicy: { format: "MM/DD/YYYY", timezone: "date_only" } });
    expect(c.precisionEffects.join(" ")).toMatch(/could be read either way/);
  });

  it("flags ambiguous values when other values contradict the chosen order", () => {
    const c = run(snapshot([column("d")], [["03/04/2020"], ["25/12/2020"], ["05/05/2020"]]), { type: "parse_date", columnId: "d", format: "MM/DD/YYYY", timezonePolicy: "date_only", onFailure: "keep_and_flag" });
    expect(c.failedCellIds.sort()).toEqual(["c0_d", "c1_d"]);
    expect(c.rows[2].cells.d.currentValue).toBe("2020-05-05");
    expect(c.rows[0].cells.d.currentValue).toBe("03/04/2020");
    expect(c.warnings.join(" ")).toMatch(/opposite day\/month order/);
  });

  it("notes periods and refuses UTC for calendar formats", () => {
    const c = run(snapshot([column("d")], [["2020-03"]]), { type: "parse_date", columnId: "d", format: "YYYY-MM", timezonePolicy: "date_only", onFailure: "keep_and_flag" });
    expect(c.rows[0].cells.d.currentValue).toBe("2020-03-01");
    expect(c.rows[0].cells.d.notes[0]).toMatch(/Month period/);
    expectBadRequest(() => run(snapshot([column("d")], [["2020-03-04"]]), { type: "parse_date", columnId: "d", format: "YYYY-MM-DD", timezonePolicy: "utc", onFailure: "keep_and_flag" }));
  });
});

describe("mark_missing", () => {
  it("matches tokens exactly (case-sensitive, untrimmed) and never writes zero", () => {
    const snap = snapshot([column("v")], [["NA"], ["na"], [" NA"], ["0"], ["NA"]]);
    const c = run(snap, { type: "mark_missing", columnId: "v", explicitTokens: ["NA"], rowIds: null, missingReason: "not_reported" });
    expect(c.rows.map((r) => r.cells.v.currentValue)).toEqual([null, "na", " NA", "0", null]);
    expect(c.rows[0].cells.v).toMatchObject({ missingReason: "not_reported", rawText: "NA" });
    expect(c.affectedCount).toBe(2);
  });

  it("respects the row scope", () => {
    const c = run(snapshot([column("v")], [["NA"], ["NA"]]), { type: "mark_missing", columnId: "v", explicitTokens: ["NA"], rowIds: ["r1"], missingReason: "not_reported" });
    expect(c.rows.map((r) => r.cells.v.currentValue)).toEqual(["NA", null]);
  });
});

describe("trim_text", () => {
  it("trims only the selected columns and rows and reports the count", () => {
    const snap = snapshot([column("a"), column("b")], [[" x ", " y "], [" z", "w "]]);
    const c = run(snap, { type: "trim_text", columnIds: ["a"], rowIds: ["r1"] });
    expect(c.rows[0].cells.a.currentValue).toBe(" x ");
    expect(c.rows[1].cells.a.currentValue).toBe("z");
    expect(c.rows[1].cells.b.currentValue).toBe("w ");
    expect(c.affectedCount).toBe(1);
    expect(c.rows[1].cells.a.rawText).toBe(" z");
  });

  it("warns instead of marking whitespace-only cells missing", () => {
    const c = run(snapshot([column("a")], [["   "]]), { type: "trim_text", columnIds: ["a"], rowIds: null });
    expect(c.rows[0].cells.a).toMatchObject({ currentValue: "", missingReason: null });
    expect(c.warnings[0]).toMatch(/not marked missing/);
  });
});

describe("row removal", () => {
  it("removes explicit rows only and rejects unknown ids", () => {
    const snap = snapshot([column("a")], [["1"], ["2"], ["3"]]);
    const c = run(snap, { type: "remove_selected_rows", rowIds: ["r2", "r0"] });
    expect(c.rows.map((r) => r.id)).toEqual(["r1"]);
    expect(c.removedRowIds).toEqual(["r0", "r2"]);
    expect(c.rows[0].sourceOrder).toBe(1);
    expectBadRequest(() => run(snap, { type: "remove_selected_rows", rowIds: ["nope"] }));
  });

  it("removes exact duplicates retaining the first in source order", () => {
    const snap = snapshot([column("a"), column("b")], [["1", "x"], ["1", "x"], ["1", "y"], [null, "x"], ["1", "x"]]);
    // Shuffle storage order to prove retention follows sourceOrder, not array position.
    const shuffled = { ...snap, rows: [snap.rows[4], snap.rows[1], snap.rows[0], snap.rows[3], snap.rows[2]] };
    const c = run(shuffled, { type: "remove_exact_duplicates", columnIds: ["a", "b"], retainPolicy: "first_in_source_order" });
    expect(c.removedRowIds).toEqual(["r1", "r4"]);
    expect(c.rows.map((r) => r.id).sort()).toEqual(["r0", "r2", "r3"]);
    expect(c.warnings[0]).toMatch(/genuine repeated measurements/);

    const onA = run(snap, { type: "remove_exact_duplicates", columnIds: ["a"], retainPolicy: "first_in_source_order" });
    expect(onA.removedRowIds).toEqual(["r1", "r2", "r4"]);
    expect(onA.warnings.join(" ")).toMatch(/may differ in other columns/);
  });

  it("distinguishes missing reasons and value types when comparing", () => {
    const snap = snapshot([column("a")], [[null], [null]]);
    snap.rows[1].cells.a = textCell("c1_a", null, { missingReason: "not_reported" });
    const c = run(snap, { type: "remove_exact_duplicates", columnIds: ["a"], retainPolicy: "first_in_source_order" });
    expect(c.removedRowIds).toEqual([]);
  });
});

describe("set_review_status", () => {
  it("records review without changing origin or values", () => {
    const snap = snapshot([column("a")], [["5"]]);
    snap.rows[0].cells.a = textCell("c0_a", "5", { origin: "estimated" });
    const c = run(snap, { type: "set_review_status", cellIds: ["c0_a"], reviewStatus: "accepted" });
    expect(c.rows[0].cells.a).toMatchObject({ origin: "estimated", reviewStatus: "accepted", currentValue: "5" });
    expect(c.affectedCount).toBe(1);
    expect(c.precisionEffects[0]).toMatch(/stay estimates/);
    expectBadRequest(() => run(snap, { type: "set_review_status", cellIds: ["missing"], reviewStatus: "accepted" }));
  });

  it("does not alter the ancestors of a reviewed derived cell", () => {
    const snap = snapshot([column("a"), column("b")], [["5", "10"]]);
    snap.rows[0].cells.a = textCell("c0_a", "5", { origin: "estimated" });
    snap.rows[0].cells.b = textCell("c0_b", "10", { origin: "derived", parentCellIds: ["c0_a"] });
    const c = run(snap, { type: "set_review_status", cellIds: ["c0_b"], reviewStatus: "accepted" });
    expect(c.rows[0].cells.a).toEqual(snap.rows[0].cells.a);
    expect(c.rows[0].cells.b).toMatchObject({ origin: "derived", parentCellIds: ["c0_a"], reviewStatus: "accepted" });
  });
});

describe("column metadata and unit conversion", () => {
  it("renames and sets unit without converting values", () => {
    const snap = snapshot([column("a")], [["5"]]);
    expect(run(snap, { type: "rename_column", columnId: "a", newLabel: "Mass" }).columns[0].label).toBe("Mass");
    const u = run(snap, { type: "set_column_unit", columnId: "a", unit: "kg", currency: null });
    expect(u.columns[0].unit).toBe("kg");
    expect(u.rows).toEqual(snap.rows);
    expect(u.warnings[0]).toMatch(/No values are converted/);
  });

  it("converts exactly with the registry and checks semantics", () => {
    const snap = snapshot([column("m", { unit: "g", dataType: "decimal" })], [["1500"], ["2.5"], [null]]);
    for (const r of snap.rows) {
      const cell = r.cells.m;
      if (cell.currentValue !== null) r.cells.m = { ...cell, valueType: "decimal" };
    }
    const c = run(snap, { type: "convert_unit", columnId: "m", registeredConversionId: "mass_g_to_kg" });
    expect(c.rows.map((r) => r.cells.m.currentValue)).toEqual(["1.500", "0.0025", null]);
    expect(c.columns[0].unit).toBe("kg");
    expectBadRequest(() => run(snapshot([column("m", { unit: "kg" })], [["1"]]), { type: "convert_unit", columnId: "m", registeredConversionId: "mass_g_to_kg" }));
    expectBadRequest(() => run(snapshot([column("m", { unit: "g" })], [["1"]]), { type: "convert_unit", columnId: "m", registeredConversionId: "mass_g_to_kg" }));
    expect(() => run(snap, { type: "convert_unit", columnId: "m", registeredConversionId: "temp_c_to_f" })).toThrow(/registry/);
  });
});
