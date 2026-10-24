import {
  CONTRACT_SCHEMA_VERSION,
  computeReviewSummary,
  newId,
  type Cell,
  type Column,
  type Dataset,
  type DatasetVersionSnapshot,
  type HistoryEntry,
  type Job,
  type Owner,
  type Provenance,
  type Row,
  type Source,
  type SourceSelection,
} from "@/contracts";

/**
 * Structural fixtures for repository/export protocol tests only. They exercise storage and
 * serialization rules; they are not product or demo data.
 */

const t0 = Date.parse("2026-01-01T00:00:00.000Z");
let tick = 0;
/** Monotonic ISO timestamps so ordering assertions are deterministic. */
export const ts = () => new Date(t0 + (tick += 1000)).toISOString();

export function guest(): Owner {
  return { ownerId: newId("op").replace("op_", "guest_"), kind: "guest", actor: { kind: "guest", label: "Guest session" } };
}

export function account(): Owner {
  return { ownerId: newId("op").replace("op_", "acct_"), kind: "account", actor: { kind: "account", label: "Account" } };
}

export function source(): Source {
  return {
    id: newId("src"),
    filename: "fixture.csv",
    mimeType: "text/csv",
    byteSize: 12,
    sha256: "a".repeat(64),
    createdAt: ts(),
    kind: "csv",
    pageCount: null,
    sheetNames: null,
    processingDisclosure: "local_parser",
    capabilities: { preview: true, crop: false, selectSheet: false, textCoordinates: false },
    image: null,
  };
}

export function selection(sourceId: string): SourceSelection {
  return {
    id: newId("sel"),
    sourceId,
    createdAt: ts(),
    kind: "csv_records",
    delimiter: ",",
    headerRecordCount: 1,
    selectedColumnIndexes: null,
    recordInterval: null,
  };
}

export function column(overrides: Partial<Column> = {}): Column {
  return {
    id: newId("col"),
    label: "Value",
    semanticRole: "y",
    dataType: "decimal",
    unit: null,
    currency: null,
    percentRepresentation: null,
    datePolicy: null,
    sourceScale: "linear",
    seriesLabel: null,
    ...overrides,
  };
}

export function cell(value: string | boolean | null, overrides: Partial<Cell> = {}): Cell {
  return {
    id: newId("cell"),
    rawText: typeof value === "string" ? value : null,
    currentValue: value,
    valueType: typeof value === "boolean" ? "boolean" : "decimal",
    missingReason: value === null ? "blank" : null,
    origin: "parsed",
    reviewStatus: "unreviewed",
    provenanceIds: [],
    parentCellIds: [],
    notes: [],
    ...overrides,
  };
}

export interface DatasetFixture {
  dataset: Dataset;
  snapshot: DatasetVersionSnapshot;
  provenance: Provenance[];
  history: HistoryEntry;
}

/** Builds a dataset whose every cell references a csv_record provenance entry. */
export function datasetFor(
  owner: Owner,
  sel: SourceSelection,
  opts: { columns?: Column[]; rows?: (cols: Column[]) => Record<string, Cell>[]; rowCount?: number } = {},
): DatasetFixture {
  const datasetId = newId("ds");
  const versionId = newId("ver");
  const createdAt = ts();
  const columns = opts.columns ?? [column({ label: "Year", dataType: "text", semanticRole: "x" }), column()];
  const cellsPerRow =
    opts.rows?.(columns) ??
    Array.from({ length: opts.rowCount ?? 3 }, (_, i) =>
      Object.fromEntries(columns.map((c, j) => [c.id, cell(String(i * 10 + j), { valueType: c.dataType })])),
    );
  const provenance: Provenance[] = [];
  const rows: Row[] = cellsPerRow.map((cells, i) => {
    const p: Provenance = {
      id: newId("prov"),
      sourceId: sel.sourceId,
      sourceSelectionId: sel.id,
      locator: { type: "csv_record", recordIndex: i, lineStart: i + 2, lineEnd: i + 2, fieldIndex: null },
      locatorOrigin: "parser",
      locatorAvailability: "precise",
      label: `Record ${i + 1}`,
      extractionMethod: "deterministic_parser",
      createdAt,
    };
    provenance.push(p);
    for (const c of Object.values(cells)) if (c.provenanceIds.length === 0) c.provenanceIds = [p.id];
    return { id: newId("row"), sourceOrder: i, cells };
  });
  const dataset: Dataset = {
    id: datasetId,
    sourceId: sel.sourceId,
    sourceSelectionId: sel.id,
    title: "Fixture dataset",
    description: "",
    createdAt,
    currentVersionId: versionId,
    initialVersionId: versionId,
    extractionMethod: "deterministic_parser",
    coverage: "complete_selection",
    coverageNote: null,
    coverageAcknowledgedAt: null,
    extraction: null,
    importIssues: [],
  };
  const snapshot: DatasetVersionSnapshot = {
    version: {
      id: versionId,
      datasetId,
      parentVersionId: null,
      createdAt,
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      columns,
      rowCount: rows.length,
      operationId: null,
      unresolvedFindingCount: 0,
      reviewSummary: computeReviewSummary(rows),
    },
    rows,
  };
  const history = historyEntry(owner, datasetId, "initial", null, versionId, rows.length);
  return { dataset, snapshot, provenance, history };
}

export function historyEntry(
  owner: Owner,
  datasetId: string,
  kind: HistoryEntry["kind"],
  baseVersionId: string | null,
  resultVersionId: string,
  rowCountAfter: number,
): HistoryEntry {
  return {
    id: newId("op"),
    datasetId,
    kind,
    baseVersionId,
    resultVersionId,
    operation: kind === "transform" ? { type: "rename_column", columnId: "col_x", newLabel: "Renamed" } : null,
    restoredVersionId: kind === "restore" ? resultVersionId : null,
    actor: owner.actor,
    createdAt: ts(),
    affectedCount: 0,
    rowCountBefore: baseVersionId ? rowCountAfter : null,
    rowCountAfter,
    changedCellIds: [],
    removedRowIds: [],
    summary: `${kind} fixture`,
  };
}

/** A child snapshot of `base` with one renamed column. */
export function childSnapshot(base: DatasetVersionSnapshot, label = "Renamed"): DatasetVersionSnapshot {
  const versionId = newId("ver");
  return {
    version: {
      ...structuredClone(base.version),
      id: versionId,
      parentVersionId: base.version.id,
      createdAt: ts(),
      operationId: newId("op"),
      columns: base.version.columns.map((c, i) => (i === 0 ? { ...c, label } : c)),
    },
    rows: structuredClone(base.rows),
  };
}

export function job(selectionId: string, overrides: Partial<Job> = {}): Job {
  return {
    id: newId("job"),
    sourceSelectionId: selectionId,
    operationType: "structured_parse",
    status: "queued",
    stage: "queued",
    cancellationRequested: false,
    createdAt: ts(),
    startedAt: null,
    finishedAt: null,
    attemptCount: 0,
    measuredProgress: null,
    error: null,
    resultDatasetId: null,
    ...overrides,
  };
}
