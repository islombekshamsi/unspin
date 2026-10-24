/**
 * UNSPIN arm of T1: upload the NOAA chart PNG, extract the plot area with consent,
 * write a candidate long CSV, then export. Does not read the reference key.
 *
 *   BASE_URL=http://localhost:3107 node evaluation/scripts/run-t1-unspin.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "evaluation/results");
const PNG = join(ROOT, "evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png");
const BASE = (process.env.BASE_URL ?? "http://localhost:3107").replace(/\/$/, "");

/** Plot area of the 800×600 NOAA chart, excluding title and rotated date stamp. */
const REGION = { x: 0.06, y: 0.13, width: 0.86, height: 0.78 };
const PIXEL_BOX = {
  left: Math.round(800 * REGION.x),
  top: Math.round(600 * REGION.y),
  width: Math.round(800 * REGION.width),
  height: Math.round(600 * REGION.height),
};
const HINT = "Two series, 2021-2026 monthly CO2 ppm: red circles monthly mean; black squares deseasonalized.";

mkdirSync(join(OUT, "T1"), { recursive: true });

const cookies = new Map();
function cookieHeader() {
  return cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {};
}
function absorb(res) {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [pair] = sc.split(";");
    const i = pair.indexOf("=");
    if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function call(path, init = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: { ...cookieHeader(), ...(init.headers ?? {}) },
    redirect: "manual",
  });
  absorb(res);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = body?.error?.message ?? text.slice(0, 240);
    throw new Error(`HTTP ${res.status} ${path}: ${msg}`);
  }
  return body;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function cellText(cell) {
  if (!cell || cell.currentValue === null || cell.currentValue === undefined) return "";
  return String(cell.currentValue);
}

function melt(columns, rows) {
  const xCol =
    columns.find((c) => /date|month|year|time|x/i.test(c.label)) ??
    columns.find((c) => c.semanticRole === "x") ??
    columns[0];
  const yCols = columns.filter((c) => c.id !== xCol?.id && (c.dataType === "decimal" || /mean|average|deseason|black|red|value|ppm/i.test(c.label)));
  const seriesCols = yCols.length ? yCols : columns.filter((c) => c.id !== xCol?.id);
  const out = [];
  for (const row of rows) {
    const x = cellText(row.cells[xCol.id]);
    for (const yc of seriesCols) {
      out.push({
        x,
        series: yc.seriesLabel || yc.label,
        y: cellText(row.cells[yc.id]),
        origin: row.cells[yc.id]?.origin ?? "",
      });
    }
  }
  return { xCol, seriesCols, long: out };
}

const bytes = readFileSync(PNG);
const tStart = new Date();
const log = {
  t_start_utc: tStart.toISOString(),
  input_sha256: sha256(bytes),
  crop_normalized: REGION,
  crop_pixel_box: PIXEL_BOX,
  hint: HINT,
  base: BASE,
};

const health = await call("/health");
const gemini = health.health?.capabilities?.gemini ?? health.capabilities?.gemini;
log.gemini_configured = Boolean(gemini?.configured);
log.gemini_model = gemini?.model ?? null;
if (!gemini?.configured) {
  writeFileSync(join(OUT, "T1/run.json"), JSON.stringify({ ...log, outcome: "blocked", reason: "gemini_not_configured" }, null, 2));
  console.error("Gemini is not configured; T1 extraction not started.");
  process.exit(2);
}

const fd = new FormData();
fd.set("file", new File([bytes], "noaa-gml-co2-trend-mlo-2026-10-09.png", { type: "image/png" }));
const uploaded = await call("/sources", { method: "POST", body: fd });
const source = uploaded.source;
log.sourceId = source.id;
log.source_sha256 = source.sha256;
log.image = source.image;

const selectionBody = await call("/selections", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sourceId: source.id,
    selection: { kind: "image_region", region: REGION, userHint: HINT },
  }),
});
const selection = selectionBody.selection;
log.selectionId = selection.id;
log.resolved_region = selection.region ?? selection.resolvedRegion ?? null;

const tExtract = new Date();
const started = await call("/extractions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ selectionId: selection.id, consentToExternalProcessing: true }),
});
let job = started.job;
log.jobId = job.id;
log.extraction_started_utc = tExtract.toISOString();

const deadline = Date.now() + 200_000;
while (job.status === "queued" || job.status === "running") {
  if (Date.now() > deadline) throw new Error(`job still ${job.status}/${job.stage} after 200s`);
  const wait = Math.min(job.pollAfterMs ?? 2000, 5000);
  await new Promise((r) => setTimeout(r, wait));
  const polled = await call(`/jobs/${job.id}`);
  job = polled.job;
  job.pollAfterMs = polled.pollAfterMs;
  console.log(`job ${job.status} ${job.stage} attempt=${job.attemptCount}`);
}

log.job_status = job.status;
log.job_stage = job.stage;
log.attemptCount = job.attemptCount;
log.job_error = job.error;
log.finishedAt = job.finishedAt;
log.t_first_candidate_utc = job.finishedAt ?? new Date().toISOString();
log.extraction_seconds = (new Date(log.t_first_candidate_utc) - tStart) / 1000;

if (job.status !== "completed" || !job.resultDatasetId) {
  writeFileSync(join(OUT, "T1/run.json"), JSON.stringify({ ...log, outcome: "failed" }, null, 2));
  console.error("Extraction did not complete:", job.status, job.error);
  process.exit(1);
}

const datasetId = job.resultDatasetId;
log.datasetId = datasetId;
const detail = await call(`/datasets/${datasetId}`);
const dataset = detail.dataset;
const version = detail.version;
log.coverage = dataset.coverage;
log.extractionMethod = dataset.extractionMethod;
log.rowCount = version.rowCount;
log.columns = version.columns.map((c) => ({ id: c.id, label: c.label, dataType: c.dataType, seriesLabel: c.seriesLabel }));

if (dataset.coverage !== "complete_selection") {
  await call(`/datasets/${datasetId}/coverage-ack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedVersionId: version.id, acknowledged: true }),
  });
  log.coverageAcknowledged = true;
}

const rows = [];
let cursor = undefined;
for (;;) {
  const qs = new URLSearchParams({ versionId: version.id, limit: "200" });
  if (cursor) qs.set("cursor", cursor);
  const page = await call(`/datasets/${datasetId}/rows?${qs}`);
  rows.push(...page.rows);
  if (!page.nextCursor) break;
  cursor = page.nextCursor;
}
log.fetchedRows = rows.length;

const melted = melt(version.columns, rows);
const longCsv = ["x,series,y,origin", ...melted.long.map((r) => `${r.x},${JSON.stringify(r.series)},${r.y},${r.origin}`)].join("\n") + "\n";
writeFileSync(join(OUT, "T1/candidate-long.csv"), longCsv);
writeFileSync(
  join(OUT, "T1/candidate-preview.json"),
  JSON.stringify(
    {
      columns: log.columns,
      first3: melted.long.slice(0, 6),
      last3: melted.long.slice(-6),
      n: melted.long.length,
    },
    null,
    2,
  ),
);

const exported = await call(`/datasets/${datasetId}/exports`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    versionId: version.id,
    formats: ["csv", "json", "manifest"],
    scope: { kind: "full" },
    acknowledgePartial: dataset.coverage !== "complete_selection",
  }),
});
log.t_verified_export_utc = new Date().toISOString();
log.end_to_end_seconds = (new Date(log.t_verified_export_utc) - tStart) / 1000;
log.exportId = exported.export.id;
log.exportFiles = [];
for (const f of exported.export.files) {
  const dest = join(OUT, "T1", f.filename.replace(/[^\w.-]+/g, "_"));
  writeFileSync(dest, f.content);
  log.exportFiles.push({ filename: f.filename, path: dest, sha256: sha256(f.content), bytes: Buffer.byteLength(f.content) });
}

log.outcome = "extracted_exported";
log.looked_at_key_before_export = false;
writeFileSync(join(OUT, "T1/run.json"), JSON.stringify(log, null, 2));
console.log(JSON.stringify({ outcome: log.outcome, extraction_seconds: log.extraction_seconds, rows: log.rowCount, columns: log.columns.map((c) => c.label) }, null, 2));
