import type { TableSpec } from "./fixtures";
import { COMMITTED, noaaDataRows, readInput } from "./real-inputs";

/**
 * Real rows from the committed NOAA GML excerpt (manifest noaa-co2-mm-mlo-csv-2026-10).
 * `pick` selects data rows by (year, month) so tests can include the genuine
 * negative-sentinel rows (1975-12, 1984-04) alongside ordinary ones.
 */
export function noaaTable(pick: Array<[number, number]>): TableSpec {
  const all = noaaDataRows();
  const rows = pick.map(([y, m]) => {
    const r = all.find((f) => Number(f[0]) === y && Number(f[1]) === m);
    if (!r) throw new Error(`NOAA excerpt has no row ${y}-${m}`);
    return r;
  });
  return {
    title: "Mauna Loa CO2 monthly mean (NOAA GML)",
    filename: "noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv",
    sourceBytes: readInput(COMMITTED.noaaCo2Excerpt),
    columns: [
      { label: "year", dataType: "text", semanticRole: "x" },
      { label: "month", dataType: "text", semanticRole: "x" },
      { label: "decimal date", dataType: "decimal", semanticRole: "x" },
      { label: "average", dataType: "decimal", unit: "ppm" },
      { label: "deseasonalized", dataType: "decimal", unit: "ppm" },
      { label: "ndays", dataType: "decimal" },
      { label: "sdev", dataType: "decimal", unit: "ppm" },
      { label: "unc", dataType: "decimal", unit: "ppm" },
    ],
    rows,
  };
}

/** Six consecutive months including one genuine sentinel row (1975-12: ndays -1, sdev -9.99). */
export const NOAA_SAMPLE: Array<[number, number]> = [
  [1975, 9],
  [1975, 10],
  [1975, 11],
  [1975, 12],
  [1976, 1],
  [1976, 2],
];
