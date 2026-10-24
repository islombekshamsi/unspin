import ExcelJS from "exceljs";
import {
  AppError,
  type ImportIssue,
  type MissingReason,
  type ParsedDatasetDraft,
  type ResolvedSelection,
  type SelectionInput,
  type Source,
  type SourceSelection,
  type StructuredInspection,
} from "@/contracts";
import { LIMITS } from "@/server/config/limits";
import { cellAddress, columnLetter, formatRange, intersects, parseRange, type CellRange } from "./a1";
import { baseName, buildDraft, isCanonicalDecimal, issue, type DraftCellInput, type DraftRowInput } from "./draft";
import { inspectXlsxPackage, readLiteralValues, type XlsxPackage } from "./xlsx-package";

const PREVIEW_ROWS = 50;
const ValueType = ExcelJS.ValueType;
const MAX_SAFE = 2 ** 53;

export async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ArrayBuffer);
  } catch {
    throw new AppError("unreadable_source", "The workbook could not be read. It may be damaged, or saved in a format other than .xlsx.");
  }
  return wb;
}

/** Package checks plus a full parse; returns sheet names in workbook order. */
export async function validateXlsxBytes(bytes: Uint8Array): Promise<{ sheetNames: string[] }> {
  const pkg = inspectXlsxPackage(bytes);
  const wb = await loadWorkbook(bytes);
  const loaded = new Set(wb.worksheets.map((w) => w.name));
  const sheetNames = pkg.sheets.filter((s) => !s.isChartsheet && loaded.has(s.name)).map((s) => s.name);
  if (sheetNames.length === 0) throw new AppError("no_data_found", "The workbook has no worksheets.");
  return { sheetNames };
}

// ---------------------------------------------------------------------------
// Cell interpretation (never evaluates formulas)
// ---------------------------------------------------------------------------

type CellKind = "empty" | "value" | "cached_formula" | "uncached_formula" | "merged_part" | "error";

export interface CellReading {
  kind: CellKind;
  rawText: string | null;
  text: string | null;
  missingReason: MissingReason | null;
  notes: string[];
  /** Text shown in previews. */
  display: string | null;
}

function numberText(n: number): string {
  // Shortest decimal that identifies the stored binary value; always matches DecimalStringSchema.
  return Object.is(n, -0) ? "0" : String(n);
}

function dateText(d: Date): string {
  const iso = d.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace(/\.000Z$/, "").replace(/Z$/, "");
}

function richText(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "richText" in v && Array.isArray((v as { richText: unknown }).richText)) {
    return (v as { richText: Array<{ text?: string }> }).richText.map((r) => r.text ?? "").join("");
  }
  return null;
}

function scalarReading(
  value: unknown,
  literal: string | undefined,
  numFmt: string | undefined,
  date1904: boolean,
): Omit<CellReading, "kind"> & { isError: boolean } {
  const notes: string[] = [];
  const fmt = numFmt && numFmt !== "General" ? numFmt : null;
  if (value === null || value === undefined) return { rawText: null, text: null, missingReason: "blank", notes, display: null, isError: false };
  if (typeof value === "number") {
    const text = numberText(value);
    const raw = literal ?? text;
    if (literal !== undefined && literal !== text) notes.push(`Stored in the file as ${literal}; shown as the shortest decimal for the same binary value.`);
    if (Math.abs(value) >= MAX_SAFE) notes.push("Excel stores numbers as binary floating point (about 15 significant digits). Long identifiers should be stored as text.");
    if (fmt) notes.push(`Excel number format "${fmt}" is not applied; the stored value is shown.`);
    return { rawText: raw, text, missingReason: null, notes, display: text, isError: false };
  }
  if (typeof value === "boolean") {
    const text = value ? "TRUE" : "FALSE";
    return { rawText: literal ?? text, text, missingReason: null, notes, display: text, isError: false };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { rawText: literal ?? null, text: null, missingReason: "invalid", notes: ["Date value is out of range."], display: null, isError: true };
    const text = dateText(value);
    notes.push(
      `Excel date${literal ? ` serial ${literal}` : ""} shown as ${text} using the cell's date format (${date1904 ? "1904" : "1900"} date system, no time zone). Not parsed as a date.`,
    );
    return { rawText: literal ?? text, text, missingReason: null, notes, display: text, isError: false };
  }
  if (typeof value === "object" && "error" in (value as object)) {
    const err = String((value as { error: unknown }).error);
    return { rawText: err, text: null, missingReason: "invalid", notes: [`Excel error value ${err}.`], display: err, isError: true };
  }
  if (typeof value === "object" && "text" in (value as object)) {
    const t = richText((value as { text: unknown }).text) ?? "";
    return { rawText: t, text: t === "" ? null : t, missingReason: t === "" ? "blank" : null, notes, display: t || null, isError: false };
  }
  const rt = richText(value);
  if (rt !== null) return { rawText: rt, text: rt === "" ? null : rt, missingReason: rt === "" ? "blank" : null, notes, display: rt || null, isError: false };
  return { rawText: null, text: null, missingReason: "unreadable", notes: ["This cell's content type is not supported."], display: null, isError: true };
}

export function readCell(cell: ExcelJS.Cell, literal: string | undefined, date1904: boolean): CellReading {
  switch (cell.type) {
    case ValueType.Null:
      return { kind: "empty", rawText: null, text: null, missingReason: "blank", notes: [], display: null };
    case ValueType.Merge: {
      const master = cell.master.address;
      return {
        kind: "merged_part",
        rawText: null,
        text: null,
        missingReason: "not_applicable",
        notes: [`Part of a merged cell; the value is stored only in ${master}.`],
        display: null,
      };
    }
    case ValueType.Formula: {
      const formula = cell.formula ? `=${cell.formula}` : "a formula";
      const result = cell.result;
      if (result === undefined || result === null) {
        return {
          kind: "uncached_formula",
          rawText: formula === "a formula" ? null : formula,
          text: null,
          missingReason: "unreadable",
          notes: [`Formula ${formula} has no saved result in the file. Formulas are never executed here; open and re-save the workbook in Excel to store results.`],
          display: null,
        };
      }
      const r = scalarReading(result, literal, cell.numFmt, date1904);
      return {
        kind: r.isError ? "error" : "cached_formula",
        rawText: r.rawText,
        text: r.text,
        missingReason: r.missingReason,
        notes: [`Cached formula result of ${formula}, as last saved by the spreadsheet application; not recalculated.`, ...r.notes],
        display: r.display,
      };
    }
    default: {
      const r = scalarReading(cell.value, literal, cell.numFmt, date1904);
      return { kind: r.isError ? "error" : r.text === null ? "empty" : "value", rawText: r.rawText, text: r.text, missingReason: r.missingReason, notes: r.notes, display: r.display };
    }
  }
}

// ---------------------------------------------------------------------------
// Sheet statistics
// ---------------------------------------------------------------------------

function mergedRanges(ws: ExcelJS.Worksheet): string[] {
  const internal = (ws as unknown as { _merges?: Record<string, { range?: string } | undefined> })._merges;
  if (internal) return Object.values(internal).flatMap((m) => (m?.range ? [m.range] : []));
  return ws.model.merges ?? [];
}

interface SheetStats {
  used: CellRange | null;
  merges: string[];
  formulaCells: number;
  formulasWithoutCache: number;
}

function sheetStats(ws: ExcelJS.Worksheet): SheetStats {
  let used: CellRange | null = null;
  let formulaCells = 0;
  let formulasWithoutCache = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (cell.type === ValueType.Null) return;
      if (cell.type === ValueType.Formula) {
        formulaCells++;
        if (cell.result === undefined || cell.result === null) formulasWithoutCache++;
      }
      if (!used) used = { top: rowNumber, left: colNumber, bottom: rowNumber, right: colNumber };
      else {
        used.top = Math.min(used.top, rowNumber);
        used.bottom = Math.max(used.bottom, rowNumber);
        used.left = Math.min(used.left, colNumber);
        used.right = Math.max(used.right, colNumber);
      }
    });
  });
  return { used, merges: mergedRanges(ws), formulaCells, formulasWithoutCache };
}

function getSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.worksheets.find((w) => w.name === name);
  if (!ws) throw new AppError("invalid_selection", `The workbook has no sheet named "${name}".`);
  return ws;
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

export async function inspectXlsx(bytes: Uint8Array, sheetName: string | undefined): Promise<StructuredInspection> {
  const pkg = inspectXlsxPackage(bytes);
  const wb = await loadWorkbook(bytes);
  const stateOf = new Map(pkg.sheets.map((s) => [s.name, s.state]));
  const ordered = orderedWorksheets(pkg, wb);
  const stats = new Map(ordered.map((ws) => [ws.name, sheetStats(ws)]));
  const sheets = ordered.map((ws) => {
    const s = stats.get(ws.name)!;
    return {
      name: ws.name,
      state: stateOf.get(ws.name) ?? ws.state ?? "visible",
      usedRange: s.used ? formatRange(s.used) : null,
      rowCount: s.used ? s.used.bottom - s.used.top + 1 : 0,
      columnCount: s.used ? s.used.right - s.used.left + 1 : 0,
      mergedRanges: s.merges,
      formulaCellCount: s.formulaCells,
      formulasWithoutCachedValue: s.formulasWithoutCache,
    };
  });
  let sheetUsed: string | null = null;
  if (sheetName !== undefined) sheetUsed = getSheet(wb, sheetName).name;
  else sheetUsed = (sheets.find((s) => s.state === "visible" && s.usedRange) ?? sheets.find((s) => s.usedRange) ?? sheets[0])?.name ?? null;

  const issues: string[] = [];
  const chartsheets = pkg.sheets.filter((s) => s.isChartsheet).map((s) => s.name);
  if (chartsheets.length) issues.push(`Chart sheets cannot be imported: ${chartsheets.join(", ")}.`);
  let previewRows: Array<Array<string | null>> = [];
  if (sheetUsed) {
    const ws = getSheet(wb, sheetUsed);
    const s = stats.get(sheetUsed)!;
    const info = sheets.find((x) => x.name === sheetUsed)!;
    if (info.state !== "visible") issues.push(`"${sheetUsed}" is a ${info.state === "veryHidden" ? "very hidden" : "hidden"} sheet in the workbook.`);
    if (s.used) {
      const literals = readLiteralValues(bytes, pkg, sheetUsed);
      const bottom = Math.min(s.used.bottom, s.used.top + PREVIEW_ROWS - 1);
      const right = Math.min(s.used.right, s.used.left + LIMITS.maxColumns - 1);
      for (let r = s.used.top; r <= bottom; r++) {
        const row: Array<string | null> = [];
        for (let c = s.used.left; c <= right; c++) {
          const cell = ws.getCell(r, c);
          row.push(readCell(cell, literals.get(cell.address), pkg.date1904).display);
        }
        previewRows.push(row);
      }
      if (s.used.right > right) issues.push(`The preview shows the first ${LIMITS.maxColumns} of ${info.columnCount} columns.`);
    } else {
      issues.push(`"${sheetUsed}" has no values.`);
    }
    if (s.merges.length) issues.push(`${s.merges.length} merged range${s.merges.length === 1 ? "" : "s"} (${s.merges.slice(0, 6).join(", ")}${s.merges.length > 6 ? ", …" : ""}). Only the top-left cell of a merge holds a value; nothing is copied into the other cells.`);
    if (s.formulasWithoutCache) issues.push(`${s.formulasWithoutCache} formula cell${s.formulasWithoutCache === 1 ? " has" : "s have"} no saved result and will be imported as unreadable. Formulas are never executed.`);
    if (s.formulaCells - s.formulasWithoutCache > 0) issues.push(`${s.formulaCells - s.formulasWithoutCache} formula cell${s.formulaCells - s.formulasWithoutCache === 1 ? "" : "s"} will use the result last saved in the file (marked as cached).`);
    if (info.rowCount > LIMITS.maxStructuredRows + 1) issues.push(`The sheet has ${info.rowCount} rows; at most ${LIMITS.maxStructuredRows} data rows can be imported at once. Enter a smaller range.`);
    if (info.columnCount > LIMITS.maxColumns) issues.push(`The sheet has ${info.columnCount} columns; at most ${LIMITS.maxColumns} can be imported. Enter a narrower range.`);
  } else {
    previewRows = [];
  }
  return { kind: "xlsx", sheets, sheetUsed, previewRows, issues };
}

function orderedWorksheets(pkg: XlsxPackage, wb: ExcelJS.Workbook): ExcelJS.Worksheet[] {
  const byName = new Map(wb.worksheets.map((w) => [w.name, w]));
  const out: ExcelJS.Worksheet[] = [];
  for (const s of pkg.sheets) {
    const ws = byName.get(s.name);
    if (ws && !s.isChartsheet) {
      out.push(ws);
      byName.delete(s.name);
    }
  }
  return [...out, ...byName.values()];
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

type XlsxInput = Extract<SelectionInput, { kind: "xlsx_range" }>;

function planRange(ws: ExcelJS.Worksheet, input: { range: string | null; headerRowCount: number }): CellRange {
  const { used } = sheetStats(ws);
  if (!used) throw new AppError("invalid_selection", `The sheet "${ws.name}" has no values.`);
  let range: CellRange;
  if (input.range === null) range = used;
  else {
    const parsed = parseRange(input.range);
    if (!parsed) throw new AppError("invalid_selection", `"${input.range}" is not a valid cell range.`);
    if (!intersects(parsed, used)) throw new AppError("invalid_selection", `The range ${input.range} contains no values. The sheet's values are in ${formatRange(used)}.`);
    // Rows/columns past the last value are empty by definition; trim them.
    range = { ...parsed, bottom: Math.min(parsed.bottom, used.bottom), right: Math.min(parsed.right, used.right) };
  }
  const columns = range.right - range.left + 1;
  const dataRows = range.bottom - range.top + 1 - input.headerRowCount;
  if (dataRows <= 0) throw new AppError("invalid_selection", "The range has no data rows below the header row.");
  if (columns > LIMITS.maxColumns) {
    throw new AppError("too_many_columns", `The range has ${columns} columns; the limit is ${LIMITS.maxColumns}. Enter a narrower range.`, {
      details: { columns, limit: LIMITS.maxColumns },
    });
  }
  if (dataRows > LIMITS.maxStructuredRows) {
    throw new AppError("too_many_rows", `The range has ${dataRows} data rows; the limit is ${LIMITS.maxStructuredRows}. Enter a smaller range.`, {
      details: { rows: dataRows, limit: LIMITS.maxStructuredRows },
    });
  }
  return range;
}

export async function resolveXlsxSelection(source: Source, bytes: Uint8Array, input: XlsxInput): Promise<ResolvedSelection> {
  inspectXlsxPackage(bytes);
  const wb = await loadWorkbook(bytes);
  const ws = getSheet(wb, input.sheetName);
  const range = planRange(ws, input);
  return { kind: "xlsx_range", sourceId: source.id, sheetName: ws.name, range: formatRange(range), headerRowCount: input.headerRowCount };
}

export async function parseXlsxSelection(
  source: Source,
  bytes: Uint8Array,
  selection: Extract<SourceSelection, { kind: "xlsx_range" }>,
): Promise<ParsedDatasetDraft> {
  const pkg = inspectXlsxPackage(bytes);
  const wb = await loadWorkbook(bytes);
  const ws = getSheet(wb, selection.sheetName);
  const range = planRange(ws, selection);
  const literals = readLiteralValues(bytes, pkg, ws.name);
  const sheetState = pkg.sheets.find((s) => s.name === ws.name)?.state ?? "visible";
  const merges = mergedRanges(ws).flatMap((m) => {
    const r = parseRange(m);
    return r && intersects(r, range) ? [{ text: m, r }] : [];
  });

  const read = (r: number, c: number) => {
    const cell = ws.getCell(r, c);
    return readCell(cell, literals.get(cell.address), pkg.date1904);
  };

  const labels: string[] = [];
  const headerMerged: string[] = [];
  for (let c = range.left; c <= range.right; c++) {
    if (selection.headerRowCount === 0) {
      labels.push(`Column ${columnLetter(c)}`);
      continue;
    }
    const h = read(range.top, c);
    if (h.kind === "merged_part") {
      const master = ws.getCell(range.top, c).master.address;
      headerMerged.push(cellAddress(range.top, c));
      labels.push(`Column ${columnLetter(c)} (merged with ${master})`);
    } else labels.push(h.text ?? h.display ?? `Column ${columnLetter(c)}`);
  }

  const rows: DraftRowInput[] = [];
  const kinds: CellKind[][] = [];
  const firstDataRow = range.top + selection.headerRowCount;
  for (let r = firstDataRow; r <= range.bottom; r++) {
    const cells: DraftCellInput[] = [];
    const rowKinds: CellKind[] = [];
    for (let c = range.left; c <= range.right; c++) {
      const reading = read(r, c);
      const address = cellAddress(r, c);
      rowKinds.push(reading.kind);
      cells.push({
        rawText: reading.rawText,
        text: reading.text,
        missingReason: reading.missingReason,
        notes: reading.notes,
        locator: { type: "xlsx_cell", sheetName: ws.name, address },
        availability: "precise",
        provenanceLabel: `${ws.name}!${address}`,
      });
    }
    rows.push({ sourceOrder: r - firstDataRow, cells });
    kinds.push(rowKinds);
  }

  const built = buildDraft({ sourceId: source.id, selectionId: selection.id, labels, rows });
  const issues: ImportIssue[] = [];
  const collect = (k: CellKind) => {
    const cellIds: string[] = [];
    const rowIds = new Set<string>();
    const evidence: string[] = [];
    kinds.forEach((rk, ri) =>
      rk.forEach((kind, ci) => {
        if (kind !== k) return;
        cellIds.push(built.cellIds[ri][ci]);
        rowIds.add(built.rows[ri].id);
        evidence.push(`${ws.name}!${cellAddress(firstDataRow + ri, range.left + ci)}`);
      }),
    );
    return { cellIds, rowIds: [...rowIds], evidence };
  };

  if (merges.length > 0 || headerMerged.length > 0) {
    const m = collect("merged_part");
    issues.push(
      issue(
        "extraction_issue",
        "review",
        `The selection overlaps ${merges.length} merged range${merges.length === 1 ? "" : "s"}. Each value is kept only in the merge's top-left cell; the other cells are marked "not applicable" rather than filled in.`,
        { ...m, evidence: [...merges.map((x) => `Merged ${x.text}`), ...m.evidence] },
      ),
    );
  }
  if (headerMerged.length > 0 || looksLikeSecondHeader(rows)) {
    issues.push(
      issue(
        "type_mismatch",
        "review",
        "The header may span more than one row (merged header cells or a text row above numeric columns). Only one header row is used; check the column labels.",
        { evidence: headerMerged.map((a) => `Header cell ${ws.name}!${a} is part of a merge`) },
      ),
    );
  }
  const uncached = collect("uncached_formula");
  if (uncached.cellIds.length) {
    issues.push(issue("missing_values", "review", `${uncached.cellIds.length} formula cell${uncached.cellIds.length === 1 ? " has" : "s have"} no saved result, so ${uncached.cellIds.length === 1 ? "it is" : "they are"} marked unreadable. Formulas are never executed.`, uncached));
  }
  const cached = collect("cached_formula");
  if (cached.cellIds.length) {
    issues.push(issue("extraction_issue", "info", `${cached.cellIds.length} value${cached.cellIds.length === 1 ? " is a cached formula result" : "s are cached formula results"} as last saved in the file; nothing was recalculated.`, cached));
  }
  const errors = collect("error");
  if (errors.cellIds.length) {
    issues.push(issue("missing_values", "review", `${errors.cellIds.length} cell${errors.cellIds.length === 1 ? " contains" : "s contain"} an Excel error value (such as #DIV/0!) and ${errors.cellIds.length === 1 ? "is" : "are"} marked invalid.`, errors));
  }
  const emptyRows = rows.flatMap((r, i) => (r.cells.every((c) => c.text === null && c.missingReason === "blank") ? [i] : []));
  if (emptyRows.length) {
    issues.push(
      issue("missing_values", "info", `${emptyRows.length} row${emptyRows.length === 1 ? " in the range is" : "s in the range are"} completely empty. They are kept so row positions match the sheet.`, {
        rowIds: emptyRows.map((i) => built.rows[i].id),
        evidence: emptyRows.map((i) => `Row ${firstDataRow + i}`),
      }),
    );
  }
  if (sheetState !== "visible") {
    issues.push(issue("extraction_issue", "info", `"${ws.name}" is a hidden sheet in the workbook.`));
  }

  return {
    title: `${baseName(source.filename)} — ${ws.name}`.slice(0, 300),
    description: `Imported from ${source.filename}, sheet "${ws.name}", range ${formatRange(range)} (${selection.headerRowCount ? "first row used as header" : "no header row"}). Stored values are kept; number formats are not applied and formulas are not executed.`,
    extractionMethod: "deterministic_parser",
    coverage: "complete_selection",
    coverageNote: null,
    extraction: null,
    columns: built.columns,
    rows: built.rows,
    provenance: built.provenance,
    issues,
  };
}

/** First data row is text where most rows below are numbers: a likely second header row. */
function looksLikeSecondHeader(rows: DraftRowInput[]): boolean {
  if (rows.length < 3) return false;
  const first = rows[0].cells;
  let textOverNumeric = 0;
  for (let c = 0; c < first.length; c++) {
    const t = first[c].text;
    if (t === null || isCanonicalDecimal(t)) continue;
    const below = rows.slice(1, 51).map((r) => r.cells[c].text).filter((v): v is string => v !== null);
    if (below.length >= 2 && below.filter(isCanonicalDecimal).length / below.length >= 0.8) textOverNumeric++;
  }
  return textOverNumeric > 0 && textOverNumeric >= Math.ceil(first.filter((c) => c.text !== null).length / 2);
}
