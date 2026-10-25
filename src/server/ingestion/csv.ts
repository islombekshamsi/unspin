import {
  AppError,
  type CsvDelimiter,
  type ParsedDatasetDraft,
  type ResolvedSelection,
  type SelectionInput,
  type Source,
  type SourceSelection,
  type StructuredInspection,
} from "@/contracts";
import { LIMITS } from "@/server/config/limits";
import {
  CsvSyntaxError,
  DELIMITER_NAMES,
  decodeUtf8Text,
  suggestDelimiter,
  suggestHeader,
  tokenizeCsv,
  type CsvTokens,
} from "./csv-tokenizer";
import { baseName, buildDraft, issue, type DraftCellInput, type DraftRowInput } from "./draft";

const PREVIEW_RECORDS = 50;

export function decodeCsv(bytes: Uint8Array): { text: string; hasBom: boolean } {
  const decoded = decodeUtf8Text(bytes);
  if ("error" in decoded) {
    throw new AppError(
      "unsupported_media_type",
      decoded.error === "nul_bytes"
        ? "This file contains binary data and is not a supported type. Upload a PNG, JPEG, WebP, PDF, CSV, or XLSX file."
        : "This text file is not UTF-8 encoded. Re-save the CSV as UTF-8 and upload it again.",
    );
  }
  return decoded;
}

export function tokenizeOrThrow(text: string, delimiter: string): CsvTokens {
  try {
    return tokenizeCsv(text, delimiter);
  } catch (e) {
    if (e instanceof CsvSyntaxError) {
      throw new AppError("unreadable_source", `The CSV cannot be read: ${e.message} Check the quoting and upload it again.`, {
        details: { line: e.line },
      });
    }
    throw e;
  }
}

/** Upload-time check that the bytes are UTF-8 delimited text with at least one record. */
export function validateCsvBytes(bytes: Uint8Array): { recordCount: number } {
  const { text } = decodeCsv(bytes);
  if (text.trim().length === 0) throw new AppError("no_data_found", "The file is empty.");
  const { delimiter } = suggestDelimiter(text);
  const tokens = tokenizeOrThrow(text, delimiter);
  if (tokens.records.length === 0) throw new AppError("no_data_found", "The file has no records.");
  return { recordCount: tokens.records.length };
}

export function inspectCsv(bytes: Uint8Array, requested: CsvDelimiter | undefined): StructuredInspection {
  const { text, hasBom } = decodeCsv(bytes);
  const suggestion = suggestDelimiter(text);
  const delimiterUsed = requested ?? suggestion.delimiter;
  const allTokens = tokenizeOrThrow(text, delimiterUsed);
  const skip = suggestSkip(allTokens);
  const tokens = skipRecords(allTokens, skip.count);
  const header = suggestHeader(tokens.records);
  const maxFieldCount = tokens.records.reduce((m, r) => Math.max(m, r.fields.length), 0);
  const expected = expectedFieldCount(tokens, header.headerRecordCount);
  const inconsistentRecords = tokens.records.flatMap((r, i) => (r.fields.length !== expected ? [{ recordIndex: i + skip.count, fieldCount: r.fields.length }] : []));
  const issues: string[] = [];
  if (skip.reason) issues.push(skip.reason);
  if (inconsistentRecords.length > 0) {
    issues.push(
      `${inconsistentRecords.length === 1 ? "1 record does" : `${inconsistentRecords.length} records do`} not have ${expected} fields. They are kept; absent fields become empty cells marked as not reported.`,
    );
  }
  if (tokens.emptyLines.length > 0) {
    issues.push(`${tokens.emptyLines.length} empty line${tokens.emptyLines.length === 1 ? " was" : "s were"} skipped (${formatLines(tokens.emptyLines)}).`);
  }
  if (tokens.malformedQuoteRecords.length > 0) {
    issues.push(
      `${tokens.malformedQuoteRecords.length} record${tokens.malformedQuoteRecords.length === 1 ? " has" : "s have"} text after a closing quote; that text is kept as written (${formatLines(tokens.malformedQuoteRecords.map((i) => tokens.records[i].lineStart))}).`,
    );
  }
  if (maxFieldCount > LIMITS.maxColumns) {
    issues.push(`The file has up to ${maxFieldCount} fields per record; at most ${LIMITS.maxColumns} columns can be imported. Choose a column subset.`);
  }
  const dataRecords = tokens.records.length - header.headerRecordCount;
  if (dataRecords > LIMITS.maxStructuredRows) {
    issues.push(`The file has ${dataRecords} data records; at most ${LIMITS.maxStructuredRows} can be imported at once. Choose a record range.`);
  }
  if (requested && requested !== suggestion.delimiter) {
    issues.push(`You chose ${DELIMITER_NAMES[requested].toLowerCase()}; the suggested delimiter is ${DELIMITER_NAMES[suggestion.delimiter].toLowerCase()}.`);
  }
  return {
    kind: "csv",
    suggestedDelimiter: suggestion.delimiter,
    delimiterUsed,
    suggestedSkipLeadingRecords: skip.count,
    skipReason: skip.reason,
    suggestedHeaderRecordCount: header.headerRecordCount,
    hasBom,
    totalRecords: allTokens.records.length,
    previewRecords: allTokens.records.slice(0, skip.count + PREVIEW_RECORDS).map((r) => r.fields),
    maxFieldCount,
    inconsistentRecords,
    issues,
  };
}

const MAX_SUGGESTED_SKIP = 1000;

/** Leading records whose first field starts with "#" are suggested as comments. Only a suggestion; the user decides. */
function suggestSkip(tokens: CsvTokens): { count: number; reason: string | null } {
  let count = 0;
  while (count < tokens.records.length && count < MAX_SUGGESTED_SKIP && (tokens.records[count].fields[0] ?? "").trimStart().startsWith("#")) count++;
  if (count === 0 || count === tokens.records.length) return { count: 0, reason: null };
  const last = tokens.records[count - 1];
  return { count, reason: `The first ${count === 1 ? "record starts" : `${count} records start`} with “#” (lines 1–${last.lineEnd}) and look like comments; skipping them is suggested.` };
}

/** Drops leading records; remaining record indexes start at 0 while line numbers stay physical. */
function skipRecords(tokens: CsvTokens, count: number): CsvTokens {
  if (count === 0) return tokens;
  return {
    ...tokens,
    records: tokens.records.slice(count),
    malformedQuoteRecords: tokens.malformedQuoteRecords.filter((i) => i >= count).map((i) => i - count),
    emptyLines: tokens.emptyLines.filter((l) => l > tokens.records[count - 1].lineEnd),
  };
}

function expectedFieldCount(tokens: CsvTokens, headerRecordCount: number): number {
  if (headerRecordCount === 1 && tokens.records.length > 0) return tokens.records[0].fields.length;
  const counts = new Map<number, number>();
  for (const r of tokens.records) counts.set(r.fields.length, (counts.get(r.fields.length) ?? 0) + 1);
  let mode = 0;
  let best = -1;
  for (const [len, cnt] of counts) if (cnt > best) [mode, best] = [len, cnt];
  return mode;
}

function formatLines(lines: number[]): string {
  const shown = lines.slice(0, 8).map((l) => `line ${l}`);
  return lines.length > 8 ? `${shown.join(", ")}, …` : shown.join(", ");
}

type CsvInput = Extract<SelectionInput, { kind: "csv_records" }>;

interface CsvPlan {
  tokens: CsvTokens;
  skipped: { count: number; lineEnd: number | null };
  columnCount: number;
  columnIndexes: number[];
  start: number;
  endExclusive: number;
}

function planCsv(bytes: Uint8Array, input: CsvInput): CsvPlan {
  const { text } = decodeCsv(bytes);
  const allTokens = tokenizeOrThrow(text, input.delimiter);
  const skip = input.skipLeadingRecords ?? 0;
  if (skip >= allTokens.records.length) {
    throw new AppError("invalid_selection", `Cannot skip ${skip} records; the file has ${allTokens.records.length}.`, { details: { records: allTokens.records.length } });
  }
  const skipped = { count: skip, lineEnd: skip > 0 ? allTokens.records[skip - 1].lineEnd : null };
  const tokens = skipRecords(allTokens, skip);
  const dataCount = tokens.records.length - input.headerRecordCount;
  if (dataCount <= 0) {
    throw new AppError("invalid_selection", input.headerRecordCount > 0 ? "There are no data records after the header record." : "The file has no records.");
  }
  const columnCount = tokens.records.reduce((m, r) => Math.max(m, r.fields.length), 0);
  let columnIndexes: number[];
  if (input.selectedColumnIndexes) {
    const seen = new Set<number>();
    for (const c of input.selectedColumnIndexes) {
      if (c >= columnCount) throw new AppError("invalid_selection", `Column ${c + 1} does not exist; the file has ${columnCount} columns.`);
      if (seen.has(c)) throw new AppError("invalid_selection", `Column ${c + 1} was selected twice.`);
      seen.add(c);
    }
    columnIndexes = [...input.selectedColumnIndexes].sort((a, b) => a - b);
  } else {
    columnIndexes = Array.from({ length: columnCount }, (_, i) => i);
  }
  if (columnIndexes.length > LIMITS.maxColumns) {
    throw new AppError("too_many_columns", `The selection has ${columnIndexes.length} columns; the limit is ${LIMITS.maxColumns}. Choose a column subset.`, {
      details: { columns: columnIndexes.length, limit: LIMITS.maxColumns },
    });
  }
  const start = input.recordInterval?.start ?? 0;
  const endExclusive = input.recordInterval?.endExclusive ?? dataCount;
  if (start >= dataCount || endExclusive > dataCount) {
    throw new AppError("invalid_selection", `The record range must lie within the ${dataCount} data records.`, { details: { dataRecords: dataCount } });
  }
  const selected = endExclusive - start;
  if (selected > LIMITS.maxStructuredRows) {
    throw new AppError("too_many_rows", `The selection has ${selected} records; the limit is ${LIMITS.maxStructuredRows}. Choose a smaller record range.`, {
      details: { rows: selected, limit: LIMITS.maxStructuredRows },
    });
  }
  return { tokens, skipped, columnCount, columnIndexes, start, endExclusive };
}

export function resolveCsvSelection(source: Source, bytes: Uint8Array, input: CsvInput): ResolvedSelection {
  planCsv(bytes, input);
  return {
    kind: "csv_records",
    sourceId: source.id,
    delimiter: input.delimiter,
    ...(input.skipLeadingRecords ? { skipLeadingRecords: input.skipLeadingRecords } : {}),
    headerRecordCount: input.headerRecordCount,
    selectedColumnIndexes: input.selectedColumnIndexes ? [...input.selectedColumnIndexes].sort((a, b) => a - b) : null,
    recordInterval: input.recordInterval,
  };
}

export function parseCsvSelection(
  source: Source,
  bytes: Uint8Array,
  selection: Extract<SourceSelection, { kind: "csv_records" }>,
): ParsedDatasetDraft {
  const plan = planCsv(bytes, selection);
  const { tokens, skipped, columnIndexes, start, endExclusive } = plan;
  const header = selection.headerRecordCount === 1 ? tokens.records[0] : null;
  const labels = columnIndexes.map((c) => {
    const h = header?.fields[c];
    return h !== undefined && h.trim() !== "" ? h : `Column ${c + 1}`;
  });
  const expected = header ? header.fields.length : plan.columnCount;

  const rows: DraftRowInput[] = [];
  const shortRows: Array<{ rowIndex: number; recordIndex: number; line: number; fields: number }> = [];
  const absentCells: Array<readonly [number, number]> = [];
  const longRecords: Array<{ rowIndex: number; recordIndex: number; line: number; fields: number }> = [];
  const malformed = new Set(tokens.malformedQuoteRecords);
  const malformedRows: number[] = [];
  for (let d = start; d < endExclusive; d++) {
    const rec = tokens.records[d + selection.headerRecordCount];
    const cells: DraftCellInput[] = [];
    const missingColumns: number[] = [];
    columnIndexes.forEach((c, colPos) => {
      const lines = rec.lineStart === rec.lineEnd ? `line ${rec.lineStart}` : `lines ${rec.lineStart}–${rec.lineEnd}`;
      if (c >= rec.fields.length) {
        missingColumns.push(colPos);
        cells.push({
          rawText: null,
          text: null,
          missingReason: "not_reported",
          notes: [`Record ${d + 1} has ${rec.fields.length} field${rec.fields.length === 1 ? "" : "s"}; there is no field ${c + 1} in the source.`],
          locator: { type: "csv_record", recordIndex: d, lineStart: rec.lineStart, lineEnd: rec.lineEnd, fieldIndex: null },
          availability: "region_only",
          provenanceLabel: `Record ${d + 1} (${lines}); field ${c + 1} absent`,
        });
        return;
      }
      const raw = rec.fields[c];
      cells.push({
        rawText: raw,
        text: raw === "" ? null : raw,
        missingReason: raw === "" ? "blank" : null,
        notes: [],
        locator: { type: "csv_record", recordIndex: d, lineStart: rec.lineStart, lineEnd: rec.lineEnd, fieldIndex: c },
        availability: "precise",
        provenanceLabel: `Record ${d + 1} (${lines}), field ${c + 1}`,
      });
    });
    const rowIndex = rows.length;
    rows.push({ sourceOrder: d, cells });
    absentCells.push(...missingColumns.map((colPos) => [rowIndex, colPos] as const));
    if (rec.fields.length < expected) {
      shortRows.push({ rowIndex, recordIndex: d, line: rec.lineStart, fields: rec.fields.length });
    } else if (rec.fields.length > expected) {
      longRecords.push({ rowIndex, recordIndex: d, line: rec.lineStart, fields: rec.fields.length });
    }
    if (malformed.has(d + selection.headerRecordCount)) malformedRows.push(rowIndex);
  }

  const built = buildDraft({ sourceId: source.id, selectionId: selection.id, labels, rows });
  const issues = [];
  if (shortRows.length + longRecords.length > 0) {
    const rowIds = shortRows.map((s) => built.rows[s.rowIndex].id);
    const cellIds = absentCells.map(([ri, cp]) => built.cellIds[ri][cp]);
    const evidence = [
      ...shortRows.map((s) => `Record ${s.recordIndex + 1} (line ${s.line}) has ${s.fields} field${s.fields === 1 ? "" : "s"}; expected ${expected}.`),
      ...longRecords.map((s) => `Record ${s.recordIndex + 1} (line ${s.line}) has ${s.fields} fields; expected ${expected}. Extra fields are imported as unlabeled columns.`),
    ];
    for (const lr of longRecords) rowIds.push(built.rows[lr.rowIndex].id);
    issues.push(
      issue(
        "inconsistent_field_count",
        "review",
        `${shortRows.length + longRecords.length === 1 ? "1 record does" : `${shortRows.length + longRecords.length} records do`} not have ${expected} fields. No record was dropped: absent fields are empty cells marked "not reported".`,
        { rowIds, cellIds, evidence },
      ),
    );
  }
  if (malformedRows.length > 0) {
    issues.push(
      issue("extraction_issue", "review", "Some records have text after a closing quote. The text was kept exactly as written; check these values.", {
        rowIds: malformedRows.map((i) => built.rows[i].id),
        evidence: malformedRows.map((i) => `Record ${rows[i].sourceOrder + 1}`),
      }),
    );
  }
  if (skipped.count > 0) {
    issues.push(
      issue(
        "extraction_issue",
        "info",
        `The first ${skipped.count === 1 ? "record" : `${skipped.count} records`} (lines 1–${skipped.lineEnd}) ${skipped.count === 1 ? "was" : "were"} skipped as not part of the table, as chosen. Line numbers in source references still count them.`,
        { evidence: [`Lines 1–${skipped.lineEnd}`] },
      ),
    );
  }
  if (tokens.emptyLines.length > 0) {
    issues.push(
      issue("extraction_issue", "info", `${tokens.emptyLines.length} empty line${tokens.emptyLines.length === 1 ? " was" : "s were"} skipped. Line numbers in source references still count them.`, {
        evidence: tokens.emptyLines.map((l) => `Line ${l}`),
      }),
    );
  }

  const name = baseName(source.filename);
  const total = tokens.records.length - selection.headerRecordCount;
  const range = start === 0 && endExclusive === total ? `all ${total} records` : `records ${start + 1}–${endExclusive} of ${total}`;
  return {
    title: name,
    description: `Imported from ${source.filename} (${range}; ${DELIMITER_NAMES[selection.delimiter].toLowerCase()}-delimited; ${skipped.count ? `${skipped.count} leading records skipped; ` : ""}${selection.headerRecordCount ? "header record used for labels" : "no header record"}). Original source strings are retained. Unambiguous numeric columns are typed as numbers without rounding; numeric NA/N/A markers remain missing. Ambiguous formats and mixed text are not coerced.`,
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
