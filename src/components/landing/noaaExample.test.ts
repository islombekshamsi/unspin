import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NOAA_AVERAGE_MAY_DEC_1974, NOAA_AVERAGE_PLOT, NOAA_COMPARE_ROWS, NOAA_PREVIEW_ROWS, NOAA_SOURCE_HEADER, NOAA_SOURCE_ROWS, noaaPlotY } from "./noaaExample";

const EXCERPT = "evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv";

describe("landing NOAA source lines", () => {
  const lines = readFileSync(EXCERPT, "utf8").split(/\n/);
  const headerAt = lines.findIndex((line) => line === NOAA_SOURCE_HEADER);

  it("uses the excerpt header and lines 42–49 verbatim", () => {
    expect(headerAt).toBe(40);
    expect(lines[headerAt]).toBe(NOAA_SOURCE_HEADER);
    expect(NOAA_SOURCE_ROWS).toHaveLength(8);
    NOAA_SOURCE_ROWS.forEach((row, index) => {
      expect(lines[headerAt + 1 + index]).toBe(row.text);
      expect(row.line).toBe(42 + index);
    });
  });

  it("parses those same lines into the preview and comparison rows", () => {
    NOAA_SOURCE_ROWS.slice(0, 3).forEach((row, index) => {
      const [year, month, decimalDate, average, deseasonalized] = row.text.split(",");
      expect(NOAA_PREVIEW_ROWS[index]).toMatchObject({ line: row.line, year, month, decimalDate, average, deseasonalized });
    });
    NOAA_COMPARE_ROWS.forEach((row, index) => {
      expect(row.average).toBe(NOAA_AVERAGE_MAY_DEC_1974[index]?.average);
      expect(row.label).toBe(NOAA_AVERAGE_MAY_DEC_1974[index]?.month);
      const fields = NOAA_SOURCE_ROWS[index]?.text.split(",");
      expect(row.average).toBe(fields?.[3]);
      expect(row.deseasonalized).toBe(fields?.[4]);
    });
    NOAA_AVERAGE_PLOT.forEach((point) => {
      expect(noaaPlotY(point.average)).toBe(point.y);
    });
  });
});
