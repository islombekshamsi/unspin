import { describe, expect, it } from "vitest";
import { ChartQueryResultSchema, newId } from "@/contracts";
import { buildChartQuery } from "@/features/visualization/lib/chart-query";
import { buildCsvSelection, buildCsvSource, buildSnapshot, utf8, type TableSpec } from "../helpers/fixtures";
import { NOAA_SAMPLE, noaaTable } from "../helpers/noaa";
import { PLACEHOLDER_REASON, isPlaceholder } from "../helpers/stubs";

function local(spec: Pick<TableSpec, "columns" | "rows">) {
  const src = buildCsvSource(utf8("fixture"));
  return buildSnapshot(newId("ds"), src, buildCsvSelection(src.id), spec);
}

const noaa = local(noaaTable(NOAA_SAMPLE));
const X = noaa.columns[2].id; // decimal date
const AVG = noaa.columns[3].id;
const DESEAS = noaa.columns[4].id;

const chartPlaceholder = await isPlaceholder(() =>
  buildChartQuery(noaa.snapshot, { versionId: noaa.snapshot.version.id, xColumnId: X, yColumnIds: [AVG] }, 20000),
);

/** Protocol table (not real data): numeric x with a blank y, a text y, and a zero y. */
const gaps = local({
  columns: [
    { label: "x", dataType: "decimal", semanticRole: "x" },
    { label: "y", dataType: "decimal" },
  ],
  rows: [["1", "5"], ["2", null], ["3", "0"], ["10", "n/a"], [null, "7"]],
});

describe.skipIf(chartPlaceholder)(`chart query [skips while ${PLACEHOLDER_REASON("visualization.buildChartQuery")}]`, () => {
  it("returns stable point ids mapped to row and cell ids, never array positions", () => {
    const r = ChartQueryResultSchema.parse(buildChartQuery(noaa.snapshot, { versionId: noaa.snapshot.version.id, xColumnId: X, yColumnIds: [AVG, DESEAS] }, 20000));
    expect(r.points).toHaveLength(12);
    for (const p of r.points) {
      const row = noaa.snapshot.rows.find((x) => x.id === p.rowId)!;
      expect(p.pointId).toBe(`${p.rowId}:${p.yColumnId}`);
      expect(p.yCellId).toBe(row.cells[p.yColumnId].id);
      expect(p.xCellId).toBe(row.cells[X].id);
      expect(p.y).toBe(row.cells[p.yColumnId].currentValue);
      expect(p.provenanceIds).toEqual(row.cells[p.yColumnId].provenanceIds);
    }
    expect(r.xKind).toBe("numeric");
    expect(r.sampling).toBeNull();
  });

  it("numeric x is exact decimal text (spacing preserved), not category positions", () => {
    const r = buildChartQuery(noaa.snapshot, { versionId: noaa.snapshot.version.id, xColumnId: X, yColumnIds: [AVG] }, 20000);
    expect(r.points.map((p) => p.x)).toEqual(["1975.7083", "1975.7917", "1975.8750", "1975.9583", "1976.0417", "1976.1250"]);
  });

  it("missing y is a gap (null or excluded+counted), zero stays zero, text y is counted as non-numeric", () => {
    const r = buildChartQuery(gaps.snapshot, { versionId: gaps.snapshot.version.id, xColumnId: gaps.columns[0].id, yColumnIds: [gaps.columns[1].id] }, 20000);
    const byRow = new Map(r.points.map((p) => [p.rowId, p]));
    const missingRow = gaps.snapshot.rows[1].id;
    const pMissing = byRow.get(missingRow);
    if (pMissing) expect(pMissing.y).toBeNull();
    else expect(r.excluded.missingY).toBeGreaterThanOrEqual(1);
    expect(byRow.get(gaps.snapshot.rows[2].id)?.y).toBe("0");
    for (const p of r.points) if (p.rowId !== gaps.snapshot.rows[2].id) expect(p.y).not.toBe("0");
    expect(r.excluded.nonNumericY).toBe(1);
    const missingXRow = gaps.snapshot.rows[4].id;
    if (!byRow.has(missingXRow)) expect(r.excluded.missingX).toBe(1);
    else expect(byRow.get(missingXRow)!.x).toBeNull();
  });

  it("sampling above maxPoints is disclosed with counts and keeps row mapping", () => {
    const r = buildChartQuery(noaa.snapshot, { versionId: noaa.snapshot.version.id, xColumnId: X, yColumnIds: [AVG] }, 3);
    expect(r.sampling).not.toBeNull();
    expect(r.sampling!.totalCount).toBe(6);
    expect(r.points.length).toBe(r.sampling!.keptCount);
    expect(r.points.length).toBeLessThanOrEqual(3);
    for (const p of r.points) expect(noaa.snapshot.rows.some((row) => row.id === p.rowId)).toBe(true);
  });

  it("does not mutate the snapshot", () => {
    const before = structuredClone(noaa.snapshot);
    buildChartQuery(noaa.snapshot, { versionId: noaa.snapshot.version.id, xColumnId: X, yColumnIds: [AVG] }, 2);
    expect(noaa.snapshot).toEqual(before);
  });
});
