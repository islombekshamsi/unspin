import { describe, expect, it } from "vitest";
import type { Column } from "@/contracts";
import { parseStoredChartSettings } from "./chart-settings";

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

const columns = [col("decimal date"), col("average"), col("deseasonalized"), col("year")];

describe("stored chart settings", () => {
  it("restores a valid choice and drops columns that no longer exist", () => {
    const stored = parseStoredChartSettings(
      {
        xColumnId: "decimal date",
        yColumnIds: ["average", "gone", "deseasonalized"],
        hidden: ["gone", "deseasonalized"],
        kind: "line",
        scale: "linear",
        baseline: "fit_data",
        bounds: { min: "330", max: "340" },
      },
      columns,
    );
    expect(stored).toMatchObject({
      xColumnId: "decimal date",
      yColumnIds: ["average", "deseasonalized"],
      hidden: ["deseasonalized"],
      kind: "line",
      baseline: "fit_data",
      bounds: { min: "330", max: "340" },
    });
  });

  it("falls back to the default choice when the stored x column is gone", () => {
    const stored = parseStoredChartSettings({ xColumnId: "missing", yColumnIds: ["also-gone"], kind: "bar" }, columns);
    expect(stored?.xColumnId).toBe("decimal date");
    expect(stored?.yColumnIds).toEqual(["average"]);
    expect(stored?.kind).toBe("bar");
  });

  it("ignores malformed payloads instead of crashing", () => {
    expect(parseStoredChartSettings(null, columns)).toBeNull();
    expect(parseStoredChartSettings("nope", columns)).toBeNull();
    expect(parseStoredChartSettings({ kind: "pie", scale: "weird" }, columns)?.kind).toBeNull();
  });
});
