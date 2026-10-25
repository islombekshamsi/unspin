import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AppError,
  newId,
  type ParsedDatasetDraft,
  type Source,
  type SourceSelection,
} from "@/contracts";
import { LIMITS } from "@/server/config/limits";
import { parseStructuredSelection } from "@/server/ingestion";
import { buildInitialDataset, cancelJob, createExtraction, getJob, validateDraft } from "@/server/orchestration/extraction";
import { getRepositories, newBlobKey } from "@/server/storage";
import { buildCsvSelection, buildCsvSource, buildSnapshot, seedDataset } from "../helpers/fixtures";
import { NOAA_SAMPLE, noaaTable } from "../helpers/noaa";
import { makeOwner } from "../helpers/owners";
import { COMMITTED, readInput, sha256 } from "../helpers/real-inputs";
import { PLACEHOLDER_REASON, isPlaceholder } from "../helpers/stubs";

const ENV_KEYS = ["UNSPIN_JOBS_MODE", "GEMINI_API_KEY", "GEMINI_MODEL"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => ENV_KEYS.forEach((k) => (saved[k] = process.env[k])));
afterEach(() => ENV_KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))));

async function errorOf(p: Promise<unknown> | (() => unknown)): Promise<AppError> {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error("expected an AppError");
}

function draftFromNoaa(): ParsedDatasetDraft {
  const src = buildCsvSource(readInput(COMMITTED.noaaCo2Excerpt));
  const sel = buildCsvSelection(src.id);
  const { snapshot, provenance, columns } = buildSnapshot(newId("ds"), src, sel, noaaTable(NOAA_SAMPLE));
  return {
    title: "Mauna Loa CO2",
    description: "",
    extractionMethod: "deterministic_parser",
    coverage: "complete_selection",
    coverageNote: null,
    extraction: null,
    columns,
    rows: snapshot.rows,
    provenance,
    issues: [],
  };
}

describe("validateDraft: structural and referential checks before anything is committed", () => {
  it("accepts a well-formed draft built from real NOAA rows", () => {
    expect(() => validateDraft(draftFromNoaa(), true)).not.toThrow();
  });

  it("rejects a value without a source reference", () => {
    const d = draftFromNoaa();
    Object.values(d.rows[0].cells)[0].provenanceIds = [];
    expect(() => validateDraft(d, false)).toThrow(expect.objectContaining({ code: "semantic_validation_failed" }));
  });

  it("rejects a reference to provenance that does not exist", () => {
    const d = draftFromNoaa();
    Object.values(d.rows[0].cells)[0].provenanceIds = ["prov_missing"];
    expect(() => validateDraft(d, false)).toThrow(expect.objectContaining({ code: "semantic_validation_failed" }));
  });

  it("rejects a row that is missing a column's cell (row/column mismatch)", () => {
    const d = draftFromNoaa();
    delete d.rows[2].cells[d.columns[4].id];
    expect(() => validateDraft(d, true)).toThrow(expect.objectContaining({ code: "unreadable_source" }));
  });

  it("rejects duplicate row identity and duplicate cell ids", () => {
    const d = draftFromNoaa();
    d.rows[1] = { ...d.rows[1], sourceOrder: d.rows[0].sourceOrder };
    expect(() => validateDraft(d, false)).toThrow(AppError);
    const d2 = draftFromNoaa();
    const c0 = d2.columns[0].id;
    d2.rows[1].cells[c0] = { ...d2.rows[1].cells[c0], id: d2.rows[0].cells[c0].id };
    expect(() => validateDraft(d2, false)).toThrow(AppError);
  });

  it("rejects a missing value that has no missing reason (silent null)", () => {
    const d = draftFromNoaa();
    const cell = Object.values(d.rows[0].cells)[3];
    cell.currentValue = null;
    cell.missingReason = null;
    expect(() => validateDraft(d, false)).toThrow(AppError);
  });

  it("partial coverage must explain what was omitted", () => {
    const d = { ...draftFromNoaa(), coverage: "partial_selection" as const, coverageNote: "  " };
    expect(() => validateDraft(d, false)).toThrow(AppError);
  });

  it("empty results are no_data_found, not an empty dataset", () => {
    expect(() => validateDraft({ ...draftFromNoaa(), rows: [] }, false)).toThrow(expect.objectContaining({ code: "no_data_found" }));
    expect(() => validateDraft({ ...draftFromNoaa(), columns: [] }, false)).toThrow(expect.objectContaining({ code: "no_data_found" }));
  });

  it("enforces the AI rows-per-region limit for model output but the structured limit for parsers", () => {
    const d = draftFromNoaa();
    const template = d.rows[0];
    const rows = Array.from({ length: LIMITS.maxExtractedRowsPerRegion + 1 }, (_, i) => ({
      id: newId("row"),
      sourceOrder: i,
      cells: Object.fromEntries(Object.entries(template.cells).map(([k, c]) => [k, { ...c, id: newId("cell") }])),
    }));
    expect(() => validateDraft({ ...d, rows }, false)).toThrow(expect.objectContaining({ code: "too_many_rows", status: 413 }));
    expect(() => validateDraft({ ...d, rows }, true)).not.toThrow();
  });
});

describe("buildInitialDataset", () => {
  it("produces an initial version whose history is 'initial' and whose rows keep raw text", () => {
    const owner = makeOwner();
    const d = draftFromNoaa();
    const { dataset, snapshot, history } = buildInitialDataset(owner, newId("ds"), newId("src"), newId("sel"), d);
    expect(dataset.currentVersionId).toBe(snapshot.version.id);
    expect(dataset.initialVersionId).toBe(snapshot.version.id);
    expect(snapshot.version.parentVersionId).toBeNull();
    expect(history).toMatchObject({ kind: "initial", baseVersionId: null, resultVersionId: snapshot.version.id });
    expect(snapshot.rows.map((r) => Object.values(r.cells)[6].rawText)).toContain("-9.99");
    expect(snapshot.version.reviewSummary.unreviewed).toBe(snapshot.version.reviewSummary.cellsTotal);
  });
});

async function seedCsvSourceAndSelection(owner = makeOwner()) {
  const bytes = readInput(COMMITTED.noaaCo2Excerpt);
  const source: Source = buildCsvSource(bytes, "noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv");
  const repos = getRepositories();
  const blobKey = newBlobKey(owner.ownerId, source.id);
  await repos.blobs.put(blobKey, bytes);
  await repos.sources.create(owner, { source, blobKey });
  // NOAA data begins after 40 comment lines + header; the contract only allows a header as the first record.
  const selection: SourceSelection = { ...buildCsvSelection(source.id), headerRecordCount: 0, recordInterval: { start: 41, endExclusive: 47 } };
  await repos.selections.create(owner, selection);
  return { owner, source, selection };
}

async function seedImageSelection(owner = makeOwner()) {
  const bytes = readInput(COMMITTED.noaaCo2TrendPng);
  const source: Source = {
    id: newId("src"),
    filename: "noaa-gml-co2-trend-mlo-2026-10-09.png",
    mimeType: "image/png",
    byteSize: bytes.byteLength,
    sha256: sha256(bytes),
    createdAt: new Date().toISOString(),
    kind: "image",
    pageCount: null,
    sheetNames: null,
    processingDisclosure: "gemini_selected_region",
    capabilities: { preview: true, crop: true, selectSheet: false, textCoordinates: false },
    image: { format: "png", originalWidth: 800, originalHeight: 600, exifOrientation: 1, orientedWidth: 800, orientedHeight: 600 },
  };
  const repos = getRepositories();
  const blobKey = newBlobKey(owner.ownerId, source.id);
  await repos.blobs.put(blobKey, bytes);
  await repos.sources.create(owner, { source, blobKey });
  const selection: SourceSelection = {
    id: newId("sel"),
    sourceId: source.id,
    createdAt: new Date().toISOString(),
    kind: "image_region",
    // Plot area of the NOAA chart, measured on the 800x600 image.
    region: { x: 0.125, y: 0.1167, width: 0.825, height: 0.7833 },
    userHint: null,
    transform: {
      originalWidth: 800,
      originalHeight: 600,
      exifOrientation: 1,
      orientedWidth: 800,
      orientedHeight: 600,
      orientedPixelBox: { left: 100, top: 70, width: 660, height: 470 },
    },
  };
  await repos.selections.create(owner, selection);
  return { owner, source, selection };
}

describe("job creation", () => {
  it("isolates text-mode jobs while preserving idempotency and the original selection", async () => {
    process.env.UNSPIN_JOBS_MODE = "worker";
    process.env.GEMINI_API_KEY = "test-only-protocol";
    process.env.GEMINI_MODEL = "test-model";
    const { owner, selection } = await seedImageSelection();
    const chart = await createExtraction(owner, { selectionId: selection.id, consentToExternalProcessing: true });
    const request = { selectionId: selection.id, consentToExternalProcessing: true, extractionMode: "text" as const };
    const text = await createExtraction(owner, request);
    const repeated = await createExtraction(owner, request);
    expect(text.id).not.toBe(chart.id);
    expect(repeated.id).toBe(text.id);
    const original = await getRepositories().selections.get(owner, selection.id);
    expect(original).toEqual(selection);
  });

  it("is idempotent per selection while a job is pending (worker mode)", async () => {
    process.env.UNSPIN_JOBS_MODE = "worker";
    const { owner, selection } = await seedCsvSourceAndSelection();
    const j1 = await createExtraction(owner, { selectionId: selection.id, consentToExternalProcessing: false });
    const j2 = await createExtraction(owner, { selectionId: selection.id, consentToExternalProcessing: false });
    expect(j1.status).toBe("queued");
    expect(j2.id).toBe(j1.id);
    expect(j1.operationType).toBe("structured_parse");
  });

  it("another owner cannot create a job for, or read, someone else's selection/job", async () => {
    process.env.UNSPIN_JOBS_MODE = "worker";
    const { owner, selection } = await seedCsvSourceAndSelection();
    const job = await createExtraction(owner, { selectionId: selection.id, consentToExternalProcessing: false });
    const other = makeOwner("other");
    expect((await errorOf(createExtraction(other, { selectionId: selection.id, consentToExternalProcessing: false }))).code).toBe("not_found");
    expect((await errorOf(getJob(other, job.id))).code).toBe("not_found");
    expect((await errorOf(cancelJob(other, job.id))).code).toBe("not_found");
  });

  it("image selections require explicit consent before external processing", async () => {
    const { owner, selection } = await seedImageSelection();
    const e = await errorOf(createExtraction(owner, { selectionId: selection.id, consentToExternalProcessing: false }));
    expect(e.code).toBe("consent_required");
  });

  it("without a configured model, an image selection is 503 not_configured and no job is stored", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    process.env.UNSPIN_JOBS_MODE = "worker";
    const { owner, selection } = await seedImageSelection();
    const e = await errorOf(createExtraction(owner, { selectionId: selection.id, consentToExternalProcessing: true }));
    expect(e.code).toBe("not_configured");
    expect(e.status).toBe(503);
    expect(await getRepositories().datasets.findBySelection(owner, selection.id)).toBeNull();
  });

  it("completion is idempotent: an existing dataset for the selection is reused, not duplicated (inline)", async () => {
    process.env.UNSPIN_JOBS_MODE = "inline";
    const owner = makeOwner();
    const seeded = await seedDataset(owner, noaaTable(NOAA_SAMPLE));
    const job = await createExtraction(owner, { selectionId: seeded.selection.id, consentToExternalProcessing: false });
    expect(job.status).toBe("completed");
    expect(job.resultDatasetId).toBe(seeded.dataset.id);
    expect(await getRepositories().datasets.listBySource(owner, seeded.source.id)).toHaveLength(1);
  });

  it("cancelling a queued job reports cancelled and a retry creates a new job", async () => {
    process.env.UNSPIN_JOBS_MODE = "worker";
    const { owner, selection } = await seedCsvSourceAndSelection();
    const job = await createExtraction(owner, { selectionId: selection.id, consentToExternalProcessing: false });
    const cancelled = await cancelJob(owner, job.id);
    expect(cancelled).toMatchObject({ status: "cancelled", resultDatasetId: null });
    const retry = await createExtraction(owner, { selectionId: selection.id, consentToExternalProcessing: false });
    expect(retry.id).not.toBe(job.id);
  });
});

const parserIsPlaceholder = await isPlaceholder(async () => {
  const { source, selection } = await seedCsvSourceAndSelection();
  return parseStructuredSelection(source, readInput(COMMITTED.noaaCo2Excerpt), selection);
});

describe("inline structured job outcome (honest failure until the parser exists)", () => {
  it.runIf(parserIsPlaceholder)("with the placeholder parser, the job fails with not_configured and creates no dataset", async () => {
    process.env.UNSPIN_JOBS_MODE = "inline";
    const { owner, selection } = await seedCsvSourceAndSelection();
    const job = await createExtraction(owner, { selectionId: selection.id, consentToExternalProcessing: false });
    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("not_configured");
    expect(job.resultDatasetId).toBeNull();
    expect(await getRepositories().datasets.findBySelection(owner, selection.id)).toBeNull();
  });

  it.skipIf(parserIsPlaceholder)(`with the real parser, the job completes with parsed NOAA values and per-record provenance [skips while ${PLACEHOLDER_REASON("ingestion.parseStructuredSelection")}]`, async () => {
    process.env.UNSPIN_JOBS_MODE = "inline";
    const { owner, selection } = await seedCsvSourceAndSelection();
    const job = await createExtraction(owner, { selectionId: selection.id, consentToExternalProcessing: false });
    expect(job.status).toBe("completed");
    const ds = await getRepositories().datasets.get(owner, job.resultDatasetId!);
    const v = await getRepositories().datasets.getVersion(owner, ds!.id, ds!.currentVersionId);
    expect(v!.rows).toHaveLength(6);
    // Record 41 (zero-based after no header) is "1974,5,1974.3750,333.19,..." in the real file.
    const raws = Object.values(v!.rows[0].cells).map((c) => c.rawText);
    expect(raws.slice(0, 2)).toEqual(["1974", "5"]);
    for (const row of v!.rows) for (const c of Object.values(row.cells)) expect(c.provenanceIds.length).toBeGreaterThan(0);
  });
});
