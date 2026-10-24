import { describe, expect, it } from "vitest";
import { AppError, ExportManifestSchema, type Column, type ExportScope } from "@/contracts";
import * as fx from "@/server/storage/test-fixtures";
import { buildCsv, buildJsonData, buildManifest, CSV_BOM, disambiguate, headerLabel, lineageFor, type ExportContext } from ".";

function context(build: (cols: Column[]) => ReturnType<typeof fx.cell>[][], columns: Column[], scope: ExportScope = { kind: "full" }) {
  const owner = fx.guest();
  const source = fx.source();
  const selection = fx.selection(source.id);
  const d = fx.datasetFor(owner, selection, {
    columns,
    rows: (cols) => build(cols).map((cells) => Object.fromEntries(cells.map((c, i) => [cols[i].id, c]))),
  });
  const ctx: ExportContext = {
    source,
    selection,
    dataset: d.dataset,
    snapshot: d.snapshot,
    history: [d.history],
    provenance: d.provenance,
    scope,
    exportedAt: "2026-10-24T22:00:00.000Z",
  };
  return { ctx, d, owner };
}

function parseCsv(csv: string): string[] {
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  expect(csv.endsWith("\r\n")).toBe(true);
  return csv.slice(1, -2).split("\r\n");
}

const text = (v: string) => fx.cell(v, { valueType: "text" });
const dec = (v: string) => fx.cell(v, { valueType: "decimal" });

describe("buildCsv", () => {
  it("neutralizes formula-like text but never touches valid decimals", () => {
    const cols = [fx.column({ label: "Note", dataType: "text" }), fx.column({ label: "Value" })];
    const { ctx } = context(
      () => [
        [text("=1+1"), dec("-2")],
        [text("+cmd|' /C calc'!A0"), dec("-12.5")],
        [text("-2"), dec("1e-7")],
        [text("@SUM(A1:A2)"), dec("0")],
        [text("\tTAB"), dec("123456789012345678901234567890")],
        [text("\rCR"), dec("-0.000100")],
        [text("plain -2 inside"), fx.cell("=HYPERLINK(1)", { valueType: "decimal" })],
      ],
      cols,
    );
    const lines = parseCsv(buildCsv(ctx));
    expect(lines).toEqual([
      "Note,Value",
      "'=1+1,-2",
      `'+cmd|' /C calc'!A0,-12.5`,
      "'-2,1e-7",
      "'@SUM(A1:A2),0",
      "'\tTAB,123456789012345678901234567890",
      `"'\rCR",-0.000100`,
      "plain -2 inside,'=HYPERLINK(1)",
    ]);
  });

  it("quotes per RFC 4180 and preserves unicode, newlines, and missing values", () => {
    const cols = [fx.column({ label: 'He said "hi", twice', dataType: "text" }), fx.column({ label: "Δ temp", unit: "°C" }), fx.column({ label: "Flag", dataType: "boolean" })];
    const { ctx } = context(
      () => [
        [text('a "quoted", value'), dec("1.50"), fx.cell(true)],
        [text("line1\nline2"), fx.cell(null), fx.cell(false)],
        [text("日本語 — ünïcödé"), fx.cell(null, { valueType: "decimal", missingReason: "not_reported" }), fx.cell(null)],
      ],
      cols,
    );
    const csv = buildCsv(ctx);
    expect(csv).toBe(
      CSV_BOM +
        '"He said ""hi"", twice",Δ temp (°C),Flag\r\n' +
        '"a ""quoted"", value",1.50,true\r\n' +
        '"line1\nline2",,false\r\n' +
        "日本語 — ünïcödé,,\r\n",
    );
  });

  it("labels units and currency and disambiguates duplicate headers deterministically", () => {
    expect(headerLabel(fx.column({ label: "Revenue", currency: "USD", unit: "million" }), 0)).toBe("Revenue (USD million)");
    expect(headerLabel(fx.column({ label: "Share", percentRepresentation: "percent_number" }), 0)).toBe("Share (%)");
    expect(headerLabel(fx.column({ label: "  " }), 2)).toBe("Column 3");
    expect(disambiguate(["A", "B", "A", "A [2]", "A"])).toEqual(["A", "B", "A [3]", "A [2]", "A [4]"]);
    const cols = [fx.column({ label: "x" }), fx.column({ label: "x" }), fx.column({ label: "=evil" })];
    const { ctx } = context(() => [[dec("1"), dec("2"), dec("3")]], cols);
    expect(parseCsv(buildCsv(ctx))[0]).toBe("x,x [2],'=evil");
  });

  it("exports full scope in sourceOrder and view scope in the exact requested order", () => {
    const cols = [fx.column({ label: "A", dataType: "text" }), fx.column({ label: "B" }), fx.column({ label: "C" })];
    const { ctx } = context(
      () => [
        [text("r0"), dec("0"), dec("10")],
        [text("r1"), dec("1"), dec("11")],
        [text("r2"), dec("2"), dec("12")],
      ],
      cols,
    );
    ctx.snapshot.rows.reverse();
    expect(parseCsv(buildCsv(ctx))).toEqual(["A,B,C", "r0,0,10", "r1,1,11", "r2,2,12"]);
    const [r0, , r2] = [...ctx.snapshot.rows].sort((a, b) => a.sourceOrder - b.sourceOrder);
    const [a, , c] = ctx.snapshot.version.columns;
    const view: ExportScope = { kind: "view", rowIds: [r2.id, r0.id], columnIds: [c.id, a.id], description: "sorted by C desc" };
    expect(parseCsv(buildCsv({ ...ctx, scope: view }))).toEqual(["C,A", "12,r2", "10,r0"]);
    const bad: ExportScope = { kind: "view", rowIds: ["row_missing"], columnIds: [a.id], description: "" };
    expect(() => buildCsv({ ...ctx, scope: bad })).toThrow(AppError);
    const dup: ExportScope = { kind: "view", rowIds: [r0.id, r0.id], columnIds: [a.id], description: "" };
    expect(() => buildCsv({ ...ctx, scope: dup })).toThrow(AppError);
  });
});

describe("buildJsonData", () => {
  it("carries exact unescaped values with types, missingness, raw text, origin, and review state", () => {
    const cols = [fx.column({ label: "T", dataType: "text" }), fx.column({ label: "V" })];
    const { ctx } = context(
      () => [
        [text("=1+1"), dec("-2")],
        [text("x"), fx.cell(null, { valueType: "decimal", missingReason: "unreadable", rawText: "??", reviewStatus: "unavailable" })],
      ],
      cols,
    );
    const data = JSON.parse(buildJsonData(ctx));
    expect(data.versionId).toBe(ctx.snapshot.version.id);
    expect(data.columns.map((c: Column) => c.id)).toEqual(cols.map((c) => c.id));
    expect(data.rows[0].cells[cols[0].id]).toMatchObject({ currentValue: "=1+1", valueType: "text", origin: "parsed" });
    expect(data.rows[0].cells[cols[1].id].currentValue).toBe("-2");
    expect(data.rows[1].cells[cols[1].id]).toMatchObject({
      currentValue: null,
      missingReason: "unreadable",
      rawText: "??",
      reviewStatus: "unavailable",
    });
    expect(data.rows.map((r: { sourceOrder: number }) => r.sourceOrder)).toEqual([0, 1]);
  });
});

describe("buildManifest", () => {
  it("is schema-valid and carries complete lineage for the exported version", () => {
    const cols = [fx.column({ label: "Year", dataType: "text" }), fx.column({ label: "Revenue", currency: "USD", unit: "million" })];
    const { ctx, d, owner } = context(
      () => [
        [text("2024"), dec("10.5")],
        [text("2025"), dec("-3")],
      ],
      cols,
    );
    const v2 = fx.childSnapshot(d.snapshot);
    const h2 = fx.historyEntry(owner, d.dataset.id, "transform", d.snapshot.version.id, v2.version.id, 2);
    const restore = fx.historyEntry(owner, d.dataset.id, "restore", v2.version.id, d.snapshot.version.id, 2);
    const v3 = fx.childSnapshot(d.snapshot, "Other");
    const h3 = fx.historyEntry(owner, d.dataset.id, "transform", d.snapshot.version.id, v3.version.id, 2);
    const full: ExportContext = {
      ...ctx,
      dataset: { ...ctx.dataset, currentVersionId: v3.version.id },
      snapshot: v2,
      history: [d.history, h2, restore, h3],
    };
    const m = buildManifest(full);
    expect(ExportManifestSchema.safeParse(m).success).toBe(true);
    expect(m.software).toEqual({ name: "UNSPIN", version: expect.any(String) });
    expect(m.dataset).toMatchObject({
      initialVersionId: d.snapshot.version.id,
      exportedVersionId: v2.version.id,
      currentVersionId: v3.version.id,
    });
    expect(m.history.map((h) => h.id)).toEqual([d.history.id, h2.id]);
    expect(m.selection).toEqual(ctx.selection);
    expect(m.source).toEqual({
      sourceId: ctx.source.id,
      kind: "csv",
      filename: "fixture.csv",
      sha256: ctx.source.sha256,
      byteSize: ctx.source.byteSize,
      processingDisclosure: "local_parser",
    });
    expect(JSON.stringify(m)).not.toMatch(/blobKey|sources\/guest_/);
    expect(m.provenance.map((p) => p.id).sort()).toEqual(d.provenance.map((p) => p.id).sort());
    expect(m.reviewSummary).toEqual({ cellsTotal: 4, unreviewed: 4, accepted: 0, corrected: 0, unavailable: 0 });
    expect(m.reviewStatement).toMatch(/not scientific validation/);
    expect(m.csvPolicy.formulaInjection).toMatch(/-12\.5 stays -12\.5/);
  });

  it("includes only provenance referenced by exported cells and scopes the review summary", () => {
    const cols = [fx.column({ label: "A", dataType: "text" }), fx.column({ label: "B" })];
    const { ctx } = context(
      () => [
        [text("a"), dec("1")],
        [fx.cell("b", { valueType: "text", reviewStatus: "accepted" }), dec("2")],
      ],
      cols,
    );
    const second = [...ctx.snapshot.rows].sort((a, b) => a.sourceOrder - b.sourceOrder)[1];
    const m = buildManifest({ ...ctx, scope: { kind: "view", rowIds: [second.id], columnIds: [cols[0].id], description: "one" } });
    expect(m.rowCount).toBe(1);
    expect(m.columns.map((c) => c.id)).toEqual([cols[0].id]);
    expect(m.provenance.map((p) => p.id)).toEqual(second.cells[cols[0].id].provenanceIds);
    expect(m.reviewSummary).toEqual({ cellsTotal: 1, unreviewed: 0, accepted: 1, corrected: 0, unavailable: 0 });
  });

  it("states partial coverage and its acknowledgement", () => {
    const cols = [fx.column({ label: "A" })];
    const { ctx } = context(() => [[dec("1")]], cols);
    const m = buildManifest({
      ...ctx,
      dataset: { ...ctx.dataset, coverage: "partial_selection", coverageNote: "Second panel omitted.", coverageAcknowledgedAt: "2026-10-24T21:00:00.000Z" },
    });
    expect(m.dataset.coverage).toBe("partial_selection");
    expect(m.reviewStatement).toContain("Second panel omitted.");
    expect(m.reviewStatement).toContain("acknowledged by the user at 2026-10-24T21:00:00.000Z");
  });

  it("refuses to export when lineage or provenance is incomplete", () => {
    const cols = [fx.column({ label: "A" })];
    const { ctx, d } = context(() => [[dec("1")]], cols);
    const orphan = fx.childSnapshot(d.snapshot);
    expect(() => buildManifest({ ...ctx, snapshot: orphan })).toThrow(/history is incomplete/);
    expect(() => buildManifest({ ...ctx, provenance: [] })).toThrow(/references provenance/);
    expect(() => lineageFor([], "ver_x")).toThrow(AppError);
  });
});
