import { describe, expect, it } from "vitest";
import {
  AppError,
  ValidatedUploadSchema,
  newId,
  type Source,
  type SourceSelection,
  type StructuredInspection,
} from "@/contracts";
import { inspectStructured, parseStructuredSelection, resolveSelection, validateUpload } from "@/server/ingestion";
import { createSource } from "@/server/orchestration/sources";
import { getRepositories } from "@/server/storage";
import { makeOwner } from "../helpers/owners";
import { COMMITTED, LOCAL_ONLY, basename, inputPresent, readInput, type InputRef } from "../helpers/real-inputs";
import { PLACEHOLDER_REASON, isPlaceholder } from "../helpers/stubs";

/**
 * Real permitted inputs from evaluation/sources.json. Expectations come from the
 * product spec and from facts verified in the files themselves (record counts,
 * sentinel rows, sheet names, page geometry), not from any implementation.
 */

async function validate(ref: InputRef, overrides: { filename?: string; declaredMimeType?: string | null } = {}) {
  return validateUpload({
    bytes: readInput(ref),
    filename: overrides.filename ?? basename(ref.path),
    declaredMimeType: overrides.declaredMimeType === undefined ? ref.mimeType : overrides.declaredMimeType,
  });
}

async function toSource(ref: InputRef): Promise<Source> {
  const v = await validate(ref);
  return { ...v, id: newId("src"), createdAt: new Date().toISOString() };
}

async function rejection(p: Promise<unknown>): Promise<AppError | "accepted"> {
  try {
    await p;
    return "accepted";
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
}

const uploadPlaceholder = await isPlaceholder(() => validate(COMMITTED.noaaCo2Excerpt));
const inspectPlaceholder = uploadPlaceholder || (await isPlaceholder(async () => inspectStructured(await toSource(COMMITTED.noaaCo2Excerpt), readInput(COMMITTED.noaaCo2Excerpt), { delimiter: "," })));
const selectPlaceholder =
  uploadPlaceholder ||
  (await isPlaceholder(async () =>
    resolveSelection(await toSource(COMMITTED.noaaCo2TrendPng), readInput(COMMITTED.noaaCo2TrendPng), {
      kind: "image_region",
      region: { x: 0, y: 0, width: 1, height: 1 },
      userHint: null,
    }),
  ));
const parsePlaceholder =
  uploadPlaceholder ||
  (await isPlaceholder(async () => {
    const src = await toSource(COMMITTED.noaaCo2Excerpt);
    const sel: SourceSelection = { id: newId("sel"), sourceId: src.id, createdAt: new Date().toISOString(), kind: "csv_records", delimiter: ",", headerRecordCount: 0, selectedColumnIndexes: null, recordInterval: { start: 41, endExclusive: 42 } };
    return parseStructuredSelection(src, readInput(COMMITTED.noaaCo2Excerpt), sel);
  }));
const pdfPresent = inputPresent(LOCAL_ONLY.steoPdf);

describe.skipIf(uploadPlaceholder)(`validateUpload with real inputs [skips while ${PLACEHOLDER_REASON("ingestion.validateUpload")}]`, () => {
  it("NOAA CSV excerpt: csv, exact hash/size, local parser disclosure", async () => {
    const v = ValidatedUploadSchema.parse(await validate(COMMITTED.noaaCo2Excerpt));
    expect(v).toMatchObject({ kind: "csv", sha256: COMMITTED.noaaCo2Excerpt.sha256, byteSize: 29804, processingDisclosure: "local_parser", image: null });
  });

  it("NOAA chart PNG: image with real decoded dimensions and no EXIF rotation", async () => {
    const v = ValidatedUploadSchema.parse(await validate(COMMITTED.noaaCo2TrendPng));
    expect(v.kind).toBe("image");
    expect(v.image).toMatchObject({ format: "png", originalWidth: 800, originalHeight: 600, exifOrientation: 1, orientedWidth: 800, orientedHeight: 600 });
    expect(v.processingDisclosure).not.toBe("local_parser");
    expect(v.capabilities.crop).toBe(true);
  });

  it("EIA STEO workbook: xlsx with its 28 actual sheet names in order", async () => {
    const v = await validate(COMMITTED.eiaSteoXlsx);
    expect(v.kind).toBe("xlsx");
    expect(v.sheetNames).toHaveLength(28);
    expect(v.sheetNames?.slice(0, 4)).toEqual(["Dates", "Contents", "1tab", "2tab"]);
    expect(v.capabilities.selectSheet).toBe(true);
  });

  it("legacy EIA .xls is rejected as 415 even when renamed and declared as xlsx", async () => {
    for (const o of [{}, { filename: "prices.xlsx", declaredMimeType: COMMITTED.eiaSteoXlsx.mimeType }]) {
      const r = await rejection(validate(COMMITTED.eiaLegacyXls, o));
      expect(r).toBeInstanceOf(AppError);
      expect((r as AppError).status).toBe(415);
    }
  });

  it("type comes from the bytes, not the filename: a PNG named .csv is never treated as CSV", async () => {
    const r = await rejection(validate(COMMITTED.noaaCo2TrendPng, { filename: "data.csv", declaredMimeType: "text/csv" }));
    if (r !== "accepted") expect([415, 400]).toContain(r.status);
    else expect((await validate(COMMITTED.noaaCo2TrendPng, { filename: "data.csv", declaredMimeType: "text/csv" })).kind).toBe("image");
  });

  it("a truncated real PNG is rejected, not accepted with guessed dimensions", async () => {
    const bytes = readInput(COMMITTED.noaaCo2TrendPng).slice(0, 200);
    const r = await rejection(validateUpload({ bytes, filename: "truncated.png", declaredMimeType: "image/png" }));
    expect(r).toBeInstanceOf(AppError);
    expect([400, 415, 422]).toContain((r as AppError).status);
  });

  it("an empty file is rejected", async () => {
    const r = await rejection(validateUpload({ bytes: new Uint8Array(0), filename: "empty.csv", declaredMimeType: "text/csv" }));
    expect(r).toBeInstanceOf(AppError);
  });

  it.runIf(pdfPresent)("EIA STEO PDF (fetched locally): pdf with 60 pages", async () => {
    const v = await validate(LOCAL_ONLY.steoPdf);
    expect(v).toMatchObject({ kind: "pdf", pageCount: 60 });
  });

  it("source ids and storage keys never derive from the uploaded filename", async () => {
    const owner = makeOwner();
    const hostile = "..%2F..%2Fetc%2Fpasswd ../../report.csv";
    const file = new File([readInput(COMMITTED.noaaCo2Excerpt) as Uint8Array<ArrayBuffer>], hostile, { type: "text/csv" });
    const source = await createSource(owner, file);
    expect(source.id).toMatch(/^src_[a-f0-9]{32}$/);
    // The display name is reduced to a base name; it is metadata only.
    expect(source.filename).not.toMatch(/[\\/]|\.\./);
    expect(source.filename).toMatch(/report\.csv$/);
    const rec = await getRepositories().sources.get(owner, source.id);
    expect(rec!.blobKey).not.toContain("passwd");
    expect(rec!.blobKey).not.toContain("report");
    expect(rec!.blobKey).not.toContain("..");
  });
});

describe.skipIf(inspectPlaceholder)(`inspectStructured with real inputs [skips while ${PLACEHOLDER_REASON("ingestion.inspectStructured")}]`, () => {
  it("NOAA CSV: comment preamble is visible as inconsistent records or explicitly disclosed, never silently dropped", async () => {
    const src = await toSource(COMMITTED.noaaCo2Excerpt);
    const ins = (await inspectStructured(src, readInput(COMMITTED.noaaCo2Excerpt), { delimiter: "," })) as Extract<StructuredInspection, { kind: "csv" }>;
    expect(ins.kind).toBe("csv");
    expect(ins.hasBom).toBe(false);
    expect(ins.delimiterUsed).toBe(",");
    expect(ins.maxFieldCount).toBe(8);
    if (ins.totalRecords === 670) {
      expect(ins.inconsistentRecords.length).toBeGreaterThan(0);
      expect(ins.previewRecords[0][0].startsWith("#")).toBe(true);
    } else {
      expect(ins.totalRecords).toBe(630);
      expect(ins.issues.join(" ")).toMatch(/comment|#/i);
    }
  });

  it("EIA workbook: lists all sheets with cached formula counts; never executes formulas", async () => {
    const src = await toSource(COMMITTED.eiaSteoXlsx);
    const ins = (await inspectStructured(src, readInput(COMMITTED.eiaSteoXlsx), { sheetName: "2tab" })) as Extract<StructuredInspection, { kind: "xlsx" }>;
    expect(ins.kind).toBe("xlsx");
    expect(ins.sheets).toHaveLength(28);
    expect(ins.sheetUsed).toBe("2tab");
    const t2 = ins.sheets.find((s) => s.name === "2tab")!;
    expect(t2.formulaCellCount).toBeGreaterThan(0);
    expect(ins.previewRows.some((r) => r.includes("WTIPUUS"))).toBe(true);
  });

  it("an unknown sheet name is a 400-class error, not the first sheet", async () => {
    const src = await toSource(COMMITTED.eiaSteoXlsx);
    const r = await rejection(inspectStructured(src, readInput(COMMITTED.eiaSteoXlsx), { sheetName: "No such sheet" }));
    expect(r).toBeInstanceOf(AppError);
    expect([400, 404]).toContain((r as AppError).status);
  });
});

describe.skipIf(selectPlaceholder)(`resolveSelection geometry [skips while ${PLACEHOLDER_REASON("ingestion.resolveSelection")}]`, () => {
  it("image region maps to oriented pixel box on the 800x600 NOAA chart (±1 px)", async () => {
    const src = await toSource(COMMITTED.noaaCo2TrendPng);
    const sel = await resolveSelection(src, readInput(COMMITTED.noaaCo2TrendPng), {
      kind: "image_region",
      region: { x: 0.125, y: 0.1167, width: 0.825, height: 0.7833 },
      userHint: "monthly mean CO2",
    });
    if (sel.kind !== "image_region") throw new Error("wrong kind");
    const b = sel.transform.orientedPixelBox;
    expect(Math.abs(b.left - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.top - 70)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.width - 660)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.height - 470)).toBeLessThanOrEqual(1);
    expect(sel.transform).toMatchObject({ originalWidth: 800, originalHeight: 600, exifOrientation: 1 });
  });

  it("a CSV column index beyond the file's fields is invalid_selection", async () => {
    const src = await toSource(COMMITTED.noaaCo2Excerpt);
    const r = await rejection(
      resolveSelection(src, readInput(COMMITTED.noaaCo2Excerpt), { kind: "csv_records", delimiter: ",", headerRecordCount: 0, selectedColumnIndexes: [99], recordInterval: null }),
    );
    expect(r).toBeInstanceOf(AppError);
    expect((r as AppError).status).toBe(400);
  });

  it("an XLSX sheet that does not exist is invalid_selection", async () => {
    const src = await toSource(COMMITTED.eiaSteoXlsx);
    const r = await rejection(resolveSelection(src, readInput(COMMITTED.eiaSteoXlsx), { kind: "xlsx_range", sheetName: "Sheet1", range: null, headerRowCount: 0 }));
    expect(r).toBeInstanceOf(AppError);
    expect((r as AppError).status).toBe(400);
  });

  it.runIf(pdfPresent)("PDF page 15 region converts to unrotated PDF user space (origin bottom-left)", async () => {
    const src = await toSource(LOCAL_ONLY.steoPdf);
    const sel = await resolveSelection(src, readInput(LOCAL_ONLY.steoPdf), {
      kind: "pdf_region",
      pageNumber: 15,
      region: { x: 0.2, y: 0.33, width: 0.6, height: 0.27 },
      userHint: null,
    });
    if (sel.kind !== "pdf_region") throw new Error("wrong kind");
    expect(sel.transform.page).toEqual({ widthPt: 612, heightPt: 792, rotation: 0 });
    const b = sel.transform.pdfBox;
    expect(b.x0).toBeCloseTo(122.4, 1);
    expect(b.x1).toBeCloseTo(489.6, 1);
    expect(b.y0).toBeCloseTo(316.8, 1);
    expect(b.y1).toBeCloseTo(530.64, 1);
  });

  it.runIf(pdfPresent)("PDF page beyond the document is invalid_selection", async () => {
    const src = await toSource(LOCAL_ONLY.steoPdf);
    const r = await rejection(resolveSelection(src, readInput(LOCAL_ONLY.steoPdf), { kind: "pdf_region", pageNumber: 61, region: null, userHint: null }));
    expect((r as AppError).status).toBe(400);
  });
});

describe.skipIf(parsePlaceholder)(`parseStructuredSelection semantics on real files [skips while ${PLACEHOLDER_REASON("ingestion.parseStructuredSelection")}]`, () => {
  async function parseNoaa(start: number, endExclusive: number) {
    const src = await toSource(COMMITTED.noaaCo2Excerpt);
    const sel: SourceSelection = {
      id: newId("sel"),
      sourceId: src.id,
      createdAt: new Date().toISOString(),
      kind: "csv_records",
      delimiter: ",",
      headerRecordCount: 0,
      selectedColumnIndexes: null,
      recordInterval: { start, endExclusive },
    };
    return parseStructuredSelection(src, readInput(COMMITTED.noaaCo2Excerpt), sel);
  }

  it("NOAA 1975-12 (record 60, line 61): negative sentinels stay as published, not missing and not zero", async () => {
    const d = await parseNoaa(60, 61);
    expect(d.rows).toHaveLength(1);
    expect(d.extractionMethod).toBe("deterministic_parser");
    const cells = d.columns.map((c) => d.rows[0].cells[c.id]);
    expect(cells.map((c) => c.rawText)).toEqual(["1975", "12", "1975.9583", "330.77", "331.73", "-1", "-9.99", "0.00"]);
    for (const c of cells) {
      expect(c.currentValue).not.toBeNull();
      expect(c.missingReason).toBeNull();
      expect(c.origin).toBe("parsed");
    }
    expect(cells[6].currentValue).toBe("-9.99");
    expect(cells[7].currentValue).toBe("0.00");
    const prov = d.provenance.find((p) => p.id === cells[0].provenanceIds[0])!;
    expect(prov.locator).toMatchObject({ type: "csv_record", lineStart: 61, lineEnd: 61 });
    expect(prov.locatorOrigin).toBe("parser");
  });

  it("decimal strings are exact (no float round-trip)", async () => {
    const d = await parseNoaa(41, 47);
    const dateCol = d.columns[2].id;
    expect(d.rows.map((r) => r.cells[dateCol].rawText)).toEqual(["1974.3750", "1974.4583", "1974.5417", "1974.6250", "1974.7083", "1974.7917"]);
    for (const r of d.rows) {
      const c = r.cells[dateCol];
      if (c.valueType === "decimal") expect(c.currentValue).toBe(c.rawText);
    }
  });

  it("rows keep source order and stable unique ids", async () => {
    const d = await parseNoaa(41, 53);
    expect(d.rows.map((r) => r.sourceOrder)).toEqual([...d.rows.map((r) => r.sourceOrder)].sort((a, b) => a - b));
    expect(new Set(d.rows.map((r) => r.id)).size).toBe(12);
  });

  it("EIA 2tab WTIPUUS row: values with xlsx_cell provenance at their real addresses", async () => {
    const src = await toSource(COMMITTED.eiaSteoXlsx);
    const sel: SourceSelection = { id: newId("sel"), sourceId: src.id, createdAt: new Date().toISOString(), kind: "xlsx_range", sheetName: "2tab", range: "A6:E6", headerRowCount: 0 };
    const d = await parseStructuredSelection(src, readInput(COMMITTED.eiaSteoXlsx), sel);
    const cells = d.columns.map((c) => d.rows[0].cells[c.id]);
    expect(cells[0].rawText).toBe("WTIPUUS");
    expect(cells.slice(2).map((c) => c.currentValue)).toEqual(["83.22", "91.64", "108.5"]);
    const p = d.provenance.find((x) => x.id === cells[2].provenanceIds[0])!;
    expect(p.locator).toEqual({ type: "xlsx_cell", sheetName: "2tab", address: "C6" });
  });

  it("EIA 2tab year header cells are formulas: cached results are identified as cached", async () => {
    const src = await toSource(COMMITTED.eiaSteoXlsx);
    const sel: SourceSelection = { id: newId("sel"), sourceId: src.id, createdAt: new Date().toISOString(), kind: "xlsx_range", sheetName: "2tab", range: "C3:E4", headerRowCount: 0 };
    const d = await parseStructuredSelection(src, readInput(COMMITTED.eiaSteoXlsx), sel);
    const yearCells = d.columns.map((c) => d.rows[0].cells[c.id]);
    // C3 holds the formula; D3:E3 are parts of the same merged cell. The year is not copied into them.
    expect(yearCells[0].currentValue).toBe("2022");
    expect(yearCells[0].notes.some((n) => /cach/i.test(n) && /formula/i.test(n))).toBe(true);
    for (const part of yearCells.slice(1)) {
      expect(part.currentValue).toBeNull();
      expect(part.missingReason).not.toBeNull();
      expect(part.notes.some((n) => /merged/i.test(n))).toBe(true);
    }
  });
});
