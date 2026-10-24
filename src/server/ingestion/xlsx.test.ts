import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { ParsedDatasetDraft, Source } from "@/contracts";
import { inspectStructured, parseStructuredSelection, resolveSelection, validateUpload } from "./index";
import { asSource, rezip, withIds } from "./test-support/fixtures";

async function workbookBytes(build: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function xlsxSource(bytes: Uint8Array): Promise<Source> {
  return asSource(await validateUpload({ bytes, filename: "book.xlsx", declaredMimeType: null }));
}

function sample(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Data");
  ws.getCell("A1").value = "id";
  ws.getCell("B1").value = "value";
  ws.getCell("C1").value = "double";
  ws.getCell("D1").value = "when";
  ws.getCell("A2").value = "007";
  ws.getCell("B2").value = 0.1;
  ws.getCell("C2").value = { formula: "B2*2", result: 0.2 };
  ws.getCell("D2").value = new Date(Date.UTC(2024, 0, 5));
  ws.getCell("A3").value = "12345678901234567890";
  ws.getCell("B3").value = -3;
  ws.getCell("C3").value = { formula: "B3*2" } as ExcelJS.CellFormulaValue;
  ws.getCell("A4").value = "x";
  ws.mergeCells("B4:C4");
  ws.getCell("B4").value = "merged";
  ws.getCell("D4").value = { error: "#DIV/0!" } as ExcelJS.CellErrorValue;
  const hidden = wb.addWorksheet("Secret");
  hidden.state = "hidden";
  hidden.getCell("A1").value = 1;
}

function grid(d: ParsedDatasetDraft) {
  return d.rows.map((r) => d.columns.map((c) => r.cells[c.id]));
}

describe("XLSX validation", () => {
  it("accepts a real workbook and lists sheets in workbook order", async () => {
    const source = await xlsxSource(await workbookBytes(sample));
    expect(source.kind).toBe("xlsx");
    expect(source.sheetNames).toEqual(["Data", "Secret"]);
    expect(source.capabilities.selectSheet).toBe(true);
    expect(source.processingDisclosure).toBe("local_parser");
  });

  it("rejects macro-enabled workbooks", async () => {
    const bytes = await rezip(await workbookBytes(sample), (m) => {
      m.set("xl/vbaProject.bin", new Uint8Array([1, 2, 3]));
    });
    await expect(validateUpload({ bytes, filename: "book.xlsx", declaredMimeType: null })).rejects.toMatchObject({ code: "unsupported_media_type", message: expect.stringMatching(/macro/i) });
    const ct = await rezip(await workbookBytes(sample), (m) => {
      const t = new TextDecoder().decode(m.get("[Content_Types].xml"));
      m.set("[Content_Types].xml", new TextEncoder().encode(t.replace("spreadsheetml.sheet.main+xml", "ms-excel.sheet.macroEnabled.main+xml")));
    });
    await expect(validateUpload({ bytes: ct, filename: "book.xlsx", declaredMimeType: null })).rejects.toMatchObject({ code: "unsupported_media_type" });
  });
});

describe("XLSX inspection", () => {
  it("reports sheet state, used range, merges, and formulas with and without cached values", async () => {
    const bytes = await workbookBytes(sample);
    const ins = await inspectStructured(await xlsxSource(bytes), bytes, {});
    if (ins.kind !== "xlsx") throw new Error("expected xlsx");
    expect(ins.sheetUsed).toBe("Data");
    const data = ins.sheets.find((s) => s.name === "Data")!;
    expect(data).toMatchObject({ state: "visible", usedRange: "A1:D4", rowCount: 4, columnCount: 4, mergedRanges: ["B4:C4"], formulaCellCount: 2, formulasWithoutCachedValue: 1 });
    expect(ins.sheets.find((s) => s.name === "Secret")!.state).toBe("hidden");
    expect(ins.previewRows[0]).toEqual(["id", "value", "double", "when"]);
    expect(ins.previewRows[1]).toEqual(["007", "0.1", "0.2", "2024-01-05"]);
    // Formula without a saved result is not shown as a value; merged part is empty.
    expect(ins.previewRows[2][2]).toBeNull();
    expect(ins.previewRows[3][2]).toBeNull();
    expect(ins.issues.join(" ")).toMatch(/never executed/);
  });

  it("rejects an unknown sheet name", async () => {
    const bytes = await workbookBytes(sample);
    await expect(inspectStructured(await xlsxSource(bytes), bytes, { sheetName: "Nope" })).rejects.toMatchObject({ code: "invalid_selection" });
  });
});

describe("XLSX import", () => {
  it("keeps stored values, flags cached formulas, leaves uncached formulas missing, and never fills merges", async () => {
    const bytes = await workbookBytes(sample);
    const source = await xlsxSource(bytes);
    const resolved = await resolveSelection(source, bytes, { kind: "xlsx_range", sheetName: "Data", range: null, headerRowCount: 1 });
    expect(resolved).toMatchObject({ kind: "xlsx_range", range: "A1:D4" });
    const d = await parseStructuredSelection(source, bytes, withIds(resolved));
    expect(d.extractionMethod).toBe("deterministic_parser");
    expect(d.coverage).toBe("complete_selection");
    expect(d.columns.map((c) => c.label)).toEqual(["id", "value", "double", "when"]);
    const g = grid(d);
    // Leading zero and 20-digit identifiers stored as text are exact.
    expect(g[0][0].currentValue).toBe("007");
    expect(g[1][0].currentValue).toBe("12345678901234567890");
    expect(d.columns[0].dataType).toBe("text");
    // Numbers keep their stored digits.
    expect(g[0][1]).toMatchObject({ rawText: "0.1", currentValue: "0.1" });
    expect(g[1][1]).toMatchObject({ rawText: "-3", currentValue: "-3" });
    // Cached formula result is used and labelled.
    expect(g[0][2].currentValue).toBe("0.2");
    expect(g[0][2].notes.join(" ")).toMatch(/Cached formula result of =B2\*2/);
    // Formula without cache stays missing.
    expect(g[1][2]).toMatchObject({ currentValue: null, missingReason: "unreadable", rawText: "=B3*2" });
    // Date is displayed, not parsed: text type and an explanatory note.
    expect(g[0][3]).toMatchObject({ currentValue: "2024-01-05", valueType: "text" });
    expect(g[0][3].notes.join(" ")).toMatch(/Not parsed as a date/);
    // Merge: value only in the top-left cell.
    expect(g[2][1].currentValue).toBe("merged");
    expect(g[2][2]).toMatchObject({ currentValue: null, missingReason: "not_applicable" });
    // Excel error value.
    expect(g[2][3]).toMatchObject({ currentValue: null, missingReason: "invalid", rawText: "#DIV/0!" });

    const prov = new Map(d.provenance.map((p) => [p.id, p]));
    expect(prov.get(g[1][2].provenanceIds[0])!.locator).toEqual({ type: "xlsx_cell", sheetName: "Data", address: "C3" });
    const kinds = d.issues.map((i) => `${i.kind}:${i.severity}`);
    expect(kinds).toEqual(expect.arrayContaining(["extraction_issue:review", "missing_values:review", "extraction_issue:info"]));
    const merged = d.issues.find((i) => i.message.includes("merged range"))!;
    expect(merged.cellIds).toContain(g[2][2].id);
  });

  it("imports an explicit range with no header and trims rows past the last value", async () => {
    const bytes = await workbookBytes(sample);
    const source = await xlsxSource(bytes);
    const resolved = await resolveSelection(source, bytes, { kind: "xlsx_range", sheetName: "Data", range: "A2:B99", headerRowCount: 0 });
    expect(resolved).toMatchObject({ range: "A2:B4" });
    const d = await parseStructuredSelection(source, bytes, withIds(resolved));
    expect(d.columns.map((c) => c.label)).toEqual(["Column A", "Column B"]);
    expect(d.rows).toHaveLength(3);
  });

  it("rejects ranges with no values and missing sheets", async () => {
    const bytes = await workbookBytes(sample);
    const source = await xlsxSource(bytes);
    await expect(resolveSelection(source, bytes, { kind: "xlsx_range", sheetName: "Data", range: "H10:J12", headerRowCount: 0 })).rejects.toMatchObject({ code: "invalid_selection" });
    await expect(resolveSelection(source, bytes, { kind: "xlsx_range", sheetName: "Missing", range: null, headerRowCount: 1 })).rejects.toMatchObject({ code: "invalid_selection" });
  });

  it("flags a likely second header row", async () => {
    const bytes = await workbookBytes((wb) => {
      const ws = wb.addWorksheet("S");
      ws.addRow(["Region", "Sales", "Sales"]);
      ws.addRow(["", "2023", "2024"].map((v) => v || null));
      ws.getCell("B2").value = "FY2023";
      ws.getCell("C2").value = "FY2024";
      ws.addRow(["North", 1, 2]);
      ws.addRow(["South", 3, 4]);
      ws.addRow(["East", 5, 6]);
    });
    const source = await xlsxSource(bytes);
    const resolved = await resolveSelection(source, bytes, { kind: "xlsx_range", sheetName: "S", range: null, headerRowCount: 1 });
    const d = await parseStructuredSelection(source, bytes, withIds(resolved));
    expect(d.issues.some((i) => i.kind === "type_mismatch" && /more than one row/.test(i.message))).toBe(true);
  });
});
