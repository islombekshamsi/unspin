/**
 * Durable-mode restart acceptance. Two phases; the same guest cookie and IDs
 * must work after the web process and worker are killed and started again.
 *
 *   BASE_URL=http://localhost:3110 node evaluation/scripts/run-durable-restart.mjs before
 *   # restart web + worker
 *   BASE_URL=http://localhost:3110 node evaluation/scripts/run-durable-restart.mjs after
 *
 * Optional: DURABLE_OUT=evaluation/results/dev-durable UNSPIN_STORAGE_ROOT=.data/blobs
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.DURABLE_OUT
  ? join(ROOT, process.env.DURABLE_OUT)
  : join(ROOT, "evaluation/results/durable");
const STATE = join(OUT, "checkpoint.json");
const CSV = join(ROOT, "evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv");
const BASE = (process.env.BASE_URL ?? "http://localhost:3110").replace(/\/$/, "");
const BLOB_ROOT = process.env.UNSPIN_STORAGE_ROOT ?? join(ROOT, ".data/core-finish-blobs");
const phase = process.argv[2];

mkdirSync(OUT, { recursive: true });

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
function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function walkFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, acc);
    else acc.push({ path: p, bytes: st.size, mode: (st.mode & 0o777).toString(8) });
  }
  return acc;
}

async function raw(path, init = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: { ...cookieHeader(), ...(init.headers ?? {}) },
    redirect: "manual",
  });
  absorb(res);
  return res;
}

async function call(path, init = {}) {
  const res = await raw(path, init);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path}: ${body?.error?.message ?? text.slice(0, 240)}`);
  }
  return { res, body, text };
}

async function fetchBytes(path) {
  const res = await raw(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return Buffer.from(await res.arrayBuffer());
}

async function pollJob(id) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const { body } = await call(`/jobs/${id}`);
    const job = body.job;
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") return job;
    if (Date.now() > deadline) throw new Error(`job still ${job.status}/${job.stage}`);
    await new Promise((r) => setTimeout(r, Math.min(body.pollAfterMs ?? 500, 2000)));
  }
}

function loadState() {
  const s = JSON.parse(readFileSync(STATE, "utf8"));
  if (s.cookie) cookies.set("unspin_guest", s.cookie);
  return s;
}

function persistState(s) {
  const cookie = cookies.get("unspin_guest") ?? s.cookie ?? null;
  writeFileSync(STATE, JSON.stringify({ ...s, cookieSet: Boolean(cookie), cookie }, null, 2));
}

async function phaseBefore() {
  const health = (await call("/health")).body.health;
  const p = health.capabilities.persistence;
  const blobs = health.capabilities.blobStorage;
  const jobs = health.capabilities.jobs;
  if (!p.durable || p.mode !== "postgres" || blobs.mode !== "filesystem") {
    throw new Error(`not durable: persistence=${JSON.stringify(p)} blobs=${JSON.stringify(blobs)} jobs=${JSON.stringify(jobs)}`);
  }
  const bytes = readFileSync(CSV);
  const fd = new FormData();
  fd.set("file", new File([bytes], "noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv", { type: "text/csv" }));
  const source = (await call("/sources", { method: "POST", body: fd })).body.source;
  const selection = (
    await call("/selections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceId: source.id,
        selection: {
          kind: "csv_records",
          delimiter: ",",
          headerRecordCount: 1,
          skipLeadingRecords: 40,
          selectedColumnIndexes: null,
          recordInterval: null,
        },
      }),
    })
  ).body.selection;
  const started = (
    await call("/extractions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selectionId: selection.id, consentToExternalProcessing: false }),
    })
  ).body.job;
  const job = await pollJob(started.id);
  if (job.status !== "completed" || !job.resultDatasetId) throw new Error(`import failed: ${JSON.stringify(job.error)}`);
  const detail = (await call(`/datasets/${job.resultDatasetId}`)).body;
  const avg = detail.version.columns.find((c) => c.label === "average");
  const page = (await call(`/datasets/${detail.dataset.id}/rows?versionId=${detail.version.id}&limit=5`)).body;
  const row = page.rows[0];
  const cell = row.cells[avg.id];
  if (cell.currentValue !== "333.19") throw new Error(`expected first average 333.19, got ${cell.currentValue}`);
  const preview = (
    await call(`/datasets/${detail.dataset.id}/transforms/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersionId: detail.version.id,
        operation: {
          type: "edit_cell",
          rowId: row.id,
          columnId: avg.id,
          cellId: cell.id,
          newValue: "333.20",
          explicitType: "decimal",
          missingReason: null,
          note: "Durable restart check against NOAA source text.",
        },
      }),
    })
  ).body.preview;
  const applied = (
    await call(`/datasets/${detail.dataset.id}/transforms/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersionId: preview.baseVersionId,
        operation: preview.operation,
        operationHash: preview.operationHash,
      }),
    })
  ).body;
  const stored = await fetchBytes(`/sources/${source.id}/content`);
  const blobFiles = walkFiles(BLOB_ROOT);
  const state = {
    phase: "before",
    health: { persistence: p, blobStorage: blobs, jobs },
    sourceId: source.id,
    selectionId: selection.id,
    datasetId: detail.dataset.id,
    v1: detail.version.id,
    v2: applied.version.id,
    jobId: job.id,
    inputSha256: sha256(bytes),
    storedSha256: sha256(stored),
    storedBytes: stored.length,
    blobFileCount: blobFiles.length,
    blobFiles: blobFiles.map((f) => ({ rel: f.path.slice(BLOB_ROOT.length), bytes: f.bytes, mode: f.mode })),
    firstAverageAfterEdit: applied.version.id,
  };
  persistState(state);
  writeFileSync(join(OUT, "before.json"), JSON.stringify({ ...state, cookie: undefined }, null, 2));
  console.log(JSON.stringify({ phase: "before", durable: true, sourceId: source.id, datasetId: detail.dataset.id, v1: detail.version.id, v2: applied.version.id, blobFileCount: blobFiles.length, shaMatch: state.inputSha256 === state.storedSha256 }, null, 2));
}

async function phaseAfter() {
  const s = loadState();
  const health = (await call("/health")).body.health;
  const p = health.capabilities.persistence;
  if (!p.durable || !p.ready) throw new Error(`after restart not durable/ready: ${JSON.stringify(p)}`);
  const source = (await call(`/sources/${s.sourceId}`)).body.source;
  const selection = (await call(`/selections/${s.selectionId}`)).body.selection;
  const detail = (await call(`/datasets/${s.datasetId}`)).body;
  const hist = (await call(`/datasets/${s.datasetId}/history`)).body;
  const stored = await fetchBytes(`/sources/${s.sourceId}/content`);
  const blobFiles = walkFiles(BLOB_ROOT);
  const avg = detail.version.columns.find((c) => c.label === "average");
  const page = (await call(`/datasets/${s.datasetId}/rows?versionId=${detail.version.id}&limit=1`)).body;
  const firstAvg = page.rows[0].cells[avg.id].currentValue;
  const restored = (
    await call(`/datasets/${s.datasetId}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersionId: detail.version.id, targetVersionId: s.v1 }),
    })
  ).body;
  const afterUndo = (await call(`/datasets/${s.datasetId}/rows?versionId=${restored.version.id}&limit=1`)).body;
  const undoneAvg = afterUndo.rows[0].cells[avg.id].currentValue;
  const exported = (
    await call(`/datasets/${s.datasetId}/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ versionId: restored.version.id, formats: ["csv", "manifest"], scope: { kind: "full" }, acknowledgePartial: false }),
    })
  ).body.export;
  const csvFile = exported.files.find((f) => f.filename.endsWith(".csv"));
  mkdirSync(join(OUT, "downloads"), { recursive: true });
  const csvPath = join(OUT, "downloads", csvFile.filename.replace(/[^\w.-]+/g, "_"));
  writeFileSync(csvPath, csvFile.content);
  const report = {
    phase: "after",
    health: { persistence: p, blobStorage: health.capabilities.blobStorage, jobs: health.capabilities.jobs },
    sourceFilename: source.filename,
    selectionKind: selection.kind,
    skipLeadingRecords: selection.skipLeadingRecords ?? null,
    versions: detail.versions.map((v) => v.id),
    currentAfterReopen: detail.dataset.currentVersionId,
    firstAverageAfterReopen: firstAvg,
    historyEntries: hist.entries.length,
    sourceBytesSha256: sha256(stored),
    sourceBytesMatchInput: sha256(stored) === s.inputSha256,
    blobFileCount: blobFiles.length,
    blobCountUnchanged: blobFiles.length === s.blobFileCount,
    undoRestoredV1: restored.version.id === s.v1,
    firstAverageAfterUndo: undoneAvg,
    exportCsvSha256: sha256(csvFile.content),
    exportHas33319: csvFile.content.includes("333.19"),
    exportHas33320: csvFile.content.includes("333.20"),
  };
  writeFileSync(join(OUT, "after.json"), JSON.stringify(report, null, 2));
  const fail = [];
  if (firstAvg !== "333.20") fail.push(`reopen average ${firstAvg}`);
  if (undoneAvg !== "333.19") fail.push(`undo average ${undoneAvg}`);
  if (!report.sourceBytesMatchInput) fail.push("source bytes mismatch");
  if (selection.skipLeadingRecords !== 40) fail.push("selection skip not 40");
  if (hist.entries.length < 2) fail.push(`history ${hist.entries.length}`);
  if (!report.blobCountUnchanged) fail.push("blob files disappeared");
  if (fail.length) {
    console.error(JSON.stringify({ ok: false, fail, report }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, report }, null, 2));
}

if (phase === "before") await phaseBefore();
else if (phase === "after") await phaseAfter();
else {
  console.error("usage: run-durable-restart.mjs before|after");
  process.exit(2);
}
