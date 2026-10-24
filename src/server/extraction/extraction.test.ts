import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppError,
  DecimalStringSchema,
  type ExtractionInput,
  type Locator,
  type Source,
  type SourceSelection,
} from "@/contracts";
import { validateDraft } from "@/server/orchestration/extraction";
import { ScriptedTransport, jsonResult, testProvider } from "@/server/providers/gemini/testing";
import { canonicalizeDecimal, decimalSign } from "./decimal";
import { extractCandidate, extractWithProvider, extractionAvailability } from "./index";

const source: Source = {
  id: "src_test",
  filename: "figure.png",
  mimeType: "image/png",
  byteSize: 1000,
  sha256: "a".repeat(64),
  createdAt: "2026-10-24T00:00:00.000Z",
  kind: "image",
  pageCount: null,
  sheetNames: null,
  processingDisclosure: "gemini_selected_region",
  capabilities: { preview: true, crop: true, selectSheet: false, textCoordinates: false },
  image: { format: "png", originalWidth: 1000, originalHeight: 800, exifOrientation: 1, orientedWidth: 1000, orientedHeight: 800 },
};

const selection: SourceSelection = {
  id: "sel_test",
  sourceId: "src_test",
  createdAt: "2026-10-24T00:00:00.000Z",
  kind: "image_region",
  region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
  userHint: null,
  transform: {
    originalWidth: 1000,
    originalHeight: 800,
    exifOrientation: 1,
    orientedWidth: 1000,
    orientedHeight: 800,
    orientedPixelBox: { left: 100, top: 80, width: 500, height: 400 },
  },
};

const mappedBoxes: Array<{ x: number; y: number; width: number; height: number }> = [];
function makeInput(map: ExtractionInput["mapSentBoxToSource"] | null = null): ExtractionInput {
  return {
    mimeType: "image/png",
    bytes: new Uint8Array([1, 2, 3]),
    disclosure: "selected_image_region",
    pageHint: null,
    pixelSize: { width: 500, height: 400 },
    regionLocator: { type: "image_box", coordinateSystem: "oriented_source_pixels", box: { left: 100, top: 80, width: 500, height: 400 } },
    mapSentBoxToSource:
      map ??
      ((b): Locator => {
        mappedBoxes.push(b);
        return {
          type: "image_box",
          coordinateSystem: "oriented_source_pixels",
          box: { left: 100 + Math.round(b.x * 500), top: 80 + Math.round(b.y * 400), width: Math.max(1, Math.round(b.width * 500)), height: Math.max(1, Math.round(b.height * 400)) },
        };
      }),
  };
}

type Col = { key: string; label: string; role: string; dataType: string; unit?: string | null; currency?: string | null; percent?: string | null; axisScale?: string; seriesLabel?: string | null };
type CellIn = { column: string; text: string | null; method?: string; missingReason?: string | null; box?: number[] | null; note?: string | null };

function col(c: Col) {
  return { unit: null, currency: null, percent: null, axisScale: "linear", seriesLabel: null, ...c };
}
function cell(c: CellIn) {
  return { method: "estimated", missingReason: null, box: null, note: null, ...c };
}
function response(over: Record<string, unknown> = {}) {
  return {
    status: "ok",
    contentKind: "bar_chart",
    visibleTitle: "Annual output",
    statusExplanation: null,
    coverage: "complete",
    coverageNote: null,
    columns: [
      col({ key: "c1", label: "Year", role: "category", dataType: "text", axisScale: "categorical" }),
      col({ key: "c2", label: "Output", role: "y", dataType: "number", unit: "t" }),
    ],
    rows: [
      { cells: [cell({ column: "c1", text: "2020", method: "transcribed" }), cell({ column: "c2", text: "12.50", box: [100, 200, 900, 300] })] },
      { cells: [cell({ column: "c1", text: "2021", method: "transcribed" }), cell({ column: "c2", text: "13", method: "transcribed" })] },
    ],
    warnings: [],
    ...over,
  };
}

async function extract(body: unknown, opts: { finish?: string; input?: ExtractionInput; sel?: SourceSelection } = {}) {
  const t = new ScriptedTransport([jsonResult(body, opts.finish)]);
  return extractWithProvider(testProvider(t), {
    source,
    selection: opts.sel ?? selection,
    input: opts.input ?? makeInput(),
    signal: new AbortController().signal,
  });
}

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}

const valueCells = (draft: Awaited<ReturnType<typeof extract>>, label: string) => {
  const c = draft.columns.find((x) => x.label === label)!;
  return draft.rows.map((r) => r.cells[c.id]);
};

afterEach(() => {
  vi.unstubAllEnvs();
  mappedBoxes.length = 0;
});

describe("availability", () => {
  it("names exactly what is missing and never the key", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_MODEL", "");
    expect(extractionAvailability().reason).toMatch(/GEMINI_API_KEY and GEMINI_MODEL are not set/);
    vi.stubEnv("GEMINI_API_KEY", "k-should-not-appear");
    const a = extractionAvailability();
    expect(a).toMatchObject({ configured: false, model: null });
    expect(a.reason).toMatch(/GEMINI_MODEL is not set/);
    expect(JSON.stringify(a)).not.toContain("k-should-not-appear");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_MODEL", "some-model");
    expect(extractionAvailability().reason).toMatch(/GEMINI_API_KEY is not set/);
    vi.stubEnv("GEMINI_API_KEY", "k-should-not-appear");
    expect(extractionAvailability()).toEqual({ configured: true, model: "some-model", reason: null });
  });

  it("extractCandidate refuses with not_configured when env is incomplete", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_MODEL", "some-model");
    const e = await failure(extractCandidate({ source, selection, input: makeInput(), signal: new AbortController().signal }));
    expect(e.code).toBe("not_configured");
    expect(e.message).toMatch(/GEMINI_API_KEY/);
  });
});

describe("mapping into contracts", () => {
  it("produces a draft that passes orchestration validation", async () => {
    const draft = await extract(response());
    expect(() => validateDraft(draft, false)).not.toThrow();
    expect(draft.extractionMethod).toBe("vision_estimate");
    expect(draft.coverage).toBe("complete_selection");
    expect(draft.coverageNote).toBeNull();
    expect(draft.title).toBe("Annual output");
    expect(draft.extraction).toMatchObject({ provider: "gemini", model: "test-model", promptVersion: "chart-table-v1", inputDisclosure: "selected_image_region" });
    expect(draft.rows.map((r) => r.sourceOrder)).toEqual([0, 1]);
  });

  it("classifies cell origin by reading method and keeps raw text", async () => {
    const draft = await extract(response());
    const out = valueCells(draft, "Output");
    expect(out[0]).toMatchObject({ origin: "estimated", rawText: "12.50", currentValue: "12.50", valueType: "decimal", reviewStatus: "unreviewed" });
    expect(out[1]).toMatchObject({ origin: "transcribed", currentValue: "13" });
    expect(draft.columns.find((c) => c.label === "Output")).toMatchObject({ dataType: "decimal", unit: "t", semanticRole: "y" });
  });

  it("gives every cell a region provenance and maps model boxes as unverified hints", async () => {
    const draft = await extract(response());
    const region = draft.provenance[0];
    expect(region).toMatchObject({ locatorOrigin: "user_confirmed", locatorAvailability: "region_only", extractionMethod: "vision_estimate" });
    for (const r of draft.rows) for (const c of Object.values(r.cells)) expect(c.provenanceIds[0]).toBe(region.id);
    const hinted = valueCells(draft, "Output")[0];
    expect(hinted.provenanceIds).toHaveLength(2);
    const hint = draft.provenance.find((p) => p.id === hinted.provenanceIds[1])!;
    expect(hint).toMatchObject({ locatorOrigin: "model_hint", locatorAvailability: "region_only" });
    // [ymin=100, xmin=200, ymax=900, xmax=300] in 0..1000
    expect(mappedBoxes[0]).toEqual({ x: 0.2, y: 0.1, width: 0.1, height: 0.8 });
    expect(hint.locator).toEqual({ type: "image_box", coordinateSystem: "oriented_source_pixels", box: { left: 200, top: 120, width: 50, height: 320 } });
  });

  it("keeps only region provenance when no geometric mapping exists", async () => {
    const draft = await extract(response(), { input: makeInput(() => null) });
    expect(draft.provenance).toHaveLength(1);
  });

  it("discards malformed model boxes and says so", async () => {
    const body = response();
    (body.rows as Array<{ cells: ReturnType<typeof cell>[] }>)[1].cells[1].box = [900, 10, 100, 20];
    const draft = await extract(body);
    expect(valueCells(draft, "Output")[1].provenanceIds).toHaveLength(1);
    expect(draft.issues.some((i) => /malformed/.test(i.message))).toBe(true);
  });
});

describe("numeric canonicalization", () => {
  it("never round-trips through Number", () => {
    expect(canonicalizeDecimal("12345678901234567890.1230")?.value).toBe("12345678901234567890.1230");
    expect(canonicalizeDecimal("0.50")?.value).toBe("0.50");
    expect(canonicalizeDecimal("-0.0001")?.value).toBe("-0.0001");
    expect(canonicalizeDecimal(".5")).toMatchObject({ value: "0.5" });
    expect(canonicalizeDecimal("+7")).toMatchObject({ value: "7" });
    expect(canonicalizeDecimal("\u22123.2")).toMatchObject({ value: "-3.2" });
    expect(canonicalizeDecimal("1.5E+03")?.value).toBe("1.5e3");
    for (const bad of ["1,234", "12%", "$5", "1 000", "NaN", "Infinity", "1e999", "", "-", ".", "1.2.3", "3,5"]) {
      expect(canonicalizeDecimal(bad)).toBeNull();
    }
    for (const v of ["0", "-0", "12.50", "1e-5", "007"]) expect(DecimalStringSchema.safeParse(canonicalizeDecimal(v)!.value).success).toBe(true);
    expect(decimalSign("-0.0")).toBe(0);
    expect(decimalSign("0e5")).toBe(0);
    expect(decimalSign("-1e-9")).toBe(-1);
  });

  it("keeps a column with separators/percent as text, with notes and a finding", async () => {
    const body = response({
      columns: [col({ key: "c1", label: "Year", role: "category", dataType: "text" }), col({ key: "c2", label: "Revenue", role: "y", dataType: "number", currency: "usd" })],
      rows: [
        { cells: [cell({ column: "c1", text: "2020" }), cell({ column: "c2", text: "1,234", method: "transcribed" })] },
        { cells: [cell({ column: "c1", text: "2021" }), cell({ column: "c2", text: "1500", method: "transcribed" })] },
      ],
    });
    const draft = await extract(body);
    const rev = draft.columns.find((c) => c.label === "Revenue")!;
    expect(rev.dataType).toBe("text");
    expect(rev.currency).toBe("USD");
    const cells = valueCells(draft, "Revenue");
    expect(cells[0]).toMatchObject({ valueType: "text", currentValue: "1,234", rawText: "1,234" });
    expect(cells[0].notes.join(" ")).toMatch(/explicit numeric interpretation/);
    expect(cells[1]).toMatchObject({ valueType: "text", currentValue: "1500" });
    const finding = draft.issues.find((i) => i.kind === "mixed_numeric_format")!;
    expect(finding.cellIds).toEqual([cells[0].id]);
  });
});

describe("semantic validation", () => {
  it("rejects an empty result as no_data_found", async () => {
    expect((await failure(extract(response({ status: "no_data", contentKind: "no_chart_or_table", columns: [], rows: [] })))).code).toBe("no_data_found");
    expect((await failure(extract(response({ rows: [] })))).code).toBe("no_data_found");
  });

  it("rejects unreadable selections", async () => {
    expect((await failure(extract(response({ status: "unreadable", rows: [] })))).code).toBe("unreadable_source");
  });

  it("refuses unsupported plot types with a clear message", async () => {
    const e = await failure(extract(response({ status: "unsupported", contentKind: "summary_statistics_plot", rows: [] })));
    expect(e.code).toBe("extraction_failed");
    expect(e.message).toMatch(/Individual observations cannot be recovered/);
    const c = await failure(extract(response({ status: "unsupported", contentKind: "continuous_curve_without_markers", rows: [] })));
    expect(c.message).toMatch(/would invent measurements/);
  });

  it("rejects more rows than the limit instead of truncating", async () => {
    const rows = Array.from({ length: 251 }, (_, i) => ({ cells: [cell({ column: "c1", text: String(i) }), cell({ column: "c2", text: "1" })] }));
    const e = await failure(extract(response({ rows })));
    expect(e.code).toBe("too_many_rows");
  });

  it("reports too_many_rows when the model declined a dense figure", async () => {
    const e = await failure(extract(response({ status: "partial", coverage: "partial", rows: [], warnings: [{ kind: "too_many_points", message: "about 2000 points" }] })));
    expect(e.code).toBe("too_many_rows");
  });

  it("rejects references to undefined columns and duplicate keys", async () => {
    const unknownRef = response();
    (unknownRef.rows as Array<{ cells: ReturnType<typeof cell>[] }>)[0].cells[1].column = "c9";
    expect((await failure(extract(unknownRef))).code).toBe("invalid_provider_response");

    const dupCell = response();
    (dupCell.rows as Array<{ cells: ReturnType<typeof cell>[] }>)[0].cells.push(cell({ column: "c2", text: "99" }));
    expect((await failure(extract(dupCell))).code).toBe("invalid_provider_response");

    const dupCol = response({ columns: [col({ key: "c1", label: "A", role: "x", dataType: "number" }), col({ key: "c1", label: "B", role: "y", dataType: "number" })] });
    expect((await failure(extract(dupCol))).code).toBe("invalid_provider_response");
  });

  it("marks a value the model left out as missing, never filled", async () => {
    const body = response();
    (body.rows as Array<{ cells: ReturnType<typeof cell>[] }>)[1].cells.pop();
    const draft = await extract(body);
    const missing = valueCells(draft, "Output")[1];
    expect(missing).toMatchObject({ currentValue: null, missingReason: "unreadable", rawText: null });
    expect(() => validateDraft(draft, false)).not.toThrow();
    expect(draft.issues.some((i) => i.kind === "extraction_issue" && /left out 1 value/.test(i.message))).toBe(true);
  });

  it("keeps not-read values missing with their reason", async () => {
    const body = response();
    (body.rows as Array<{ cells: ReturnType<typeof cell>[] }>)[1].cells[1] = cell({ column: "c2", text: null, method: "not_read", missingReason: "unreadable" });
    const draft = await extract(body);
    expect(valueCells(draft, "Output")[1]).toMatchObject({ currentValue: null, missingReason: "unreadable" });
    expect(draft.columns.find((c) => c.label === "Output")!.dataType).toBe("decimal");
    expect(draft.issues.find((i) => i.kind === "missing_values")!.cellIds).toHaveLength(1);
  });

  it("maps partial coverage with the model's explanation", async () => {
    const draft = await extract(response({ status: "partial", coverage: "partial", coverageNote: "Legend entry for series C is clipped." }));
    expect(draft.coverage).toBe("partial_selection");
    expect(draft.coverageNote).toBe("Legend entry for series C is clipped.");
    expect(draft.issues.some((i) => i.kind === "partial_coverage")).toBe(true);
    expect(() => validateDraft(draft, false)).not.toThrow();
  });

  it("supplies an explicit note when partial coverage is unexplained", async () => {
    const draft = await extract(response({ coverage: "partial" }));
    expect(draft.coverage).toBe("partial_selection");
    expect(draft.coverageNote).toMatch(/did not say which were omitted/);
  });

  it("marks a parsed-but-truncated reply as partial", async () => {
    const draft = await extract(response(), { finish: "MAX_TOKENS" });
    expect(draft.coverage).toBe("partial_selection");
    expect(draft.coverageNote).toMatch(/length limit/);
  });

  it("flags non-positive values on a log axis", async () => {
    const body = response({
      columns: [col({ key: "c1", label: "Dose", role: "x", dataType: "number", axisScale: "log", unit: "mg" }), col({ key: "c2", label: "Response", role: "y", dataType: "number", unit: "%" })],
      rows: [
        { cells: [cell({ column: "c1", text: "0" }), cell({ column: "c2", text: "5" })] },
        { cells: [cell({ column: "c1", text: "-1" }), cell({ column: "c2", text: "6" })] },
        { cells: [cell({ column: "c1", text: "10" }), cell({ column: "c2", text: "7" })] },
      ],
    });
    const draft = await extract(body);
    const flagged = draft.issues.find((i) => /logarithmic axis/.test(i.message))!;
    expect(flagged.severity).toBe("review");
    expect(flagged.cellIds).toHaveLength(2);
  });

  it("flags duplicate x within a series, mixed units, ambiguous series, and missing units", async () => {
    const body = response({
      contentKind: "line_chart",
      columns: [
        col({ key: "x", label: "Year", role: "x", dataType: "number", unit: null }),
        col({ key: "a", label: "A", role: "y", dataType: "number", unit: "kg", seriesLabel: "A" }),
        col({ key: "b", label: "B", role: "y", dataType: "number", unit: "lb", seriesLabel: null }),
      ],
      rows: [
        { cells: [cell({ column: "x", text: "2020" }), cell({ column: "a", text: "1" }), cell({ column: "b", text: "2" })] },
        { cells: [cell({ column: "x", text: "2020" }), cell({ column: "a", text: "3" }), cell({ column: "b", text: "4" })] },
      ],
      warnings: [{ kind: "series_ambiguity", message: "two blue lines" }],
    });
    const draft = await extract(body);
    const kinds = draft.issues.map((i) => i.kind);
    expect(kinds).toContain("repeated_rows");
    expect(kinds).toContain("mixed_units");
    expect(draft.issues.some((i) => /not clearly tied to distinct series/.test(i.message))).toBe(true);
    expect(draft.issues.some((i) => /No unit is shown for "Year"/.test(i.message))).toBe(true);
    expect(draft.issues.some((i) => i.evidence.includes("Model note: two blue lines"))).toBe(true);
  });

  it("treats a cut-off figure as uncertain coverage", async () => {
    const draft = await extract(response({ warnings: [{ kind: "clipped_or_cropped", message: "right edge cut" }] }));
    expect(draft.coverage).toBe("uncertain");
    expect(draft.coverageNote).toBeTruthy();
  });

  it("refuses structured selections", async () => {
    const csvSel = { id: "sel_csv", sourceId: "src_test", createdAt: selection.createdAt, kind: "csv_records", delimiter: ",", headerRecordCount: 1, selectedColumnIndexes: null, recordInterval: null } as SourceSelection;
    expect((await failure(extract(response(), { sel: csvSel }))).code).toBe("bad_request");
  });

  it("describes table transcription honestly", async () => {
    const draft = await extract(response({ contentKind: "table", visibleTitle: null }));
    expect(draft.title).toBe("Table from figure.png");
    expect(draft.description).toMatch(/no text-layer path/);
  });
});
