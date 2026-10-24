import { describe, expect, it } from "vitest";
import type { ChartPoint, Column } from "@/contracts";
import { checkCompatibility, type SeriesFacts } from "./compatibility";
import { indexSeries, sharedBaseCandidates } from "./indexing";

function col(over: Partial<Column> = {}): Column {
  return {
    id: "c",
    label: "c",
    semanticRole: "y",
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

function facts(label: string, over: Partial<SeriesFacts> = {}): SeriesFacts {
  return {
    label,
    xColumn: col({ dataType: "date" }),
    yColumn: col({ currency: "USD" }),
    xKind: "date",
    xValues: ["2020-01-31", "2020-12-31"],
    plottable: 2,
    measure: "price",
    aggregation: "end_of_period",
    ...over,
  };
}

const status = (r: ReturnType<typeof checkCompatibility>, id: string) => r.checks.find((c) => c.id === id)?.status;

describe("checkCompatibility", () => {
  it("accepts matching series", () => {
    const r = checkCompatibility([facts("A"), facts("B")], { indexed: false });
    expect(r.status).toBe("compatible");
    expect(r.needs).toEqual([]);
  });

  it("requires the user to state measure and aggregation", () => {
    const r = checkCompatibility([facts("A", { measure: "unknown" }), facts("B", { aggregation: "unknown" })], { indexed: false });
    expect(r.status).toBe("unknown");
    expect(r.needs.join(" ")).toMatch(/State what “A” measures/);
    expect(r.needs.join(" ")).toMatch(/aggregated/);
    const both = checkCompatibility([facts("A", { measure: "unknown" }), facts("B", { measure: "unknown" })], { indexed: false });
    expect(both.needs.join(" ")).toMatch(/State what “A”, “B” measure \(/);
  });

  it("accepts amounts such as revenue but refuses amount vs average", () => {
    const amounts = [facts("A", { measure: "amount", aggregation: "period_total" }), facts("B", { measure: "amount", aggregation: "period_total" })];
    expect(checkCompatibility(amounts, { indexed: false }).status).toBe("compatible");
    const mixed = checkCompatibility([amounts[0], facts("B", { measure: "average", aggregation: "period_total" })], { indexed: false });
    expect(status(mixed, "measure")).toBe("incompatible");
  });

  it("never treats price as total return", () => {
    const r = checkCompatibility([facts("A"), facts("B", { measure: "total_return" })], { indexed: true });
    expect(r.status).toBe("incompatible");
    expect(r.checks.find((c) => c.id === "measure")?.message).toMatch(/dividends/);
  });

  it("refuses different currencies even when indexed", () => {
    const r = checkCompatibility([facts("A"), facts("B", { yColumn: col({ currency: "EUR" }) })], { indexed: true });
    expect(status(r, "currency")).toBe("incompatible");
    expect(r.status).toBe("incompatible");
  });

  it("asks for a missing currency instead of assuming one", () => {
    const r = checkCompatibility([facts("A"), facts("B", { yColumn: col() })], { indexed: false });
    expect(status(r, "currency")).toBe("unknown");
  });

  it("blocks different units unless indexed", () => {
    const a = facts("A", { yColumn: col({ currency: "USD", unit: "million" }) });
    const b = facts("B", { yColumn: col({ currency: "USD", unit: "thousand" }) });
    expect(status(checkCompatibility([a, b], { indexed: false }), "unit")).toBe("incompatible");
    expect(status(checkCompatibility([a, b], { indexed: true }), "unit")).toBe("warning");
  });

  it("refuses mixed percent representations", () => {
    const r = checkCompatibility(
      [facts("A", { yColumn: col({ currency: "USD", percentRepresentation: "fraction" }) }), facts("B", { yColumn: col({ currency: "USD", percentRepresentation: "percent_number" }) })],
      { indexed: true },
    );
    expect(status(r, "percent")).toBe("incompatible");
  });

  it("refuses different x kinds", () => {
    const r = checkCompatibility([facts("A"), facts("B", { xKind: "numeric", xValues: ["1", "2"] })], { indexed: false });
    expect(status(r, "x_kind")).toBe("incompatible");
  });

  it("refuses non-overlapping periods and reports partial overlap", () => {
    const none = checkCompatibility([facts("A"), facts("B", { xValues: ["2022-01-31", "2022-12-31"] })], { indexed: false });
    expect(status(none, "period")).toBe("incompatible");
    const partial = checkCompatibility([facts("A"), facts("B", { xValues: ["2020-06-30", "2021-06-30"] })], { indexed: false });
    expect(status(partial, "period")).toBe("warning");
    expect(partial.checks.find((c) => c.id === "period")?.message).toMatch(/2020-06-30 – 2020-12-31/);
    expect(partial.status).toBe("compatible");
  });

  it("needs two series", () => {
    expect(checkCompatibility([facts("A")], { indexed: false }).status).toBe("unknown");
  });
});

function pt(rowId: string, x: string, y: string | null): ChartPoint {
  return { pointId: `${rowId}:y`, rowId, yColumnId: "y", xCellId: `${rowId}x`, yCellId: `${rowId}y`, x, y, provenanceIds: [], yOrigin: "parsed" };
}

describe("indexing", () => {
  it("computes value / base * 100 exactly and keeps gaps", () => {
    const r = indexSeries([pt("a", "2020", "245.10"), pt("b", "2021", "300"), pt("c", "2022", null), pt("d", "2023", "0.1")], "2020");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.base).toBe("245.10");
    expect(r.baseRowId).toBe("a");
    expect(r.points.map((p) => p.y)).toEqual(["100", "122.399021", null, "0.0408"]);
    expect(r.points.map((p) => p.pointId)).toEqual(["a:y", "b:y", "c:y", "d:y"]);
  });

  it("avoids binary floating point error", () => {
    const r = indexSeries([pt("a", "1", "0.3"), pt("b", "2", "0.1")], "1");
    expect(r.ok && r.points[1].y).toBe("33.333333");
  });

  it("refuses missing, zero, negative and ambiguous bases", () => {
    expect(indexSeries([pt("a", "1", null)], "1")).toMatchObject({ ok: false });
    expect(indexSeries([pt("a", "1", "0")], "1")).toMatchObject({ ok: false, message: expect.stringMatching(/positive/) });
    expect(indexSeries([pt("a", "1", "-5")], "1")).toMatchObject({ ok: false });
    expect(indexSeries([pt("a", "1", "5"), pt("b", "1", "6")], "1")).toMatchObject({ ok: false, message: expect.stringMatching(/ambiguous/) });
    expect(indexSeries([pt("a", "1", "5")], "2")).toMatchObject({ ok: false, message: expect.stringMatching(/no observation/) });
  });

  it("offers only x values observed once in every series", () => {
    const a = [pt("a1", "2020", "1"), pt("a2", "2021", "2"), pt("a3", "2022", "3"), pt("a4", "2022", "4")];
    const b = [pt("b1", "2020", "1"), pt("b2", "2021", null), pt("b3", "2022", "3")];
    expect(sharedBaseCandidates([a, b])).toEqual(["2020"]);
  });
});
