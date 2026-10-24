import { describe, expect, it } from "vitest";
import { ChartQueryResultSchema, type Cell, type Column, type DatasetVersionSnapshot, type Row } from "@/contracts";
import { buildChartQuery } from "./chart-query";

type CellSpec = { v: string | boolean | null; t?: Cell["valueType"]; origin?: Cell["origin"]; prov?: string[] } | undefined;

function column(id: string, dataType: Column["dataType"], semanticRole: Column["semanticRole"] = "other"): Column {
  return {
    id,
    label: id,
    semanticRole,
    dataType,
    unit: null,
    currency: null,
    percentRepresentation: null,
    datePolicy: null,
    sourceScale: "unknown",
    seriesLabel: null,
  };
}

function row(id: string, sourceOrder: number, cells: Record<string, CellSpec>): Row {
  const out: Row["cells"] = {};
  for (const [colId, spec] of Object.entries(cells)) {
    if (!spec) continue;
    out[colId] = {
      id: `${id}_${colId}`,
      rawText: spec.v === null ? null : String(spec.v),
      currentValue: spec.v,
      valueType: spec.t ?? "decimal",
      missingReason: spec.v === null ? "blank" : null,
      origin: spec.origin ?? "parsed",
      reviewStatus: "unreviewed",
      provenanceIds: spec.prov ?? [`p_${id}_${colId}`],
      parentCellIds: [],
      notes: [],
    };
  }
  return { id, sourceOrder, cells: out };
}

function snapshot(columns: Column[], rows: Row[]): DatasetVersionSnapshot {
  return {
    version: {
      id: "v1",
      datasetId: "d1",
      parentVersionId: null,
      createdAt: "2026-10-24T00:00:00.000Z",
      schemaVersion: "unspin.contracts/1",
      columns,
      rowCount: rows.length,
      operationId: null,
      unresolvedFindingCount: 0,
      reviewSummary: { cellsTotal: 0, unreviewed: 0, accepted: 0, corrected: 0, unavailable: 0 },
    },
    rows,
  };
}

const numericCols = [column("x", "decimal", "x"), column("y", "decimal", "y"), column("z", "decimal", "y")];

describe("buildChartQuery", () => {
  it("keeps irregular numeric x spacing as exact decimal strings", () => {
    const snap = snapshot(numericCols, [
      row("r1", 0, { x: { v: "0.1" }, y: { v: "1" } }),
      row("r2", 1, { x: { v: "0.15" }, y: { v: "2" } }),
      row("r3", 2, { x: { v: "10" }, y: { v: "3" } }),
    ]);
    const result = buildChartQuery(snap, { versionId: "v1", xColumnId: "x", yColumnIds: ["y"] }, 100);
    expect(result.xKind).toBe("numeric");
    expect(result.points.map((p) => p.x)).toEqual(["0.1", "0.15", "10"]);
    expect(ChartQueryResultSchema.safeParse(result).success).toBe(true);
  });

  it("preserves decimal strings exactly (no Number round trip)", () => {
    const big = "12345678901234567890.123456789";
    const snap = snapshot(numericCols, [
      row("r1", 0, { x: { v: "9007199254740993" }, y: { v: big } }),
      row("r2", 1, { x: { v: "1.0e-3" }, y: { v: "0.10" } }),
    ]);
    const result = buildChartQuery(snap, { versionId: "v1", xColumnId: "x", yColumnIds: ["y"] }, 100);
    expect(result.points.map((p) => [p.x, p.y])).toEqual([
      ["9007199254740993", big],
      ["1.0e-3", "0.10"],
    ]);
  });

  it("detects date x and keeps ISO strings", () => {
    const snap = snapshot([column("d", "date", "x"), column("y", "decimal", "y")], [
      row("r1", 0, { d: { v: "2020-01-31", t: "date" }, y: { v: "5" } }),
      row("r2", 1, { d: { v: "2020-03-31", t: "date" }, y: { v: "6" } }),
      row("r3", 2, { d: { v: "2021-03-31T12:00:00.000Z", t: "datetime" }, y: { v: "7" } }),
    ]);
    const result = buildChartQuery(snap, { versionId: "v1", xColumnId: "d", yColumnIds: ["y"] }, 100);
    expect(result.xKind).toBe("date");
    expect(result.points.map((p) => p.x)).toEqual(["2020-01-31", "2020-03-31", "2021-03-31T12:00:00.000Z"]);
  });

  it("treats mixed or text x as categories in source order", () => {
    const snap = snapshot([column("c", "text", "category"), column("y", "decimal", "y")], [
      row("r1", 0, { c: { v: "Zeta", t: "text" }, y: { v: "1" } }),
      row("r2", 1, { c: { v: "2020", t: "decimal" }, y: { v: "2" } }),
      row("r3", 2, { c: { v: "Alpha", t: "text" }, y: { v: "3" } }),
    ]);
    const result = buildChartQuery(snap, { versionId: "v1", xColumnId: "c", yColumnIds: ["y"] }, 100);
    expect(result.xKind).toBe("category");
    expect(result.points.map((p) => p.x)).toEqual(["Zeta", "2020", "Alpha"]);
  });

  it("keeps missing y as a null gap, never zero, and counts it", () => {
    const snap = snapshot(numericCols, [
      row("r1", 0, { x: { v: "1" }, y: { v: "4" } }),
      row("r2", 1, { x: { v: "2" }, y: { v: null } }),
      row("r3", 2, { x: { v: "3" }, y: { v: "6" } }),
    ]);
    const result = buildChartQuery(snap, { versionId: "v1", xColumnId: "x", yColumnIds: ["y"] }, 100);
    expect(result.points.map((p) => p.y)).toEqual(["4", null, "6"]);
    expect(result.points[1].yCellId).toBe("r2_y");
    expect(result.excluded).toEqual({ missingY: 1, nonNumericY: 0, missingX: 0 });
  });

  it("excludes and counts non-numeric y and missing x", () => {
    const snap = snapshot(numericCols, [
      row("r1", 0, { x: { v: "1" }, y: { v: "n/a", t: "text" } }),
      row("r2", 1, { x: { v: null }, y: { v: "5" } }),
      row("r3", 2, { y: { v: "5" } }),
      row("r4", 3, { x: { v: "4" }, y: { v: "7" } }),
    ]);
    const result = buildChartQuery(snap, { versionId: "v1", xColumnId: "x", yColumnIds: ["y"] }, 100);
    expect(result.points.map((p) => p.rowId)).toEqual(["r4"]);
    expect(result.excluded).toEqual({ missingY: 0, nonNumericY: 1, missingX: 2 });
  });

  it("keeps negative and zero values distinct from missing", () => {
    const snap = snapshot(numericCols, [
      row("r1", 0, { x: { v: "1" }, y: { v: "-3.5" } }),
      row("r2", 1, { x: { v: "2" }, y: { v: "0" } }),
      row("r3", 2, { x: { v: "3" }, y: { v: null } }),
    ]);
    const result = buildChartQuery(snap, { versionId: "v1", xColumnId: "x", yColumnIds: ["y"] }, 100);
    expect(result.points.map((p) => p.y)).toEqual(["-3.5", "0", null]);
  });

  it("builds stable point ids, cell ids, provenance union and origin", () => {
    const snap = snapshot(numericCols, [
      row("r1", 0, { x: { v: "1", prov: ["px", "shared"] }, y: { v: "2", origin: "estimated", prov: ["shared", "py"] }, z: { v: "3", origin: "user_edit" } }),
    ]);
    const result = buildChartQuery(snap, { versionId: "v1", xColumnId: "x", yColumnIds: ["y", "z", "y"] }, 100);
    expect(result.points).toHaveLength(2);
    const [p, q] = result.points;
    expect(p).toMatchObject({ pointId: "r1:y", rowId: "r1", yColumnId: "y", xCellId: "r1_x", yCellId: "r1_y", yOrigin: "estimated" });
    expect(p.provenanceIds).toEqual(["px", "shared", "py"]);
    expect(q).toMatchObject({ pointId: "r1:z", yOrigin: "user_edit" });
  });

  it("produces identical points when the snapshot rows are reordered", () => {
    const rows = [
      row("r1", 0, { x: { v: "1" }, y: { v: "10" } }),
      row("r2", 1, { x: { v: "2" }, y: { v: "20" } }),
      row("r3", 2, { x: { v: "3" }, y: { v: "30" } }),
    ];
    const req = { versionId: "v1", xColumnId: "x", yColumnIds: ["y"] };
    const a = buildChartQuery(snapshot(numericCols, rows), req, 100);
    const b = buildChartQuery(snapshot(numericCols, [rows[2], rows[0], rows[1]]), req, 100);
    expect(b).toEqual(a);
    expect(b.points.map((p) => p.pointId)).toEqual(["r1:y", "r2:y", "r3:y"]);
  });

  it("samples whole rows every n-th, discloses counts and keeps exact mapping", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row(`r${i}`, i, { x: { v: String(i) }, y: { v: String(i * 2) }, z: { v: i === 4 ? null : String(-i) } }),
    );
    const result = buildChartQuery(snapshot(numericCols, rows), { versionId: "v1", xColumnId: "x", yColumnIds: ["y", "z"] }, 8);
    expect(result.sampling).toEqual({ method: "every_nth", keptCount: result.points.length, totalCount: 20 });
    expect(result.points.length).toBeLessThanOrEqual(8);
    expect([...new Set(result.points.map((p) => p.rowId))]).toEqual(["r0", "r3", "r6", "r9"]);
    for (const p of result.points) {
      const src = rows.find((r) => r.id === p.rowId)!;
      expect(p.yCellId).toBe(src.cells[p.yColumnId].id);
      expect(p.y).toBe(src.cells[p.yColumnId].currentValue);
    }
    expect(result.excluded.missingY).toBe(1);
  });

  it("does not sample when within the limit", () => {
    const rows = [row("r1", 0, { x: { v: "1" }, y: { v: "1" } })];
    expect(buildChartQuery(snapshot(numericCols, rows), { versionId: "v1", xColumnId: "x", yColumnIds: ["y"] }, 1).sampling).toBeNull();
  });

  it("rejects unknown columns", () => {
    expect(() => buildChartQuery(snapshot(numericCols, []), { versionId: "v1", xColumnId: "nope", yColumnIds: ["y"] }, 10)).toThrow(/Unknown column/);
  });
});
