import { describe, expect, it } from "vitest";
import { QualityFindingSchema, type Dataset } from "@/contracts";
import { computeTransform } from "@/server/transforms";
import { column, ctx, snapshot, textCell } from "@/server/transforms/test-helpers";
import { computeFindings } from "./index";

const dataset = (patch: Partial<Dataset> = {}): Dataset => ({
  id: "ds_test",
  sourceId: "src_test",
  sourceSelectionId: "sel_test",
  title: "Test",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  currentVersionId: "ver_base",
  initialVersionId: "ver_base",
  extractionMethod: "deterministic_parser",
  coverage: "complete_selection",
  coverageNote: null,
  coverageAcknowledgedAt: null,
  extraction: null,
  importIssues: [],
  ...patch,
});

const kinds = (fs: ReturnType<typeof computeFindings>) => fs.map((f) => f.kind);

describe("computeFindings", () => {
  it("returns schema-valid findings with deterministic ids", () => {
    const snap = snapshot([column("v"), column("d")], [["1,234", "03/04/2020"], ["1234.5", "13/04/2020"], ["NA", null], ["1,234", "03/04/2020"]]);
    const a = computeFindings(dataset(), snap);
    const b = computeFindings(dataset(), structuredClone(snap));
    expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id));
    expect(new Set(a.map((f) => f.id)).size).toBe(a.length);
    for (const f of a) expect(QualityFindingSchema.safeParse(f).success).toBe(true);
    const other = computeFindings(dataset(), { ...snap, version: { ...snap.version, id: "ver_other" } });
    expect(other.map((f) => f.id)).not.toEqual(a.map((f) => f.id));
  });

  it("reports missing values without suggesting a fill", () => {
    const fs = computeFindings(dataset(), snapshot([column("v")], [["1"], [null], [null]]));
    const f = fs.find((x) => x.kind === "missing_values")!;
    expect(f.affectedRowIds).toEqual(["r1", "r2"]);
    expect(f.severity).toBe("info");
    expect(f.suggestedOperation).toBeNull();
  });

  it("suggests an exact mark_missing for placeholder text", () => {
    const fs = computeFindings(dataset(), snapshot([column("v")], [["1"], ["NA"], ["n/a"], ["NA"]]));
    const f = fs.find((x) => x.kind === "missing_values" && x.suggestedOperation)!;
    expect(f.affectedCellIds.sort()).toEqual(["c1_v", "c2_v", "c3_v"]);
    expect(f.suggestedOperation).toEqual({ type: "mark_missing", columnId: "v", explicitTokens: ["NA", "n/a"], rowIds: null, missingReason: "not_reported" });
  });

  it("flags mixed numeric formats with observable evidence", () => {
    const fs = computeFindings(dataset(), snapshot([column("v")], [["1,234"], ["1234.5"], ["12%"], ["1,234,567"]]));
    const f = fs.find((x) => x.kind === "mixed_numeric_format")!;
    expect(f.severity).toBe("review");
    expect(f.affectedCellIds).toHaveLength(4);
    expect(f.evidence.join("\n")).toMatch(/percent sign: 1/);
    expect(f.evidence.join("\n")).toMatch(/decimal point: 1/);
    expect(f.suggestedOperation).toBeNull(); // percent needs an explicit representation choice
  });

  it("suggests a locale only when values settle it", () => {
    const en = computeFindings(dataset(), snapshot([column("v")], [["1,234"], ["1234.5"]])).find((x) => x.kind === "mixed_numeric_format")!;
    expect(en.suggestedOperation).toMatchObject({ type: "parse_numeric", locale: { decimalSeparator: ".", groupingSeparator: "," } });
    const ambiguous = computeFindings(dataset(), snapshot([column("v")], [["1,234"], ["12"]])).find((x) => x.affectedColumnIds[0] === "v" && x.kind !== "missing_values")!;
    expect(ambiguous.suggestedOperation).toBeNull();
    expect(ambiguous.evidence.join(" ")).toMatch(/either separator/);
  });

  it("flags ambiguous dates and suggests a format only with one-sided evidence", () => {
    const settled = computeFindings(dataset(), snapshot([column("d")], [["03/04/2020"], ["25/12/2020"]])).find((x) => x.kind === "ambiguous_date")!;
    expect(settled.affectedCellIds).toEqual(["c0_d"]);
    expect(settled.suggestedOperation).toMatchObject({ type: "parse_date", format: "DD/MM/YYYY", timezonePolicy: "date_only" });
    const open = computeFindings(dataset(), snapshot([column("d")], [["03/04/2020"], ["05/06/2020"]])).find((x) => x.kind === "ambiguous_date")!;
    expect(open.suggestedOperation).toBeNull();
    expect(open.evidence.join(" ")).toMatch(/settles the order/);
  });

  it("treats repeated rows as a question and only offers removal as an option", () => {
    const fs = computeFindings(dataset(), snapshot([column("a"), column("b")], [["1", "x"], ["2", "y"], ["1", "x"]]));
    const f = fs.find((x) => x.kind === "repeated_rows")!;
    expect(f.severity).toBe("review");
    expect(f.message).toMatch(/real repeated measurement/);
    expect(f.affectedRowIds).toEqual(["r0", "r2"]);
    expect(f.suggestedOperation).toEqual({ type: "remove_exact_duplicates", columnIds: ["a", "b"], retainPolicy: "first_in_source_order" });
  });

  it("flags mixed currencies and unit suffixes", () => {
    const fs = computeFindings(dataset(), snapshot([column("m"), column("w")], [["$5", "3 kg"], ["€4", "200 g"]]));
    expect(fs.filter((f) => f.kind === "mixed_units").map((f) => f.affectedColumnIds[0]).sort()).toEqual(["m", "w"]);
  });

  it("flags type mismatches in typed columns", () => {
    const snap = snapshot([column("v", { dataType: "decimal" })], [["1"], ["oops"]]);
    snap.rows[0].cells.v = textCell("c0_v", "1", { valueType: "decimal" });
    const f = computeFindings(dataset(), snap).find((x) => x.kind === "type_mismatch")!;
    expect(f.affectedCellIds).toEqual(["c1_v"]);
  });

  it("keeps import issues only for ids still present, and reports partial coverage", () => {
    const snap = snapshot([column("a")], [["1"], ["2"]]);
    const ds = dataset({
      coverage: "partial_selection",
      coverageNote: "Legend series omitted",
      importIssues: [
        { kind: "inconsistent_field_count", severity: "review", message: "Record had 3 fields", rowIds: ["r1"], columnIds: [], cellIds: [], evidence: ["line 3"] },
        { kind: "extraction_issue", severity: "info", message: "Gone", rowIds: ["r_removed"], columnIds: [], cellIds: [], evidence: [] },
      ],
    });
    const fs = computeFindings(ds, snap);
    expect(kinds(fs)).toContain("inconsistent_field_count");
    expect(fs.find((f) => f.message === "Gone")).toBeUndefined();
    const cov = fs.find((f) => f.kind === "partial_coverage")!;
    expect(cov.evidence[0]).toBe("Legend series omitted");

    const after = computeTransform(snap, [], { type: "remove_selected_rows", rowIds: ["r1"] }, ctx());
    const fs2 = computeFindings(ds, { version: { ...snap.version, id: "ver_2" }, rows: after.rows });
    expect(kinds(fs2)).not.toContain("inconsistent_field_count");
  });

  it("notes unreviewed estimates as info", () => {
    const snap = snapshot([column("y")], [["5"]]);
    snap.rows[0].cells.y = textCell("c0_y", "5", { origin: "estimated" });
    const f = computeFindings(dataset(), snap).find((x) => x.kind === "extraction_issue")!;
    expect(f.severity).toBe("info");
    expect(f.affectedCellIds).toEqual(["c0_y"]);
  });
});
