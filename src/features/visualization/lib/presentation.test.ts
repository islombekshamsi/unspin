import { describe, expect, it } from "vitest";
import type { ChartPoint, Column, SelectionEvent } from "@/contracts";
import { buildTraces, numericXDomain, rechartsYDomain } from "./figure";
import {
  axisTitle,
  checkLogDomain,
  computeYRange,
  describePoint,
  exclusionSummary,
  formatValue,
  highlightedPointIds,
  initialChoice,
  markerSymbol,
  selectionEventFor,
  sortByX,
  yAxisTitle,
} from "./presentation";

function col(id: string, over: Partial<Column> = {}): Column {
  return {
    id,
    label: id,
    semanticRole: "other",
    dataType: "decimal",
    unit: null,
    currency: null,
    percentRepresentation: null,
    datePolicy: null,
    sourceScale: "unknown",
    seriesLabel: null,
    ...over,
  };
}

function pt(rowId: string, x: string | null, y: string | null, over: Partial<ChartPoint> = {}): ChartPoint {
  return {
    pointId: `${rowId}:y`,
    rowId,
    sourceOrder: 0,
    yColumnId: "y",
    xCellId: `${rowId}_x`,
    yCellId: `${rowId}_y`,
    x,
    y,
    provenanceIds: [`p_${rowId}`],
    yOrigin: "parsed",
    ...over,
  };
}

describe("log domain", () => {
  it("accepts strictly positive values and ignores gaps", () => {
    expect(checkLogDomain(["0.001", "12", null]).ok).toBe(true);
  });
  it("refuses zero and negative values with a count instead of dropping them", () => {
    const r = checkLogDomain(["5", "0", "-2", null]);
    expect(r).toMatchObject({ ok: false, nonPositive: 2 });
  });
});

describe("y range", () => {
  it("fit_data pads the observed range", () => {
    expect(computeYRange("fit_data", ["10", "20"], "linear", null).range).toEqual([9.5, 20.5]);
  });
  it("include_zero extends to zero without padding below it", () => {
    const r = computeYRange("include_zero", ["10", "20", null], "linear", null);
    expect(r.range).toEqual([0, 21]);
    expect(r.label).toBe("includes zero");
  });
  it("include_zero with negatives keeps zero as the top", () => {
    expect(computeYRange("include_zero", ["-4", "-2"], "linear", null).range).toEqual([-4.2, 0]);
  });
  it("explicit bounds are labelled with the user's strings and report clipped values", () => {
    const r = computeYRange("explicit_bounds", ["1", "5", "12"], "linear", { min: "0", max: "10.50" });
    expect(r.range).toEqual([0, 10.5]);
    expect(r.label).toBe("axis fixed to 0 – 10.50");
    expect(r.outside).toBe(1);
  });
  it("rejects invalid explicit bounds", () => {
    expect(computeYRange("explicit_bounds", ["1"], "linear", { min: "5", max: "5" }).error).toMatch(/less than/);
    expect(computeYRange("explicit_bounds", ["1"], "linear", { min: "abc", max: "5" }).error).toMatch(/not a number/);
    expect(computeYRange("explicit_bounds", ["1"], "log", { min: "0", max: "5" }).error).toMatch(/greater than zero/);
  });
  it("log ranges are in log10 units and cannot include zero", () => {
    const r = computeYRange("include_zero", ["1", "1000"], "log", null);
    expect(r.range![0]).toBeCloseTo(-0.15);
    expect(r.range![1]).toBeCloseTo(3.15);
    expect(r.notes[0]).toMatch(/cannot include zero/);
  });
  it("a constant series still gets a visible range", () => {
    expect(computeYRange("fit_data", ["0", "0"], "linear", null).range).toEqual([-1, 1]);
  });
});

describe("recharts y domain", () => {
  it("passes linear ranges through and converts log10 units back to data units", () => {
    expect(rechartsYDomain([0, 10], "linear")).toEqual([0, 10]);
    const log = rechartsYDomain([-0.15, 3.15], "log");
    expect(log![0]).toBeCloseTo(10 ** -0.15);
    expect(log![1]).toBeCloseTo(10 ** 3.15);
    expect(rechartsYDomain(null, "log")).toBeNull();
  });
});

describe("recharts x domain", () => {
  it("fits decimal-date values instead of forcing a zero baseline", () => {
    expect(numericXDomain([{ x: 1974.375 }, { x: 2026.7083 }, { x: "May" }])).toEqual([1974.375, 2026.7083]);
  });
  it("leaves category-only series without a numeric domain", () => {
    expect(numericXDomain([{ x: "A" }, { x: "B" }])).toBeNull();
  });
});

describe("units and descriptions", () => {
  const revenue = col("rev", { label: "Revenue", currency: "USD", unit: "million" });
  it("axis titles carry currency, unit and percent representation", () => {
    expect(axisTitle(revenue)).toBe("Revenue (USD million)");
    expect(axisTitle(col("s", { label: "Share", percentRepresentation: "percent_number" }))).toBe("Share (%)");
    expect(axisTitle(col("f", { label: "Share", percentRepresentation: "fraction" }))).toBe("Share (fraction, 1 = 100%)");
  });
  it("flags mixed units across series", () => {
    expect(yAxisTitle([revenue, col("p", { percentRepresentation: "percent_number" })]).mixedUnits).toBe(true);
    expect(yAxisTitle([revenue, col("r2", { currency: "USD", unit: "million" })])).toEqual({ title: "Value (USD million)", mixedUnits: false });
  });
  it("formats values without altering the stored decimal", () => {
    expect(formatValue("12.50", revenue)).toBe("12.50 USD million");
    expect(formatValue("0.125", col("f", { percentRepresentation: "fraction" }))).toBe("0.125 (= 12.5%)");
    expect(formatValue(null, revenue)).toBe("missing");
  });
  it("describes a point in words", () => {
    const p = pt("r4", "2021", "12.5", { yOrigin: "estimated", sourceOrder: 3 });
    expect(describePoint(p, "Revenue", col("year", { dataType: "text" }), revenue)).toBe(
      "Series “Revenue”, source row 4, x = 2021, y = 12.5 USD million, estimated from chart",
    );
    expect(describePoint(pt("r5", "2022", null), "Revenue", undefined, revenue)).toMatch(/y missing \(shown as a gap\)/);
  });
  it("summarizes exclusions and sampling", () => {
    expect(exclusionSummary({ excluded: { missingY: 2, nonNumericY: 1, missingX: 0 }, sampling: null })).toEqual([
      "2 missing values shown as gaps; 1 non-numeric value not plotted.",
    ]);
    const lines = exclusionSummary({ excluded: { missingY: 0, nonNumericY: 0, missingX: 0 }, sampling: { method: "every_nth", keptCount: 10, totalCount: 30 } });
    expect(lines[0]).toMatch(/Showing 10 of 30 points/);
  });
});

describe("ordering and identity", () => {
  it("sorts numeric x by value (not text) and keeps identities", () => {
    const pts = [pt("a", "10", "1"), pt("b", "9", "2"), pt("c", "-1", "3"), pt("d", "9", "4")];
    expect(sortByX(pts, "numeric").map((p) => p.rowId)).toEqual(["c", "b", "d", "a"]);
  });
  it("sorts dates chronologically", () => {
    const pts = [pt("a", "2021-01-01", "1"), pt("b", "2020-06-30", "2")];
    expect(sortByX(pts, "date").map((p) => p.rowId)).toEqual(["b", "a"]);
  });
  it("keeps categories in first-appearance order", () => {
    const pts = [pt("a", "Zeta", "1"), pt("b", "Alpha", "2"), pt("c", "Zeta", "3")];
    expect(sortByX(pts, "category").map((p) => p.rowId)).toEqual(["a", "c", "b"]);
  });
  it("line traces sort by x while carrying the original point ids", () => {
    const pts = [pt("a", "3", "30"), pt("b", "1", null), pt("c", "2", "-5")];
    const traces = buildTraces({
      kind: "line",
      xKind: "numeric",
      series: [{ seriesId: "s", yColumnId: "y", label: "Y", color: "#000000", symbol: "circle", dash: "solid", points: pts }],
      allPoints: pts,
      highlighted: new Set(["c:y"]),
      focusPointId: null,
      describe: () => "",
    }) as Array<{ x: unknown[]; y: unknown[]; customdata: unknown[]; selectedpoints?: number[]; connectgaps?: boolean; name?: string }>;
    expect(traces[0].x).toEqual([1, 2, 3]);
    expect(traces[0].y).toEqual([null, -5, 30]);
    expect(traces[0].customdata).toEqual(["b:y", "c:y", "a:y"]);
    expect(traces[0].selectedpoints).toEqual([1]);
    expect(traces[0].connectgaps).toBe(false);
    expect(traces[1].name).toMatch(/Missing/);
    expect(traces[1].customdata).toEqual(["b:y"]);
  });
  it("marks estimated and edited points with distinct symbols", () => {
    expect(markerSymbol("square", "estimated")).toBe("square-open");
    expect(markerSymbol("square", "user_edit")).toBe("square-open-dot");
    expect(markerSymbol("square", "parsed")).toBe("square");
  });
});

describe("linked selection", () => {
  const a = pt("r1", "1", "1");
  const b = { ...pt("r1", "1", "2"), pointId: "r1:z", yColumnId: "z", yCellId: "r1_z" };
  const c = pt("r2", "2", "3");
  const base: SelectionEvent = { origin: "grid", datasetVersionId: "v1", rowIds: [], cellIds: [], provenanceIds: [] };

  it("prefers exact y-cell matches over whole rows", () => {
    expect([...highlightedPointIds([a, b, c], { ...base, rowIds: ["r1"], cellIds: ["r1_z"] }, "v1")]).toEqual(["r1:z"]);
  });
  it("falls back to rows", () => {
    expect([...highlightedPointIds([a, b, c], { ...base, rowIds: ["r1"] }, "v1")]).toEqual(["r1:y", "r1:z"]);
  });
  it("ignores selections from another version", () => {
    expect(highlightedPointIds([a], { ...base, rowIds: ["r1"], datasetVersionId: "v0" }, "v1").size).toBe(0);
  });
  it("matches source selections by provenance", () => {
    expect([...highlightedPointIds([a, c], { ...base, origin: "source", provenanceIds: ["p_r2"] }, "v1")]).toEqual(["r2:y"]);
  });
  it("emits row, y+x cell and provenance ids for chart selections", () => {
    expect(selectionEventFor([a, b], "v1")).toEqual({
      origin: "chart",
      datasetVersionId: "v1",
      rowIds: ["r1"],
      cellIds: ["r1_y", "r1_z", "r1_x"],
      provenanceIds: ["p_r1"],
    });
  });
});

describe("initial choice", () => {
  it("uses semantic roles first", () => {
    const cols = [col("label", { dataType: "text" }), col("yr", { semanticRole: "x" }), col("v", { semanticRole: "y" }), col("w")];
    expect(initialChoice(cols)).toEqual({ xColumnId: "yr", yColumnIds: ["v"] });
  });
  it("falls back to a date x and decimal series", () => {
    const cols = [col("d", { dataType: "date" }), col("a"), col("t", { dataType: "text" }), col("b")];
    expect(initialChoice(cols)).toEqual({ xColumnId: "d", yColumnIds: ["a", "b"] });
  });
});
