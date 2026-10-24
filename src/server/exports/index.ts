import {
  AppError,
  CONTRACT_SCHEMA_VERSION,
  DecimalStringSchema,
  ExportManifestSchema,
  computeReviewSummary,
  type Cell,
  type Column,
  type Dataset,
  type DatasetVersionSnapshot,
  type ExportManifest,
  type ExportScope,
  type HistoryEntry,
  type Provenance,
  type Row,
  type Source,
  type SourceSelection,
} from "@/contracts";
import { APP_VERSION } from "@/server/config/env";

/**
 * Export service (owner: Infrastructure specialist). Pure functions over an exact
 * committed version; nothing here reads storage or the clock.
 */

export interface ExportContext {
  source: Source;
  selection: SourceSelection;
  dataset: Dataset;
  snapshot: DatasetVersionSnapshot;
  history: HistoryEntry[];
  provenance: Provenance[];
  scope: ExportScope;
  exportedAt: string;
}

/**
 * CSV encoding: UTF-8 with a leading byte-order mark (so spreadsheet apps detect UTF-8;
 * pandas and readr strip it), RFC 4180 quoting, CRLF record separators including after the
 * last record, one header record.
 */
export const CSV_BOM = "\uFEFF";
const CRLF = "\r\n";

/** Leading characters spreadsheet apps may evaluate as a formula or command. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export const CSV_POLICY: ExportManifest["csvPolicy"] = {
  nullRepresentation:
    "Missing values (currentValue null) are written as an empty field; the reason is in data.json (missingReason). An empty text value is also an empty field; use data.json to distinguish them.",
  decimalSeparator: ".",
  numericValues:
    "Decimal cells are written exactly as their stored decimal strings (no rounding, grouping, locale formatting, or exponent changes; negatives keep their leading minus). Booleans are written as true/false. Dates are YYYY-MM-DD and datetimes ISO 8601 UTC. File encoding is UTF-8 with a byte-order mark, RFC 4180 quoting, and CRLF line endings.",
  formulaInjection:
    "Any header or non-decimal cell whose text starts with =, +, -, @, TAB, or CR is prefixed with a single apostrophe (') so spreadsheet software treats it as text. Valid decimal cells are never prefixed, so -12.5 stays -12.5. data.json carries every value unescaped.",
};

export const REVIEW_STATEMENT_BASE =
  "Review markers (accepted, corrected, unavailable) record actions a user took in UNSPIN. They are user review, not scientific validation, peer review, or a guarantee that a value matches its source.";

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

interface Scoped {
  columns: Column[];
  rows: Row[];
}

function resolveScope(ctx: ExportContext): Scoped {
  const { snapshot, scope } = ctx;
  if (ctx.dataset.id !== snapshot.version.datasetId) throw new AppError("internal", "Export version does not belong to the dataset.");
  if (scope.kind === "full") {
    return { columns: snapshot.version.columns, rows: [...snapshot.rows].sort((a, b) => a.sourceOrder - b.sourceOrder) };
  }
  const colById = new Map(snapshot.version.columns.map((c) => [c.id, c]));
  const rowById = new Map(snapshot.rows.map((r) => [r.id, r]));
  if (new Set(scope.rowIds).size !== scope.rowIds.length || new Set(scope.columnIds).size !== scope.columnIds.length) {
    throw new AppError("bad_request", "The export view lists a row or column more than once.");
  }
  const columns = scope.columnIds.map((id) => colById.get(id));
  const rows = scope.rowIds.map((id) => rowById.get(id));
  if (columns.some((c) => !c) || rows.some((r) => !r)) {
    throw new AppError("bad_request", "The export view references rows or columns not in this version.");
  }
  return { columns: columns as Column[], rows: rows as Row[] };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** "Revenue" + USD + million => "Revenue (USD million)". Percent representation is named when no unit says it. */
export function headerLabel(c: Column, position: number): string {
  const base = c.label.trim() || `Column ${position + 1}`;
  const parts = [c.currency, c.unit?.trim() || null].filter((p): p is string => !!p);
  if (parts.length === 0 && c.percentRepresentation === "percent_number") parts.push("%");
  if (parts.length === 0 && c.percentRepresentation === "fraction") parts.push("fraction");
  return parts.length ? `${base} (${parts.join(" ")})` : base;
}

/**
 * Unique headers are kept. Among duplicates, the first occurrence keeps the label and later
 * ones become "Label [2]", "Label [3]"… in column order, skipping any name already in use.
 */
export function disambiguate(labels: string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const taken = new Set(labels.filter((l) => counts.get(l) === 1));
  const next = new Map<string, number>();
  return labels.map((label) => {
    if (counts.get(label) === 1) return label;
    let n = next.get(label) ?? 1;
    let candidate = n === 1 ? label : `${label} [${n}]`;
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${label} [${n}]`;
    }
    next.set(label, n + 1);
    taken.add(candidate);
    return candidate;
  });
}

export function neutralizeFormula(text: string): string {
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

export function quoteField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

export function csvCellText(cell: Cell | undefined): string {
  if (!cell || cell.currentValue === null) return "";
  if (typeof cell.currentValue === "boolean") return cell.currentValue ? "true" : "false";
  if (cell.valueType === "decimal" && DecimalStringSchema.safeParse(cell.currentValue).success) return cell.currentValue;
  return neutralizeFormula(cell.currentValue);
}

/** CSV of the selected committed version and scope with formula-injection protection. */
export function buildCsv(ctx: ExportContext): string {
  const { columns, rows } = resolveScope(ctx);
  const header = disambiguate(columns.map(headerLabel)).map((h) => quoteField(neutralizeFormula(h)));
  const lines = [header.join(",")];
  for (const row of rows) lines.push(columns.map((c) => quoteField(csvCellText(row.cells[c.id]))).join(","));
  return CSV_BOM + lines.join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------
// JSON data
// ---------------------------------------------------------------------------

/** Exact machine-readable data (no spreadsheet escaping). */
export function buildJsonData(ctx: ExportContext): string {
  const { columns, rows } = resolveScope(ctx);
  const body = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    datasetId: ctx.dataset.id,
    versionId: ctx.snapshot.version.id,
    exportedAt: ctx.exportedAt,
    scope: ctx.scope,
    columns,
    rows: rows.map((r) => ({
      rowId: r.id,
      sourceOrder: r.sourceOrder,
      cells: Object.fromEntries(
        columns.map((c) => {
          const cell = r.cells[c.id];
          return [
            c.id,
            cell
              ? {
                  cellId: cell.id,
                  currentValue: cell.currentValue,
                  valueType: cell.valueType,
                  missingReason: cell.missingReason,
                  rawText: cell.rawText,
                  origin: cell.origin,
                  reviewStatus: cell.reviewStatus,
                  provenanceIds: cell.provenanceIds,
                  parentCellIds: cell.parentCellIds,
                  notes: cell.notes,
                }
              : null,
          ];
        }),
      ),
    })),
  };
  return JSON.stringify(body, null, 2);
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * History entries that produced the exported version, oldest first: follow
 * resultVersionId -> baseVersionId through initial/transform entries. Restores are not
 * part of how a version's content was produced, so they are omitted.
 */
export function lineageFor(history: HistoryEntry[], versionId: string): HistoryEntry[] {
  const producing = new Map<string, HistoryEntry>();
  for (const h of history) if (h.kind !== "restore" && !producing.has(h.resultVersionId)) producing.set(h.resultVersionId, h);
  const chain: HistoryEntry[] = [];
  const seen = new Set<string>();
  let v: string | null = versionId;
  while (v !== null) {
    if (seen.has(v)) throw new AppError("internal", "Version lineage contains a cycle.");
    seen.add(v);
    const entry = producing.get(v);
    if (!entry) throw new AppError("internal", "The exported version's history is incomplete; export was stopped.");
    chain.push(entry);
    if (entry.kind === "initial") break;
    v = entry.baseVersionId;
  }
  if (chain.at(-1)?.kind !== "initial") throw new AppError("internal", "The exported version's history is incomplete; export was stopped.");
  return chain.reverse();
}

function reviewStatement(dataset: Dataset, summary: ExportManifest["reviewSummary"]): string {
  const parts = [
    REVIEW_STATEMENT_BASE,
    `In this export, ${summary.unreviewed} of ${summary.cellsTotal} cells are unreviewed, ${summary.accepted} accepted, ${summary.corrected} corrected, and ${summary.unavailable} marked unavailable.`,
  ];
  if (dataset.coverage !== "complete_selection") {
    const ack = dataset.coverageAcknowledgedAt ? `acknowledged by the user at ${dataset.coverageAcknowledgedAt}` : "not yet acknowledged";
    parts.push(`Coverage is ${dataset.coverage.replace("_", " ")}: ${dataset.coverageNote ?? ""} (${ack}).`);
  }
  if (dataset.extractionMethod === "vision_estimate") {
    parts.push("Values were estimated by a vision model from the selected region and may differ from the source data.");
  }
  return parts.join(" ");
}

export function buildManifest(ctx: ExportContext): ExportManifest {
  const { columns, rows } = resolveScope(ctx);
  const { dataset, snapshot, source, selection } = ctx;
  if (selection.id !== dataset.sourceSelectionId || source.id !== dataset.sourceId || selection.sourceId !== source.id) {
    throw new AppError("internal", "Export source, selection, and dataset do not match.");
  }

  const scopedRows: Row[] = rows.map((r) => ({
    ...r,
    cells: Object.fromEntries(columns.flatMap((c) => (r.cells[c.id] ? [[c.id, r.cells[c.id]]] : []))),
  }));
  const referenced = new Set(scopedRows.flatMap((r) => Object.values(r.cells).flatMap((c: Cell) => c.provenanceIds)));
  const included = new Set<string>();
  const provenance = ctx.provenance.filter((p) => referenced.has(p.id) && !included.has(p.id) && included.add(p.id));
  if (provenance.length !== referenced.size) {
    throw new AppError("internal", "An exported value references provenance that is not stored; export was stopped.");
  }
  const reviewSummary = computeReviewSummary(scopedRows);

  return ExportManifestSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    software: { name: "UNSPIN", version: APP_VERSION },
    exportedAt: ctx.exportedAt,
    scope: ctx.scope,
    csvPolicy: CSV_POLICY,
    source: {
      sourceId: source.id,
      kind: source.kind,
      filename: source.filename,
      sha256: source.sha256,
      byteSize: source.byteSize,
      processingDisclosure: source.processingDisclosure,
    },
    selection,
    dataset: {
      id: dataset.id,
      title: dataset.title,
      extractionMethod: dataset.extractionMethod,
      extraction: dataset.extraction,
      coverage: dataset.coverage,
      coverageNote: dataset.coverageNote,
      coverageAcknowledgedAt: dataset.coverageAcknowledgedAt,
      initialVersionId: dataset.initialVersionId,
      exportedVersionId: snapshot.version.id,
      currentVersionId: dataset.currentVersionId,
    },
    columns,
    reviewSummary,
    reviewStatement: reviewStatement(dataset, reviewSummary),
    rowCount: rows.length,
    history: lineageFor(ctx.history, snapshot.version.id),
    provenance,
  });
}
