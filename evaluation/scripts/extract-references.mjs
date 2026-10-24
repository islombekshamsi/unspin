#!/usr/bin/env node
// Extracts author-provided reference values from committed source files into
// evaluation/reference/*.csv. Values are copied verbatim as text; nothing is
// estimated, rounded, interpolated, or digitized. Re-run after re-fetching inputs:
//   node evaluation/scripts/extract-references.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

function writeCsv(name, header, rows) {
  const out = [header.join(","), ...rows.map((r) => r.join(","))].join("\n") + "\n";
  writeFileSync(join(root, "reference", name), out);
  console.log(`wrote reference/${name} (${rows.length} rows)`);
}

// NOAA GML Mauna Loa monthly CO2: rows plotted in co2_trend_mlo.png (2021-01 .. 2026-09).
{
  const p = join(root, "inputs", "noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv");
  console.log(`input ${p} sha256=${sha256(p)}`);
  const lines = readFileSync(p, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
  const [header, ...data] = lines;
  if (header !== "year,month,decimal date,average,deseasonalized,ndays,sdev,unc") {
    throw new Error(`Unexpected NOAA header: ${header}`);
  }
  const rows = data
    .map((l) => l.split(","))
    .filter(([y]) => Number(y) >= 2021)
    .map(([year, month, , average, deseasonalized, ndays, sdev, unc]) => [year, month, average, deseasonalized, ndays, sdev, unc]);
  writeCsv(
    "noaa-co2-trend-mlo-2021-01_2026-09.reference.csv",
    ["year", "month", "average_ppm", "deseasonalized_ppm", "ndays", "sdev_ppm", "unc_ppm"],
    rows,
  );
}

// EIA STEO October 2026, sheet 2tab, series WTIPUUS (West Texas Intermediate spot average, dollars per barrel).
{
  const p = join(root, "inputs", "eia-steo-2026-10-base.xlsx");
  console.log(`input ${p} sha256=${sha256(p)}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(p);
  const dates = wb.getWorksheet("Dates");
  const lastHist = cellValue(dates.getCell("D7"));
  const ws = wb.getWorksheet("2tab");
  let rowNum = null;
  ws.eachRow((row, r) => {
    if (cellValue(row.getCell(1)) === "WTIPUUS") rowNum = r;
  });
  if (!rowNum) throw new Error("WTIPUUS row not found in 2tab");
  const label = cellValue(ws.getCell(rowNum, 2));
  const unitRow = cellValue(ws.getCell(rowNum - 1, 2));
  const out = [];
  for (let c = 3; c <= ws.columnCount; c++) {
    const year = cellValue(ws.getCell(3, c));
    const mon = cellValue(ws.getCell(4, c));
    const v = cellValue(ws.getCell(rowNum, c));
    if (typeof year !== "number" || typeof mon !== "string") continue;
    const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(mon) + 1;
    if (m === 0) continue;
    const ym = year * 100 + m;
    out.push([
      `${year}-${String(m).padStart(2, "0")}`,
      v === null || v === undefined ? "" : String(v),
      ym <= lastHist ? "historical" : "forecast",
      ws.getCell(rowNum, c).address,
    ]);
  }
  console.log(`WTIPUUS label="${label}" unit-row="${unitRow}" lastHistorical=${lastHist}`);
  writeCsv("eia-steo-2026-10-wtipuus-monthly.reference.csv", ["month", "wti_spot_usd_per_barrel", "status", "source_cell"], out);
}

function cellValue(cell) {
  const v = cell.value;
  if (v && typeof v === "object") {
    if ("result" in v) return v.result;
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
  }
  return v;
}
