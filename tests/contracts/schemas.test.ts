import { describe, expect, it } from "vitest";
import {
  ApiErrorBodySchema,
  CONTRACT_SCHEMA_VERSION,
  CellSchema,
  CreateSelectionRequestSchema,
  DecimalStringSchema,
  ERROR_STATUS,
  ExportManifestSchema,
  IdSchema,
  NormalizedRectSchema,
  SelectionInputSchema,
  TransformOperationSchema,
  UserHintSchema,
} from "@/contracts";

describe("cells: missingness is explicit and typed", () => {
  const base = {
    id: "cell_a",
    rawText: "-9.99",
    valueType: "decimal" as const,
    origin: "parsed" as const,
    reviewStatus: "unreviewed" as const,
    provenanceIds: ["prov_a"],
    parentCellIds: [],
    notes: [],
  };

  it("keeps a real negative sentinel as a present value until the user marks it missing", () => {
    // NOAA uses -9.99 for 'no sdev'; the contract must be able to hold it as text/decimal without null.
    expect(CellSchema.safeParse({ ...base, currentValue: "-9.99", missingReason: null }).success).toBe(true);
  });

  it.each(["blank", "unreadable", "not_reported", "invalid", "not_applicable"])("accepts missing reason %s with null value", (r) => {
    expect(CellSchema.safeParse({ ...base, currentValue: null, missingReason: r }).success).toBe(true);
  });

  it("rejects unknown missing reasons and numeric (non-string) values", () => {
    expect(CellSchema.safeParse({ ...base, currentValue: null, missingReason: "zero" }).success).toBe(false);
    expect(CellSchema.safeParse({ ...base, currentValue: -9.99, missingReason: null }).success).toBe(false);
  });

  it("allows rawText null only as 'no source text', independent of currentValue", () => {
    expect(CellSchema.safeParse({ ...base, rawText: null, currentValue: null, missingReason: "blank" }).success).toBe(true);
  });
});

describe("decimal strings: exact representation", () => {
  it.each([
    "315.71", // NOAA average
    "-0.99", // NOAA unc sentinel
    "0.00",
    "1975.9583",
    "123456789012345678901234567890", // beyond Number.MAX_SAFE_INTEGER
    "2.5e-7",
  ])("accepts %s", (v) => expect(DecimalStringSchema.safeParse(v).success).toBe(true));

  it.each(["+1", "1 000", "1.2.3", "$83.22", "12%", "(123)", "0x1F", "-", " 1", "1 ", "−5" /* U+2212 */])(
    "rejects non-canonical %j",
    (v) => expect(DecimalStringSchema.safeParse(v).success).toBe(false),
  );
});

describe("ids are opaque and cannot carry paths or filenames with separators", () => {
  it.each(["../etc/passwd", "a/b", "report.csv", "a b", "", "x".repeat(129), "src_ü"])("rejects %j", (v) => {
    expect(IdSchema.safeParse(v).success).toBe(false);
  });
});

describe("selections: bounds and shapes", () => {
  it.each([
    [{ x: 0, y: 0, width: 1, height: 1 }, true],
    [{ x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, true],
    [{ x: 0, y: 0, width: 0, height: 0.5 }, false],
    [{ x: -0.01, y: 0, width: 0.5, height: 0.5 }, false],
    [{ x: 0.6, y: 0, width: 0.5, height: 0.5 }, false],
    [{ x: 0, y: 0.75, width: 0.5, height: 0.3 }, false],
    [{ x: Number.NaN, y: 0, width: 0.5, height: 0.5 }, false],
  ])("normalized rect %j -> %s", (rect, ok) => {
    expect(NormalizedRectSchema.safeParse(rect).success).toBe(ok);
  });

  it("pdf pages are one-indexed", () => {
    const sel = { kind: "pdf_region", pageNumber: 0, region: null, userHint: null };
    expect(SelectionInputSchema.safeParse(sel).success).toBe(false);
    expect(SelectionInputSchema.safeParse({ ...sel, pageNumber: 15 }).success).toBe(true);
  });

  it("csv record interval must be non-empty and delimiter allowlisted", () => {
    const sel = { kind: "csv_records", delimiter: ",", headerRecordCount: 1, selectedColumnIndexes: null };
    expect(SelectionInputSchema.safeParse({ ...sel, recordInterval: { start: 5, endExclusive: 5 } }).success).toBe(false);
    expect(SelectionInputSchema.safeParse({ ...sel, recordInterval: { start: 0, endExclusive: 1 } }).success).toBe(true);
    expect(SelectionInputSchema.safeParse({ ...sel, delimiter: ":", recordInterval: null }).success).toBe(false);
  });

  it("xlsx range must be A1:B2 style; sheet name is required", () => {
    const sel = { kind: "xlsx_range", sheetName: "2tab", headerRowCount: 1 };
    expect(SelectionInputSchema.safeParse({ ...sel, range: "C4:BV6" }).success).toBe(true);
    expect(SelectionInputSchema.safeParse({ ...sel, range: "C4" }).success).toBe(false);
    expect(SelectionInputSchema.safeParse({ ...sel, range: "=SUM(A1:A2)" }).success).toBe(false);
    expect(SelectionInputSchema.safeParse({ ...sel, sheetName: "", range: null }).success).toBe(false);
  });

  it("user hint is bounded data (trimmed, 1..300 chars)", () => {
    expect(UserHintSchema.safeParse("  WTI spot price  ").data).toBe("WTI spot price");
    expect(UserHintSchema.safeParse("   ").success).toBe(false);
    expect(UserHintSchema.safeParse("x".repeat(301)).success).toBe(false);
  });

  it("a selection request cannot carry an owner id", () => {
    const parsed = CreateSelectionRequestSchema.parse({
      sourceId: "src_1",
      ownerId: "guest_other",
      selection: { kind: "image_region", region: { x: 0, y: 0, width: 1, height: 1 }, userHint: null },
    });
    expect("ownerId" in parsed).toBe(false);
  });
});

describe("operations: discriminated allowlist only", () => {
  const valid = [
    { type: "edit_cell", rowId: "row_1", columnId: "col_1", cellId: "cell_1", newValue: "315.71", explicitType: "decimal", missingReason: null, note: null },
    { type: "rename_column", columnId: "col_1", newLabel: "CO2 (ppm)" },
    { type: "set_column_unit", columnId: "col_1", unit: "ppm", currency: null },
    { type: "trim_text", columnIds: ["col_1"], rowIds: null },
    {
      type: "parse_numeric",
      columnId: "col_1",
      locale: { decimalSeparator: ".", groupingSeparator: "," },
      groupingPolicy: "allow",
      percentPolicy: "keep_percent_number",
      currencyPolicy: { mode: "strip_symbol", currency: "USD" },
      parenthesesNegative: true,
      onFailure: "keep_and_flag",
    },
    { type: "parse_date", columnId: "col_1", format: "MM/DD/YYYY", timezonePolicy: "date_only", onFailure: "keep_and_flag" },
    { type: "mark_missing", columnId: "col_1", explicitTokens: ["-9.99", "(S)"], rowIds: null, missingReason: "not_reported" },
    { type: "remove_selected_rows", rowIds: ["row_1"] },
    { type: "remove_exact_duplicates", columnIds: ["col_1"], retainPolicy: "first_in_source_order" },
    { type: "convert_unit", columnId: "col_1", registeredConversionId: "usd_per_bbl_to_usd_per_gal" },
    { type: "set_review_status", cellIds: ["cell_1"], reviewStatus: "accepted" },
  ];

  it.each(valid.map((op) => [op.type, op]))("accepts %s", (_t, op) => {
    expect(TransformOperationSchema.safeParse(op).success).toBe(true);
  });

  it("covers exactly the documented operation types", () => {
    const types = new Set(TransformOperationSchema.options.map((o) => o.shape.type.value));
    expect([...types].sort()).toEqual(valid.map((v) => v.type).sort());
  });

  it.each([
    { type: "eval", code: "1+1" },
    { type: "sql", query: "DELETE FROM datasets" },
    { type: "impute", columnId: "col_1", method: "mean" },
    { type: "remove_outliers", columnId: "col_1" },
    { type: "aggregate", columnId: "col_1", fn: "sum" },
  ])("rejects non-allowlisted %j", (op) => {
    expect(TransformOperationSchema.safeParse(op).success).toBe(false);
  });

  it("parse failures can only keep and flag, never drop or zero", () => {
    const op = { ...valid[4], onFailure: "set_null" };
    expect(TransformOperationSchema.safeParse(op).success).toBe(false);
    const op2 = { ...valid[5], onFailure: "drop_row" };
    expect(TransformOperationSchema.safeParse(op2).success).toBe(false);
  });

  it("duplicate removal must retain the first in source order", () => {
    expect(TransformOperationSchema.safeParse({ ...valid[8], retainPolicy: "last" }).success).toBe(false);
  });

  it("a review event cannot mark a cell 'corrected' (only edits do that)", () => {
    expect(TransformOperationSchema.safeParse({ ...valid[10], reviewStatus: "corrected" }).success).toBe(false);
  });

  it("row removal requires explicit row ids", () => {
    expect(TransformOperationSchema.safeParse({ type: "remove_selected_rows", rowIds: [] }).success).toBe(false);
  });
});

describe("error envelope and status mapping match docs/CONTRACTS.md", () => {
  it.each([
    ["bad_request", 400],
    ["unauthorized", 401],
    ["forbidden", 403],
    ["not_found", 404],
    ["version_conflict", 409],
    ["payload_too_large", 413],
    ["unsupported_media_type", 415],
    ["extraction_failed", 422],
    ["rate_limited", 429],
    ["provider_quota", 429],
    ["provider_failure", 502],
    ["not_configured", 503],
    ["timeout", 504],
  ] as const)("%s -> %i", (code, status) => {
    expect(ERROR_STATUS[code]).toBe(status);
  });

  it("envelope requires code/message/retryable and a requestId", () => {
    expect(ApiErrorBodySchema.safeParse({ error: { code: "not_found", message: "x", retryable: false }, requestId: "req_1" }).success).toBe(true);
    expect(ApiErrorBodySchema.safeParse({ error: { code: "not_found", message: "x" }, requestId: "req_1" }).success).toBe(false);
    expect(ApiErrorBodySchema.safeParse({ error: { code: "made_up", message: "x", retryable: false }, requestId: "r" }).success).toBe(false);
  });
});

describe("export manifest schema", () => {
  const now = new Date().toISOString();
  const manifest = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    software: { name: "UNSPIN", version: "0.1.0" },
    exportedAt: now,
    scope: { kind: "full" },
    csvPolicy: { nullRepresentation: "", decimalSeparator: ".", numericValues: "exact decimal strings", formulaInjection: "prefix" },
    source: {
      sourceId: "src_1",
      kind: "csv",
      filename: "noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv",
      sha256: "a653f1af074f08f25f7b51e97d4b93b2e5485269a10a11df167e73e5cd7e6fad",
      byteSize: 29804,
      processingDisclosure: "local_parser",
    },
    selection: {
      id: "sel_1",
      sourceId: "src_1",
      createdAt: now,
      kind: "csv_records",
      delimiter: ",",
      headerRecordCount: 1,
      selectedColumnIndexes: null,
      recordInterval: null,
    },
    dataset: {
      id: "ds_1",
      title: "Mauna Loa CO2",
      extractionMethod: "deterministic_parser",
      extraction: null,
      coverage: "complete_selection",
      coverageNote: null,
      coverageAcknowledgedAt: null,
      initialVersionId: "ver_1",
      exportedVersionId: "ver_1",
      currentVersionId: "ver_1",
    },
    columns: [],
    reviewSummary: { cellsTotal: 0, unreviewed: 0, accepted: 0, corrected: 0, unavailable: 0 },
    reviewStatement: "No cells reviewed.",
    rowCount: 0,
    history: [],
    provenance: [],
  };

  it("accepts a complete manifest", () => {
    expect(ExportManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("requires a real source hash and lineage versions", () => {
    expect(ExportManifestSchema.safeParse({ ...manifest, source: { ...manifest.source, sha256: "abc" } }).success).toBe(false);
    const { exportedVersionId: _drop, ...ds } = manifest.dataset;
    void _drop;
    expect(ExportManifestSchema.safeParse({ ...manifest, dataset: ds }).success).toBe(false);
  });

  it("rejects a non-UNSPIN software block or wrong schema version", () => {
    expect(ExportManifestSchema.safeParse({ ...manifest, schemaVersion: "unspin.contracts/0" }).success).toBe(false);
    expect(ExportManifestSchema.safeParse({ ...manifest, csvPolicy: { ...manifest.csvPolicy, decimalSeparator: "," } }).success).toBe(false);
  });
});
