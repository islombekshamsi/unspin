import { describe, expect, it } from "vitest";
import { AppError, ProvenanceSchema, RowSchema, type ParsedDatasetDraft, type SelectionInput, type Source } from "@/contracts";
import { LIMITS } from "@/server/config/limits";
import { inspectStructured, parseStructuredSelection, resolveSelection, validateUpload } from "./index";
import { asSource, enc, withIds } from "./test-support/fixtures";

async function csvSource(text: string | Uint8Array): Promise<{ source: Source; bytes: Uint8Array }> {
  const bytes = typeof text === "string" ? enc(text) : text;
  const v = await validateUpload({ bytes, filename: "data.csv", declaredMimeType: "text/csv" });
  return { source: asSource(v), bytes };
}

async function importCsv(text: string, sel: Partial<Extract<SelectionInput, { kind: "csv_records" }>> = {}): Promise<ParsedDatasetDraft> {
  const { source, bytes } = await csvSource(text);
  const input: SelectionInput = { kind: "csv_records", delimiter: ",", headerRecordCount: 1, selectedColumnIndexes: null, recordInterval: null, ...sel };
  const resolved = await resolveSelection(source, bytes, input);
  return parseStructuredSelection(source, bytes, withIds(resolved));
}

function values(d: ParsedDatasetDraft) {
  return d.rows.map((r) => d.columns.map((c) => r.cells[c.id].currentValue));
}

describe("CSV upload validation", () => {
  it("detects CSV from content, records sha256, and uses the local parser", async () => {
    const { source } = await csvSource("a,b\n1,2\n");
    expect(source.kind).toBe("csv");
    expect(source.mimeType).toBe("text/csv");
    expect(source.processingDisclosure).toBe("local_parser");
    expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects non-UTF-8 text", async () => {
    await expect(validateUpload({ bytes: new Uint8Array([0x61, 0x2c, 0xe9, 0x0a]), filename: "x.csv", declaredMimeType: null })).rejects.toMatchObject({
      code: "unsupported_media_type",
    });
  });
  it("rejects an unterminated quote with a line number", async () => {
    await expect(validateUpload({ bytes: enc('a,b\n1,"x\n'), filename: "x.csv", declaredMimeType: null })).rejects.toMatchObject({
      code: "unreadable_source",
      details: { line: 2 },
    });
  });
});

describe("CSV import", () => {
  it("types numeric columns despite NA and safe whitespace/decimal notation, keeping original text", async () => {
    const d = await importCsv("code,measurement,category\n007, 1.250 ,NA\n008,+.5,test\n009,NA,label\n010,2.,word\n");
    expect(d.columns.map((c) => c.dataType)).toEqual(["text", "decimal", "text"]);
    expect(d.rows.map((r) => r.cells[d.columns[1].id].currentValue)).toEqual(["1.250", "0.5", null, "2.0"]);
    expect(d.rows[0].cells[d.columns[1].id].rawText).toBe(" 1.250 ");
    expect(d.rows[2].cells[d.columns[1].id]).toMatchObject({ rawText: "NA", currentValue: null, valueType: "decimal", missingReason: "not_reported" });
    expect(d.rows[0].cells[d.columns[2].id].currentValue).toBe("NA");
  });
  it("preserves raw strings: leading zeros, 20-digit integers, percents, dates, currency, Unicode", async () => {
    const d = await importCsv('id,big,pct,date,price,name\n007,12345678901234567890,12%,03/04/2021,"$1,200",Zoë\n010,98765432109876543210,5%,2021-04-03,$3,東京\n');
    expect(values(d)).toEqual([
      ["007", "12345678901234567890", "12%", "03/04/2021", "$1,200", "Zoë"],
      ["010", "98765432109876543210", "5%", "2021-04-03", "$3", "東京"],
    ]);
    const types = Object.fromEntries(d.columns.map((c) => [c.label, c.dataType]));
    // Only the column whose every value is already a canonical decimal is typed decimal.
    expect(types).toEqual({ id: "text", big: "decimal", pct: "text", date: "text", price: "text", name: "text" });
    for (const row of d.rows) for (const cell of Object.values(row.cells)) expect(cell.rawText).toBe(cell.currentValue);
  });

  it("marks blanks as missing without inventing values, and keeps whitespace-only text", async () => {
    const d = await importCsv("a,b,c\n1,,3\n, ,\n");
    const cells = d.rows.map((r) => d.columns.map((c) => r.cells[c.id]));
    expect(cells[0][1]).toMatchObject({ rawText: "", currentValue: null, missingReason: "blank" });
    expect(cells[1][1]).toMatchObject({ rawText: " ", currentValue: " ", missingReason: null });
    expect(cells[1][2]).toMatchObject({ currentValue: null, missingReason: "blank" });
    for (const r of d.rows) expect(RowSchema.safeParse(r).success).toBe(true);
  });

  it("records multiline records with exact physical line spans per cell", async () => {
    const d = await importCsv('label,value\r\n"two\r\nlines",1\r\nplain,2\r\n');
    const prov = new Map(d.provenance.map((p) => [p.id, p]));
    const loc = (ri: number, ci: number) => prov.get(d.rows[ri].cells[d.columns[ci].id].provenanceIds[0])!.locator;
    expect(loc(0, 0)).toEqual({ type: "csv_record", recordIndex: 0, lineStart: 2, lineEnd: 3, fieldIndex: 0 });
    expect(loc(0, 1)).toEqual({ type: "csv_record", recordIndex: 0, lineStart: 2, lineEnd: 3, fieldIndex: 1 });
    expect(loc(1, 1)).toEqual({ type: "csv_record", recordIndex: 1, lineStart: 4, lineEnd: 4, fieldIndex: 1 });
    expect(d.rows[0].cells[d.columns[0].id].currentValue).toBe("two\r\nlines");
    for (const p of d.provenance) {
      expect(ProvenanceSchema.safeParse(p).success).toBe(true);
      expect(p.locatorOrigin).toBe("parser");
    }
  });

  it("keeps records with inconsistent field counts and reports every one of them", async () => {
    const d = await importCsv("a,b,c\n1,2,3\n4,5\n6,7,8,9\n");
    expect(d.rows).toHaveLength(3);
    expect(d.columns.map((c) => c.label)).toEqual(["a", "b", "c", "Column 4"]);
    expect(values(d)).toEqual([
      ["1", "2", "3", null],
      ["4", "5", null, null],
      ["6", "7", "8", "9"],
    ]);
    const short = d.rows[1].cells[d.columns[2].id];
    expect(short).toMatchObject({ rawText: null, missingReason: "not_reported" });
    const issue = d.issues.find((i) => i.kind === "inconsistent_field_count")!;
    expect(issue.severity).toBe("review");
    expect(new Set(issue.rowIds)).toEqual(new Set([d.rows[1].id, d.rows[2].id]));
    expect(issue.cellIds).toHaveLength(3);
    expect(issue.evidence.join(" ")).toContain("Record 2 (line 3) has 2 fields");
    expect(issue.evidence.join(" ")).toContain("Record 3 (line 4) has 4 fields");
  });

  it("applies column subsets and record intervals with stable source order", async () => {
    const d = await importCsv("a,b,c\n1,2,3\n4,5,6\n7,8,9\n", { selectedColumnIndexes: [2, 0], recordInterval: { start: 1, endExclusive: 3 } });
    expect(d.columns.map((c) => c.label)).toEqual(["a", "c"]);
    expect(values(d)).toEqual([
      ["4", "6"],
      ["7", "9"],
    ]);
    expect(d.rows.map((r) => r.sourceOrder)).toEqual([1, 2]);
    expect(new Set(d.rows.map((r) => r.id)).size).toBe(2);
  });

  it("skips leading comment records, uses the next as header, and keeps physical line numbers", async () => {
    const d = await importCsv("# title\n# units\nyear,value\n2020,1.50\n2021,2\n", { skipLeadingRecords: 2 });
    expect(d.columns.map((c) => c.label)).toEqual(["year", "value"]);
    expect(values(d)).toEqual([
      ["2020", "1.50"],
      ["2021", "2"],
    ]);
    const p = d.provenance.find((x) => x.id === d.rows[0].cells[d.columns[1].id].provenanceIds[0])!;
    expect(p.locator).toMatchObject({ type: "csv_record", recordIndex: 0, lineStart: 4, lineEnd: 4, fieldIndex: 1 });
    expect(d.issues.some((i) => /lines 1–2/.test(i.message) && /skipped/.test(i.message))).toBe(true);
    expect(d.description).toMatch(/2 leading records skipped/);
  });

  it("labels columns when there is no header record", async () => {
    const d = await importCsv("1,2\n3,4\n", { headerRecordCount: 0 });
    expect(d.columns.map((c) => c.label)).toEqual(["Column 1", "Column 2"]);
    expect(d.rows).toHaveLength(2);
  });

  it("parses with an explicit semicolon delimiter and leaves decimal commas as text", async () => {
    const d = await importCsv("name;amount\nA;1,5\nB;2\n", { delimiter: ";" });
    expect(values(d)).toEqual([
      ["A", "1,5"],
      ["B", "2"],
    ]);
    expect(d.columns[1].dataType).toBe("text");
  });

  it("rejects invalid selections against the real file", async () => {
    const { source, bytes } = await csvSource("a,b\n1,2\n");
    const base = { kind: "csv_records" as const, delimiter: "," as const, headerRecordCount: 1, selectedColumnIndexes: null, recordInterval: null };
    await expect(resolveSelection(source, bytes, { ...base, selectedColumnIndexes: [5] })).rejects.toMatchObject({ code: "invalid_selection" });
    await expect(resolveSelection(source, bytes, { ...base, recordInterval: { start: 0, endExclusive: 5 } })).rejects.toMatchObject({ code: "invalid_selection" });
    const { source: s2, bytes: b2 } = await csvSource("only,header\n");
    await expect(resolveSelection(s2, b2, base)).rejects.toMatchObject({ code: "invalid_selection" });
  });

  it("refuses more rows than the limit instead of truncating", async () => {
    const text = "v\n" + Array.from({ length: LIMITS.maxStructuredRows + 1 }, (_, i) => String(i)).join("\n");
    const { source, bytes } = await csvSource(text);
    const input: SelectionInput = { kind: "csv_records", delimiter: ",", headerRecordCount: 1, selectedColumnIndexes: null, recordInterval: null };
    await expect(resolveSelection(source, bytes, input)).rejects.toMatchObject({ code: "too_many_rows" });
    const ok = await resolveSelection(source, bytes, { ...input, recordInterval: { start: 0, endExclusive: LIMITS.maxStructuredRows } });
    expect(ok.kind).toBe("csv_records");
  });

  it("refuses more columns than the limit unless a subset is chosen", async () => {
    const header = Array.from({ length: LIMITS.maxColumns + 1 }, (_, i) => `c${i}`).join(",");
    const { source, bytes } = await csvSource(`${header}\n${header}\n`);
    const input: SelectionInput = { kind: "csv_records", delimiter: ",", headerRecordCount: 1, selectedColumnIndexes: null, recordInterval: null };
    await expect(resolveSelection(source, bytes, input)).rejects.toBeInstanceOf(AppError);
    await expect(resolveSelection(source, bytes, input)).rejects.toMatchObject({ code: "too_many_columns" });
    await expect(resolveSelection(source, bytes, { ...input, selectedColumnIndexes: [0, 1] })).resolves.toMatchObject({ kind: "csv_records" });
  });
});

describe("CSV inspection", () => {
  it("reports BOM, delimiter suggestion, header suggestion, and inconsistent records", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("year;value\n2020;1\n2021\n2022;3\n")]);
    const { source } = await csvSource(bytes);
    const ins = await inspectStructured(source, bytes, {});
    if (ins.kind !== "csv") throw new Error("expected csv");
    expect(ins.hasBom).toBe(true);
    expect(ins.suggestedDelimiter).toBe(";");
    expect(ins.delimiterUsed).toBe(";");
    expect(ins.suggestedSkipLeadingRecords).toBe(0);
    expect(ins.skipReason).toBeNull();
    expect(ins.suggestedHeaderRecordCount).toBe(1);
    expect(ins.totalRecords).toBe(4);
    expect(ins.previewRecords[0]).toEqual(["year", "value"]);
    expect(ins.inconsistentRecords).toEqual([{ recordIndex: 2, fieldCount: 1 }]);
  });

  it("re-inspects with an explicitly chosen delimiter", async () => {
    const { source, bytes } = await csvSource("a;b\n1;2\n");
    const ins = await inspectStructured(source, bytes, { delimiter: "," });
    if (ins.kind !== "csv") throw new Error("expected csv");
    expect(ins.delimiterUsed).toBe(",");
    expect(ins.previewRecords[0]).toEqual(["a;b"]);
  });

  it("suggests skipping leading records that start with #", async () => {
    const { source, bytes } = await csvSource("# note\n# more\nyear,value\n2020,1\n");
    const ins = await inspectStructured(source, bytes, {});
    if (ins.kind !== "csv") throw new Error("expected csv");
    expect(ins.suggestedSkipLeadingRecords).toBe(2);
    expect(ins.skipReason).toMatch(/lines 1–2/);
    expect(ins.suggestedHeaderRecordCount).toBe(1);
    expect(ins.totalRecords).toBe(4);
    expect(ins.previewRecords[0][0]).toBe("# note");
    expect(ins.previewRecords[2]).toEqual(["year", "value"]);
  });
});
