/**
 * Score an exported UNSPIN T1 CSV against the author-provided NOAA key.
 * Run only after the reviewed export exists.
 *
 *   node evaluation/scripts/score-noaa-t1.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const KEY = join(ROOT, "evaluation/reference/noaa-co2-trend-mlo-2021-01_2026-09.reference.csv");
const EXPORT_CSV = join(ROOT, "evaluation/results/T1/Line-chart-from-noaa-gml-co2-trend-mlo-2026-10-09.png.csv");
const RUN = join(ROOT, "evaluation/results/T1/run.json");
const AXIS_SPAN = 20; // ppm, 412.5..432.5
const TOLERANCE = 0.01; // of axis span → 0.2 ppm

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = line.split(",");
    const row = {};
    header.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    return row;
  });
}

function ym(year, month) {
  return `${year}-${String(Number(month)).padStart(2, "0")}`;
}

function seriesKey(label) {
  const n = label.trim().toLowerCase();
  if (/deseason/.test(n)) return "deseasonalized";
  if (/average|monthly mean|monthly_mean|red/.test(n)) return "average";
  return n;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const keyRows = parseCsv(readFileSync(KEY, "utf8"));
const key = new Map();
for (const r of keyRows) {
  const x = ym(r.year, r.month);
  key.set(`${x}|average`, { x, series: "average", y: Number(r.average_ppm) });
  key.set(`${x}|deseasonalized`, { x, series: "deseasonalized", y: Number(r.deseasonalized_ppm) });
}

const exported = parseCsv(readFileSync(EXPORT_CSV, "utf8"));
const extracted = [];
for (const r of exported) {
  const x = r.Date || r.x;
  if (!x) continue;
  if (r["Monthly mean"] !== undefined || r.Deseasonalized !== undefined) {
    extracted.push({ x, series: "average", y: r["Monthly mean"] === "" ? null : Number(r["Monthly mean"]) });
    extracted.push({ x, series: "deseasonalized", y: r.Deseasonalized === "" ? null : Number(r.Deseasonalized) });
  } else {
    const s = seriesKey(r.series || "");
    extracted.push({ x, series: s, y: r.y === "" ? null : Number(r.y) });
  }
}

const extractedKeys = new Set(extracted.map((e) => `${e.x}|${e.series}`));
const abs = [];
const pairErrors = [];
let matched = 0;
let missing = 0;
let extra = 0;
let wrongSeries = 0;
let disclosedGaps = 0;
let relativeUndefined = 0;
let dateErrors = 0;

for (const [k, ref] of key) {
  const hit = extracted.find((e) => `${e.x}|${e.series}` === k);
  if (!hit) {
    missing += 1;
    continue;
  }
  if (hit.y === null || Number.isNaN(hit.y)) {
    disclosedGaps += 1;
    continue;
  }
  matched += 1;
  const err = Math.abs(hit.y - ref.y);
  abs.push(err);
  pairErrors.push({ x: ref.x, series: ref.series, extracted: hit.y, reference: ref.y, abs_error: err, normalized_error: err / AXIS_SPAN });
  if (ref.y === 0) relativeUndefined += 1;
  const otherSeries = ref.series === "average" ? "deseasonalized" : "average";
  const other = key.get(`${ref.x}|${otherSeries}`);
  if (other && Math.abs(hit.y - other.y) + 1e-12 < err - 0.2) wrongSeries += 1;
}

for (const e of extracted) {
  if (!key.has(`${e.x}|${e.series}`)) extra += 1;
}

const sorted = [...abs].sort((a, b) => a - b);
const within = abs.filter((e) => e / AXIS_SPAN <= TOLERANCE).length;

const run = JSON.parse(readFileSync(join(ROOT, "evaluation/results/T1/run.json"), "utf8"));
const summary = {
  extracted_rows_long: extracted.length,
  exported_table_rows: exported.length,
  matched,
  missing,
  extra,
  unreferenced: 0,
  wrong_series: wrongSeries,
  disclosed_gaps: disclosedGaps,
  abs_error_median: median(sorted),
  abs_error_p90: percentile(sorted, 90),
  abs_error_max: sorted.length ? sorted[sorted.length - 1] : null,
  error_units: "ppm",
  normalized_error_denominator: AXIS_SPAN,
  within_tolerance_n: within,
  within_tolerance_share: matched ? within / matched : null,
  tolerance_declared: "normalized_error <= 0.01 of 20 ppm (0.2 ppm)",
  relative_error_undefined: relativeUndefined,
  date_errors: dateErrors,
  extraction_seconds: run.extraction_seconds,
  end_to_end_seconds: run.end_to_end_seconds,
  looked_at_key_before_export: run.looked_at_key_before_export,
};

writeFileSync(join(ROOT, "evaluation/results/T1/score.json"), JSON.stringify({ summary, pairErrors }, null, 2));
console.log(JSON.stringify(summary, null, 2));
void extractedKeys;
