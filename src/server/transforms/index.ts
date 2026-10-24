import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import {
  AppError,
  DecimalStringSchema,
  IsoDateTimeSchema,
  type Cell,
  type CellChange,
  type CellState,
  type Column,
  type DatasetVersionSnapshot,
  type Provenance,
  type Row,
  type TransformOperation,
} from "@/contracts";
import { isValidCalendarDate, dayMonthReadings, parseDateText } from "./dates";
import { parseNumericText } from "./numeric";
import { findConversion } from "./unit-registry";

/**
 * Transform service seam (owner: Cleaning specialist).
 * Pure and deterministic given (base snapshot, operation): preview and apply call the same function.
 * Only ids that embed ctx.operationId (new provenance) differ between preview and apply.
 */

export interface TransformContext {
  /** Id of the operation that will be recorded if applied; used for derived/user_edit provenance. */
  operationId: string;
  now: string;
  sourceId: string;
  sourceSelectionId: string;
}

export interface TransformComputation {
  columns: Column[];
  /** Full resulting rows in sourceOrder. Unchanged rows/cells keep their ids. */
  rows: Row[];
  newProvenance: Provenance[];
  /** All actual cell changes (orchestration paginates them for preview). */
  changes: CellChange[];
  removedRowIds: string[];
  failedCellIds: string[];
  affectedCount: number;
  warnings: string[];
  precisionEffects: string[];
  /** One-line human summary for history, e.g. "Parsed 12 cells in “Revenue” as numbers". */
  summary: string;
}

export function computeTransform(
  base: DatasetVersionSnapshot,
  provenance: Provenance[],
  operation: TransformOperation,
  ctx: TransformContext,
): TransformComputation {
  void provenance; // existing provenance ids are carried on the cells and never rewritten
  const w = new Work(base, ctx);
  switch (operation.type) {
    case "edit_cell":
      return editCell(w, operation);
    case "rename_column":
      return renameColumn(w, operation);
    case "set_column_unit":
      return setColumnUnit(w, operation);
    case "trim_text":
      return trimText(w, operation);
    case "parse_numeric":
      return parseNumeric(w, operation);
    case "parse_date":
      return parseDate(w, operation);
    case "mark_missing":
      return markMissing(w, operation);
    case "remove_selected_rows":
      return removeRows(w, operation);
    case "remove_exact_duplicates":
      return removeDuplicates(w, operation);
    case "convert_unit":
      return convertUnit(w, operation);
    case "set_review_status":
      return setReviewStatus(w, operation);
  }
}

// ---------------------------------------------------------------------------
// Working state
// ---------------------------------------------------------------------------

type Op<T extends TransformOperation["type"]> = Extract<TransformOperation, { type: T }>;

const stateOf = (c: Cell): CellState => ({
  rawText: c.rawText,
  currentValue: c.currentValue,
  valueType: c.valueType,
  missingReason: c.missingReason,
});

const sameState = (a: CellState, b: CellState) =>
  a.rawText === b.rawText && a.currentValue === b.currentValue && a.valueType === b.valueType && a.missingReason === b.missingReason;

function deterministicId(prefix: "prov", ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32)}`;
}

const quote = (label: string) => `“${label}”`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

class Work {
  columns: Column[];
  rows: Row[];
  readonly changes: CellChange[] = [];
  readonly failedCellIds: string[] = [];
  readonly newProvenance: Provenance[] = [];
  readonly warnings: string[] = [];
  readonly precisionEffects: string[] = [];
  removedRowIds: string[] = [];
  private derivedProvId: string | null = null;
  private readonly rowIndex = new Map<string, number>();

  constructor(
    readonly base: DatasetVersionSnapshot,
    readonly ctx: TransformContext,
  ) {
    this.columns = base.version.columns;
    this.rows = [...base.rows];
    this.rows.forEach((r, i) => this.rowIndex.set(r.id, i));
  }

  column(id: string): Column {
    const c = this.columns.find((x) => x.id === id);
    if (!c) throw new AppError("bad_request", "Unknown column for this version.");
    return c;
  }

  setColumn(id: string, patch: Partial<Column>) {
    this.columns = this.columns.map((c) => (c.id === id ? { ...c, ...patch } : c));
  }

  /** Validates explicit row ids (deduplicated, in sourceOrder). */
  scopeRows(rowIds: string[] | null): Row[] {
    if (rowIds === null) return this.rows;
    const wanted = new Set(rowIds);
    for (const id of wanted) if (!this.rowIndex.has(id)) throw new AppError("bad_request", "Unknown row for this version.");
    return this.rows.filter((r) => wanted.has(r.id));
  }

  /** Provenance record shared by every cell an operation derives. */
  derivedProvenance(label: string): string {
    if (this.derivedProvId) return this.derivedProvId;
    const id = deterministicId("prov", this.ctx.operationId, "derived_operation");
    this.newProvenance.push({
      id,
      sourceId: this.ctx.sourceId,
      sourceSelectionId: this.ctx.sourceSelectionId,
      locator: { type: "derived_operation", operationId: this.ctx.operationId },
      locatorOrigin: "operation",
      locatorAvailability: "unavailable",
      label: label.slice(0, 500),
      extractionMethod: "manual",
      createdAt: this.ctx.now,
    });
    this.derivedProvId = id;
    return id;
  }

  /** Replaces one cell; records a CellChange when its state differs. Returns whether anything changed. */
  replaceCell(row: Row, columnId: string, next: Cell, recordEvenIfStateSame = false): boolean {
    const idx = this.rowIndex.get(row.id)!;
    const current = this.rows[idx];
    const prev = current.cells[columnId];
    if (!prev) throw new AppError("bad_request", "Unknown cell for this version.");
    const before = stateOf(prev);
    const after = stateOf(next);
    const stateChanged = !sameState(before, after);
    this.rows[idx] = { ...current, cells: { ...current.cells, [columnId]: next } };
    if (stateChanged || recordEvenIfStateSame) {
      this.changes.push({ rowId: row.id, columnId, cellId: prev.id, before, after });
      return true;
    }
    return false;
  }

  /** Keeps a failed cell unchanged except for an explanatory note. */
  flag(row: Row, columnId: string, note: string) {
    const idx = this.rowIndex.get(row.id)!;
    const current = this.rows[idx];
    const cell = current.cells[columnId];
    this.failedCellIds.push(cell.id);
    if (cell.notes.includes(note)) return;
    const notes = [...cell.notes, note.slice(0, 1000)].slice(-50);
    this.rows[idx] = { ...current, cells: { ...current.cells, [columnId]: { ...cell, notes } } };
  }

  cellsInColumn(columnId: string): Array<{ row: Row; cell: Cell }> {
    const out: Array<{ row: Row; cell: Cell }> = [];
    for (const row of this.rows) {
      const cell = row.cells[columnId];
      if (cell) out.push({ row, cell });
    }
    return out;
  }

  done(summary: string, affectedCount = this.changes.length): TransformComputation {
    // Changes are reported in sourceOrder, then column order, independent of processing order.
    const colOrder = new Map(this.columns.map((c, i) => [c.id, i]));
    const rowOrder = new Map(this.base.rows.map((r) => [r.id, r.sourceOrder]));
    this.changes.sort(
      (a, b) => (rowOrder.get(a.rowId)! - rowOrder.get(b.rowId)!) || (colOrder.get(a.columnId)! - colOrder.get(b.columnId)!),
    );
    return {
      columns: this.columns,
      rows: this.rows,
      newProvenance: this.newProvenance,
      changes: this.changes,
      removedRowIds: this.removedRowIds,
      failedCellIds: this.failedCellIds,
      affectedCount,
      warnings: this.warnings,
      precisionEffects: this.precisionEffects,
      summary: summary.slice(0, 500),
    };
  }
}

const textOf = (cell: Cell): string | null => (typeof cell.currentValue === "string" ? cell.currentValue : null);
const isTextLike = (cell: Cell) => cell.valueType === "text" || cell.valueType === "unknown";

function appendNote(notes: string[], note: string | null | undefined): string[] {
  if (!note || notes.includes(note)) return notes;
  return [...notes, note.slice(0, 1000)].slice(-50);
}

// ---------------------------------------------------------------------------
// edit_cell
// ---------------------------------------------------------------------------

function validateTypedValue(value: string | boolean, type: Cell["valueType"]): string | null {
  switch (type) {
    case "decimal":
      if (typeof value !== "string" || !DecimalStringSchema.safeParse(value).success) {
        return "Enter a plain decimal number such as -1234.50 (no grouping separators or symbols).";
      }
      try {
        new Decimal(value);
      } catch {
        return "Enter a plain decimal number such as -1234.50.";
      }
      return null;
    case "date": {
      const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
      if (!m || !isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]))) return "Enter a real calendar date as YYYY-MM-DD.";
      return null;
    }
    case "datetime":
      if (typeof value !== "string" || !IsoDateTimeSchema.safeParse(value).success || !value.endsWith("Z")) {
        return "Enter a UTC date-time such as 2026-01-31T12:00:00.000Z.";
      }
      return null;
    case "boolean":
      return typeof value === "boolean" ? null : "A boolean value must be true or false.";
    case "text":
    case "unknown":
      return typeof value === "string" ? null : "Text values must be strings.";
  }
}

function editCell(w: Work, op: Op<"edit_cell">): TransformComputation {
  const column = w.column(op.columnId);
  const [row] = w.scopeRows([op.rowId]);
  const cell = row.cells[op.columnId];
  if (!cell || cell.id !== op.cellId) throw new AppError("bad_request", "That cell does not belong to the given row and column.");
  if (op.newValue === null && op.missingReason === null) throw new AppError("bad_request", "A missing value needs a reason.");
  if (op.newValue !== null && op.missingReason !== null) throw new AppError("bad_request", "A value cannot also be marked missing.");
  if (op.newValue !== null) {
    const problem = validateTypedValue(op.newValue, op.explicitType);
    if (problem) throw new AppError("bad_request", problem);
  }
  const next: Cell = {
    ...cell,
    currentValue: op.newValue,
    valueType: op.explicitType,
    missingReason: op.missingReason,
    origin: "user_edit",
    reviewStatus: "corrected",
    notes: appendNote(cell.notes, op.note),
  };
  const stateSame = sameState(stateOf(cell), stateOf(next));
  if (stateSame && next.notes === cell.notes) return w.done("No change", 0);

  const provId = deterministicId("prov", w.ctx.operationId, "user_edit", cell.id);
  w.newProvenance.push({
    id: provId,
    sourceId: w.ctx.sourceId,
    sourceSelectionId: w.ctx.sourceSelectionId,
    locator: { type: "user_edit", operationId: w.ctx.operationId },
    locatorOrigin: "operation",
    locatorAvailability: "unavailable",
    label: `Edited by user in ${quote(column.label)}`.slice(0, 500),
    extractionMethod: "manual",
    createdAt: w.ctx.now,
  });
  next.provenanceIds = [...cell.provenanceIds, provId];
  w.replaceCell(row, op.columnId, next, true);
  if (column.dataType !== op.explicitType && op.newValue !== null && column.dataType !== "unknown") {
    w.warnings.push(`The new value is typed ${op.explicitType}, but the column is typed ${column.dataType}.`);
  }
  if (cell.origin === "estimated") {
    w.warnings.push("This replaces an estimated value with your entry; the original estimate and its raw text stay in history.");
  }
  const desc = op.newValue === null ? `marked missing (${op.missingReason})` : `set to ${String(op.newValue)}`;
  return w.done(`Edited 1 cell in ${quote(column.label)}: ${desc}`.slice(0, 500), 1);
}

// ---------------------------------------------------------------------------
// Column metadata
// ---------------------------------------------------------------------------

function renameColumn(w: Work, op: Op<"rename_column">): TransformComputation {
  const column = w.column(op.columnId);
  const label = op.newLabel.trim();
  if (!label) throw new AppError("bad_request", "A column name cannot be blank.");
  if (label === column.label) return w.done("No change", 0);
  w.setColumn(column.id, { label });
  if (w.columns.some((c) => c.id !== column.id && c.label === label)) {
    w.warnings.push(`Another column is also named ${quote(label)}. Columns stay distinct by id, but exports will show the same header twice.`);
  }
  return w.done(`Renamed column ${quote(column.label)} to ${quote(label)}`, 1);
}

function setColumnUnit(w: Work, op: Op<"set_column_unit">): TransformComputation {
  const column = w.column(op.columnId);
  const unit = op.unit === null ? null : op.unit.trim() || null;
  if (unit === column.unit && op.currency === column.currency) return w.done("No change", 0);
  w.setColumn(column.id, { unit, currency: op.currency });
  w.warnings.push("Only the column's unit label changes. No values are converted.");
  const parts = [unit !== column.unit ? `unit ${unit ?? "none"}` : null, op.currency !== column.currency ? `currency ${op.currency ?? "none"}` : null]
    .filter(Boolean)
    .join(", ");
  return w.done(`Set ${parts} on ${quote(column.label)}`, 1);
}

// ---------------------------------------------------------------------------
// trim_text
// ---------------------------------------------------------------------------

function trimText(w: Work, op: Op<"trim_text">): TransformComputation {
  const columns = [...new Set(op.columnIds)].map((id) => w.column(id));
  const rows = w.scopeRows(op.rowIds);
  let emptied = 0;
  for (const column of columns) {
    for (const row of rows) {
      const cell = row.cells[column.id];
      if (!cell || !isTextLike(cell)) continue;
      const text = textOf(cell);
      if (text === null) continue;
      const trimmed = text.trim();
      if (trimmed === text) continue;
      if (trimmed === "") emptied += 1;
      const prov = w.derivedProvenance("Trimmed surrounding whitespace");
      w.replaceCell(row, column.id, { ...cell, currentValue: trimmed, provenanceIds: [...cell.provenanceIds, prov] });
    }
  }
  if (emptied > 0) {
    w.warnings.push(`${plural(emptied, "cell")} became empty text after trimming. They are not marked missing; use “Mark missing” to do that explicitly.`);
  }
  const names = columns.map((c) => quote(c.label)).join(", ");
  return w.done(`Trimmed whitespace in ${plural(w.changes.length, "cell")} of ${names}`);
}

// ---------------------------------------------------------------------------
// parse_numeric
// ---------------------------------------------------------------------------

function parseNumeric(w: Work, op: Op<"parse_numeric">): TransformComputation {
  const column = w.column(op.columnId);
  if (op.locale.groupingSeparator !== null && op.locale.groupingSeparator === op.locale.decimalSeparator) {
    throw new AppError("bad_request", "The decimal and grouping separators must differ.");
  }
  if (op.currencyPolicy.mode === "strip_symbol" && column.currency !== null && column.currency !== op.currencyPolicy.currency) {
    throw new AppError("bad_request", `This column already records currency ${column.currency}. Change it explicitly before parsing as ${op.currencyPolicy.currency}.`);
  }

  type Parsed = { row: Row; cell: Cell; value: string; hadPercent: boolean };
  const parsed: Parsed[] = [];
  let grouped = 0;
  let stripped = 0;
  let parens = 0;
  for (const { row, cell } of w.cellsInColumn(column.id)) {
    if (cell.currentValue === null || cell.valueType === "decimal") continue;
    const text = textOf(cell);
    if (text === null) {
      w.flag(row, column.id, "Parse as number: the value is not text and was left unchanged.");
      continue;
    }
    const r = parseNumericText(text, op);
    if (!r.ok) {
      w.flag(row, column.id, `Parse as number: ${r.reason} Left unchanged.`);
      continue;
    }
    parsed.push({ row, cell, value: r.value, hadPercent: r.hadPercent });
    if (r.hadGrouping) grouped += 1;
    if (r.hadCurrency) stripped += 1;
    if (r.hadParentheses) parens += 1;
  }

  const percentCount = parsed.filter((p) => p.hadPercent).length;
  const representation = op.percentPolicy === "keep_percent_number" ? "percent_number" : op.percentPolicy === "to_fraction" ? "fraction" : null;
  if (percentCount > 0 && representation && column.percentRepresentation !== null && column.percentRepresentation !== representation) {
    throw new AppError("bad_request", `This column already stores percentages as ${column.percentRepresentation.replace("_", " ")}s; choose the same representation.`);
  }
  let accepted = parsed;
  if (percentCount > 0 && percentCount < parsed.length) {
    // Values written without "%" next to values with "%" are not silently given one representation.
    accepted = [];
    for (const p of parsed) {
      if (p.hadPercent) accepted.push(p);
      else w.flag(p.row, column.id, "Parse as number: no percent sign while other values in this column have one; left unchanged so its meaning is not guessed.");
    }
    w.warnings.push(`${plural(parsed.length - percentCount, "value")} had no % sign while ${percentCount} did; those were left unchanged and flagged.`);
  }

  const prov = accepted.length > 0 ? w.derivedProvenance(`Parsed as numbers in ${quote(column.label)}`) : null;
  for (const p of accepted) {
    w.replaceCell(p.row, column.id, { ...p.cell, currentValue: p.value, valueType: "decimal", missingReason: null, provenanceIds: [...p.cell.provenanceIds, prov!] });
  }

  if (accepted.length > 0) {
    const patch: Partial<Column> = {};
    const allDecimal = w.cellsInColumn(column.id).every(({ cell }) => cell.currentValue === null || cell.valueType === "decimal");
    if (allDecimal) patch.dataType = "decimal";
    if (percentCount > 0 && representation && accepted.some((p) => p.hadPercent)) patch.percentRepresentation = representation;
    if (op.currencyPolicy.mode === "strip_symbol") patch.currency = op.currencyPolicy.currency;
    w.setColumn(column.id, patch);
    if (!allDecimal) w.warnings.push(`The column stays typed ${column.dataType} because some of its values are not numbers yet.`);
  }

  const failed = w.failedCellIds.length;
  if (failed > 0) w.warnings.push(`${plural(failed, "cell")} could not be parsed and ${failed === 1 ? "was" : "were"} left unchanged and flagged.`);
  w.precisionEffects.push("Digits are kept exactly as written, including trailing zeros; values are not rounded.");
  if (grouped > 0) w.precisionEffects.push(`Grouping separators were removed from ${plural(grouped, "value")}; digits are unchanged.`);
  if (percentCount > 0 && op.percentPolicy === "to_fraction") {
    w.precisionEffects.push(`${plural(accepted.filter((p) => p.hadPercent).length, "percentage")} divided by 100 exactly (two more decimal places, e.g. 12.5% → 0.125).`);
  }
  if (percentCount > 0 && op.percentPolicy === "keep_percent_number") {
    w.precisionEffects.push("Percentages are stored as percent numbers (12.5% → 12.5); the column records that representation.");
  }
  if (stripped > 0 && op.currencyPolicy.mode === "strip_symbol") {
    w.precisionEffects.push(`Currency markers were removed from ${plural(stripped, "value")}; the column records ${op.currencyPolicy.currency}.`);
  }
  if (parens > 0) w.precisionEffects.push(`${plural(parens, "value")} in parentheses became negative numbers.`);
  return w.done(`Parsed ${plural(w.changes.length, "cell")} in ${quote(column.label)} as numbers${failed ? ` (${failed} left unchanged)` : ""}`);
}

// ---------------------------------------------------------------------------
// parse_date
// ---------------------------------------------------------------------------

function parseDate(w: Work, op: Op<"parse_date">): TransformComputation {
  const column = w.column(op.columnId);
  if (op.timezonePolicy === "utc" && op.format !== "ISO_8601") {
    throw new AppError("bad_request", "The UTC policy needs the ISO 8601 format with explicit time zones. Use date-only for calendar dates.");
  }
  const hasTyped = w.cellsInColumn(column.id).some(({ cell }) => cell.valueType === "date" || cell.valueType === "datetime");
  if (hasTyped && column.datePolicy && (column.datePolicy.format !== op.format || column.datePolicy.timezone !== op.timezonePolicy)) {
    throw new AppError("bad_request", `This column already holds dates parsed as ${column.datePolicy.format} (${column.datePolicy.timezone}). Use the same policy.`);
  }

  const candidates = w.cellsInColumn(column.id).filter(({ cell }) => cell.currentValue !== null && cell.valueType !== "date" && cell.valueType !== "datetime");
  const orderSensitive = op.format === "MM/DD/YYYY" || op.format === "DD/MM/YYYY" || op.format === "DD.MM.YYYY";
  const chosenDm = op.format !== "MM/DD/YYYY";
  let contradicted = 0;
  if (orderSensitive) {
    for (const { cell } of candidates) {
      const text = textOf(cell);
      const r = text === null ? null : dayMonthReadings(text);
      if (r && (chosenDm ? !r.dm && r.md : !r.md && r.dm)) contradicted += 1;
    }
  }

  let ambiguousRead = 0;
  let periods = 0;
  const prov = { id: null as string | null };
  for (const { row, cell } of candidates) {
    const text = textOf(cell);
    if (text === null) {
      w.flag(row, column.id, "Parse as date: the value is not text and was left unchanged.");
      continue;
    }
    const readings = orderSensitive ? dayMonthReadings(text) : null;
    const ambiguous = !!readings && readings.dm && readings.md && !isSameDayMonth(text);
    if (ambiguous && contradicted > 0) {
      w.flag(row, column.id, `Parse as date: could be day/month or month/day, and other values in this column only fit the opposite order to ${op.format}. Left unchanged.`);
      continue;
    }
    const r = parseDateText(text, op.format, op.timezonePolicy);
    if (!r.ok) {
      w.flag(row, column.id, `Parse as date: ${r.reason} Left unchanged.`);
      continue;
    }
    if (ambiguous) ambiguousRead += 1;
    prov.id ??= w.derivedProvenance(`Parsed as dates (${op.format}) in ${quote(column.label)}`);
    let notes = cell.notes;
    if (r.period) {
      periods += 1;
      notes = appendNote(notes, `${r.period === "month" ? "Month" : "Year"} period “${text.trim()}” stored as its first day (${r.value}).`);
    }
    w.replaceCell(row, column.id, { ...cell, currentValue: r.value, valueType: r.valueType, missingReason: null, notes, provenanceIds: [...cell.provenanceIds, prov.id] });
  }

  if (w.changes.length > 0) {
    const cells = w.cellsInColumn(column.id);
    const allDates = cells.every(({ cell }) => cell.currentValue === null || cell.valueType === "date");
    const allDatetimes = cells.every(({ cell }) => cell.currentValue === null || cell.valueType === "datetime");
    w.setColumn(column.id, {
      datePolicy: { format: op.format, timezone: op.timezonePolicy },
      ...(allDates ? { dataType: "date" as const } : allDatetimes ? { dataType: "datetime" as const } : {}),
    });
    if (!allDates && !allDatetimes) w.warnings.push(`The column stays typed ${column.dataType} because some of its values are not dates yet.`);
  }
  if (contradicted > 0) {
    w.warnings.push(`${plural(contradicted, "value")} only fit${contradicted === 1 ? "s" : ""} the opposite day/month order to ${op.format}; the chosen format may be wrong for this column.`);
  }
  const failed = w.failedCellIds.length;
  if (failed > 0) w.warnings.push(`${plural(failed, "cell")} could not be parsed and ${failed === 1 ? "was" : "were"} left unchanged and flagged.`);
  if (ambiguousRead > 0) w.precisionEffects.push(`${plural(ambiguousRead, "value")} could be read either way and ${ambiguousRead === 1 ? "was" : "were"} read as ${op.format}, as you chose.`);
  if (periods > 0) w.precisionEffects.push(`${plural(periods, "period value")} stored as the first day of the period; the column records the ${op.format} format.`);
  w.precisionEffects.push(
    op.timezonePolicy === "date_only" ? "Calendar dates are stored without a time zone." : "Instants are converted to UTC using each value's own offset.",
  );
  return w.done(`Parsed ${plural(w.changes.length, "cell")} in ${quote(column.label)} as dates (${op.format})${failed ? ` (${failed} left unchanged)` : ""}`);
}

function isSameDayMonth(text: string): boolean {
  const m = /^(\d{1,2})[/.-](\d{1,2})/.exec(text.trim());
  return !!m && Number(m[1]) === Number(m[2]);
}

// ---------------------------------------------------------------------------
// mark_missing
// ---------------------------------------------------------------------------

function markMissing(w: Work, op: Op<"mark_missing">): TransformComputation {
  const column = w.column(op.columnId);
  const rows = w.scopeRows(op.rowIds);
  const tokens = new Set(op.explicitTokens);
  for (const row of rows) {
    const cell = row.cells[column.id];
    if (!cell) continue;
    const text = textOf(cell);
    if (text === null || !tokens.has(text)) continue;
    const prov = w.derivedProvenance(`Marked explicit tokens as missing in ${quote(column.label)}`);
    w.replaceCell(row, column.id, { ...cell, currentValue: null, missingReason: op.missingReason, provenanceIds: [...cell.provenanceIds, prov] });
  }
  w.precisionEffects.push("Missing values stay missing; they are never replaced with zero. Raw text is kept.");
  const list = op.explicitTokens.map((t) => `“${t}”`).join(", ");
  return w.done(`Marked ${plural(w.changes.length, "cell")} in ${quote(column.label)} matching ${list} as missing (${op.missingReason})`);
}

// ---------------------------------------------------------------------------
// Row removal
// ---------------------------------------------------------------------------

function removeRows(w: Work, op: Op<"remove_selected_rows">): TransformComputation {
  const remove = new Set(w.scopeRows(op.rowIds).map((r) => r.id));
  w.removedRowIds = w.rows.filter((r) => remove.has(r.id)).map((r) => r.id);
  w.rows = w.rows.filter((r) => !remove.has(r.id));
  return w.done(`Removed ${plural(w.removedRowIds.length, "selected row")}`, w.removedRowIds.length);
}

export function duplicateKey(row: Row, columnIds: string[]): string {
  return JSON.stringify(
    columnIds.map((id) => {
      const c = row.cells[id];
      return c ? [c.currentValue, c.valueType, c.missingReason] : ["absent"];
    }),
  );
}

function removeDuplicates(w: Work, op: Op<"remove_exact_duplicates">): TransformComputation {
  const columnIds = [...new Set(op.columnIds)];
  const columns = columnIds.map((id) => w.column(id));
  const seen = new Set<string>();
  const remove = new Set<string>();
  const ordered = [...w.rows].sort((a, b) => a.sourceOrder - b.sourceOrder);
  for (const row of ordered) {
    const key = duplicateKey(row, columnIds);
    if (seen.has(key)) remove.add(row.id);
    else seen.add(key);
  }
  w.removedRowIds = ordered.filter((r) => remove.has(r.id)).map((r) => r.id);
  w.rows = w.rows.filter((r) => !remove.has(r.id));
  if (remove.size > 0) {
    w.warnings.push("Repeated rows can be genuine repeated measurements. Check each removed row before applying.");
    if (columnIds.length < w.columns.length) {
      w.warnings.push(`Only ${plural(columnIds.length, "column")} ${columnIds.length === 1 ? "is" : "are"} compared; removed rows may differ in other columns.`);
    }
  }
  const names = columns.map((c) => quote(c.label)).join(", ");
  return w.done(`Removed ${plural(w.removedRowIds.length, "exact repeat")} on ${names}, keeping the first in source order`, w.removedRowIds.length);
}

// ---------------------------------------------------------------------------
// convert_unit (registry-backed, exact)
// ---------------------------------------------------------------------------

function writtenDecimalPlaces(value: string): number {
  const m = /^-?\d+(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!m) return 0;
  return Math.max(0, (m[1]?.length ?? 0) - Number(m[2] ?? "0"));
}

function factorShift(factor: string): number {
  // Decimal places the factor adds (0.001 -> +3) or removes (1000 -> -3, 60 -> -1).
  if (factor.includes(".")) return factor.split(".")[1].length;
  const zeros = /0*$/.exec(factor)![0].length;
  return -zeros;
}

function convertUnit(w: Work, op: Op<"convert_unit">): TransformComputation {
  const column = w.column(op.columnId);
  const conv = findConversion(op.registeredConversionId);
  if (!conv) throw new AppError("unsupported_operation", "That unit conversion is not in the reviewed registry.");
  if (column.unit !== conv.from) {
    throw new AppError("bad_request", `${conv.label} needs the column unit to be “${conv.from}”; it is ${column.unit ? `“${column.unit}”` : "not set"}.`);
  }
  if (column.currency !== null) throw new AppError("unsupported_operation", "Currency columns cannot be unit-converted.");
  if (column.percentRepresentation !== null) throw new AppError("unsupported_operation", "Percentage columns cannot be unit-converted.");

  const cells = w.cellsInColumn(column.id).filter(({ cell }) => cell.currentValue !== null);
  const unparsed = cells.filter(({ cell }) => cell.valueType !== "decimal" || typeof cell.currentValue !== "string").length;
  if (unparsed > 0) {
    // Relabelling the unit while some values stay unconverted text would silently mix units.
    throw new AppError("bad_request", `${plural(unparsed, "value")} in ${quote(column.label)} ${unparsed === 1 ? "is" : "are"} not parsed numbers yet. Parse or mark them missing before converting.`);
  }
  if (cells.length === 0) throw new AppError("bad_request", "This column has no values to convert.");

  const shift = factorShift(conv.factor);
  const prov = w.derivedProvenance(`Converted ${conv.label} in ${quote(column.label)}`);
  for (const { row, cell } of cells) {
    const written = cell.currentValue as string;
    const product = new Decimal(written).mul(conv.factor);
    let value = product.toFixed(Math.max(0, writtenDecimalPlaces(written) + shift));
    if (!new Decimal(value).eq(product)) throw new AppError("internal", "Unit conversion would not be exact.");
    if (product.isZero()) value = value.replace(/^-/, "");
    w.replaceCell(row, column.id, { ...cell, currentValue: value, provenanceIds: [...cell.provenanceIds, prov] });
  }
  w.setColumn(column.id, { unit: conv.to });
  w.precisionEffects.push(`Multiplied exactly by ${conv.factor}. The written resolution is kept: no digits are invented or rounded away.`);
  return w.done(`Converted ${plural(cells.length, "value")} in ${quote(column.label)} from ${conv.from} to ${conv.to}`, cells.length);
}

// ---------------------------------------------------------------------------
// set_review_status
// ---------------------------------------------------------------------------

function setReviewStatus(w: Work, op: Op<"set_review_status">): TransformComputation {
  const wanted = new Set(op.cellIds);
  const found = new Set<string>();
  for (const row of w.rows) {
    for (const [columnId, cell] of Object.entries(row.cells)) {
      if (!wanted.has(cell.id)) continue;
      found.add(cell.id);
      if (cell.reviewStatus === op.reviewStatus) continue;
      w.replaceCell(row, columnId, { ...cell, reviewStatus: op.reviewStatus }, true);
    }
  }
  if (found.size !== wanted.size) throw new AppError("bad_request", "Unknown cell for this version.");
  if (op.reviewStatus === "accepted") {
    w.precisionEffects.push("Marking reviewed records your check only. Estimated values stay estimates.");
  }
  const label = op.reviewStatus === "accepted" ? "reviewed" : op.reviewStatus === "unavailable" ? "unavailable for review" : "unreviewed";
  return w.done(`Marked ${plural(w.changes.length, "cell")} as ${label}`);
}

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

/** Canonical JSON (sorted keys) so the hash is independent of property order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Binds a preview to its base version and exact operation. */
export function operationHash(baseVersionId: string, operation: TransformOperation): string {
  return createHash("sha256").update(`${baseVersionId}\n${canonical(operation)}`).digest("hex");
}
