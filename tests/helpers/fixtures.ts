import {
  CONTRACT_SCHEMA_VERSION,
  DecimalStringSchema,
  computeReviewSummary,
  newId,
  type Cell,
  type Column,
  type DataType,
  type Dataset,
  type DatasetVersionSnapshot,
  type HistoryEntry,
  type Owner,
  type Provenance,
  type Row,
  type Source,
  type SourceSelection,
} from "@/contracts";
import { getRepositories, newBlobKey } from "@/server/storage";
import { sha256 } from "./real-inputs";

/**
 * Builds stored dataset state directly through the repository interfaces so that
 * orchestration/access tests run without the ingestion parser. Cell contents come
 * from the caller: real input rows where possible, or explicitly labelled
 * protocol strings for edge cases. Never used as product/demo data.
 */

export interface ColumnSpec {
  label: string;
  dataType: DataType;
  unit?: string | null;
  semanticRole?: Column["semanticRole"];
}

export interface TableSpec {
  title?: string;
  columns: ColumnSpec[];
  /** Raw text per cell; null means the source had no text (missing, reason "blank"). */
  rows: (string | null)[][];
  coverage?: Dataset["coverage"];
  coverageNote?: string | null;
  /** Bytes stored as the source blob; the sha256 is computed from them. */
  sourceBytes: Uint8Array;
  filename?: string;
}

export interface SeededDataset {
  source: Source;
  selection: SourceSelection;
  dataset: Dataset;
  snapshot: DatasetVersionSnapshot;
  provenance: Provenance[];
  columns: Column[];
}

export function buildCsvSource(bytes: Uint8Array, filename = "input.csv"): Source {
  return {
    id: newId("src"),
    filename,
    mimeType: "text/csv",
    byteSize: bytes.byteLength,
    sha256: sha256(bytes),
    createdAt: new Date().toISOString(),
    kind: "csv",
    pageCount: null,
    sheetNames: null,
    processingDisclosure: "local_parser",
    capabilities: { preview: true, crop: false, selectSheet: false, textCoordinates: false },
    image: null,
  };
}

export function buildCsvSelection(sourceId: string): Extract<SourceSelection, { kind: "csv_records" }> {
  return {
    id: newId("sel"),
    sourceId,
    createdAt: new Date().toISOString(),
    kind: "csv_records",
    delimiter: ",",
    headerRecordCount: 1,
    selectedColumnIndexes: null,
    recordInterval: null,
  };
}

export function buildSnapshot(
  datasetId: string,
  source: Source,
  selection: SourceSelection,
  spec: Pick<TableSpec, "columns" | "rows">,
): { snapshot: DatasetVersionSnapshot; provenance: Provenance[]; columns: Column[] } {
  const createdAt = new Date().toISOString();
  const columns: Column[] = spec.columns.map((c) => ({
    id: newId("col"),
    label: c.label,
    semanticRole: c.semanticRole ?? (c.dataType === "decimal" ? "y" : "x"),
    dataType: c.dataType,
    unit: c.unit ?? null,
    currency: null,
    percentRepresentation: null,
    datePolicy: null,
    sourceScale: "linear",
    seriesLabel: null,
  }));
  const provenance: Provenance[] = [];
  const rows: Row[] = spec.rows.map((raw, i) => {
    const prov: Provenance = {
      id: newId("prov"),
      sourceId: source.id,
      sourceSelectionId: selection.id,
      locator: { type: "csv_record", recordIndex: i, lineStart: i + 2, lineEnd: i + 2, fieldIndex: null },
      locatorOrigin: "parser",
      locatorAvailability: "precise",
      label: `Record ${i + 1}`,
      extractionMethod: "deterministic_parser",
      createdAt,
    };
    provenance.push(prov);
    const cells: Record<string, Cell> = {};
    columns.forEach((col, j) => {
      const text = raw[j] ?? null;
      const missing = text === null || text === "";
      const asDecimal = col.dataType === "decimal" && !missing && DecimalStringSchema.safeParse(text).success;
      cells[col.id] = {
        id: newId("cell"),
        rawText: text,
        currentValue: missing ? null : text,
        valueType: missing ? col.dataType : asDecimal || col.dataType !== "decimal" ? col.dataType : "text",
        missingReason: missing ? "blank" : null,
        origin: "parsed",
        reviewStatus: "unreviewed",
        provenanceIds: [prov.id],
        parentCellIds: [],
        notes: [],
      };
    });
    return { id: newId("row"), sourceOrder: i, cells };
  });
  const versionId = newId("ver");
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
  return { snapshot, provenance, columns };
}

/** Stores source + blob + selection + dataset (initial version) for `owner`. */
export async function seedDataset(owner: Owner, spec: TableSpec): Promise<SeededDataset> {
  const repos = getRepositories();
  const source = buildCsvSource(spec.sourceBytes, spec.filename);
  const blobKey = newBlobKey(owner.ownerId, source.id);
  await repos.blobs.put(blobKey, spec.sourceBytes);
  await repos.sources.create(owner, { source, blobKey });
  const selection = buildCsvSelection(source.id);
  await repos.selections.create(owner, selection);
  const datasetId = newId("ds");
  const { snapshot, provenance, columns } = buildSnapshot(datasetId, source, selection, spec);
  const coverage = spec.coverage ?? "complete_selection";
  const dataset: Dataset = {
    id: datasetId,
    sourceId: source.id,
    sourceSelectionId: selection.id,
    title: spec.title ?? "Fixture dataset",
    description: "",
    createdAt: snapshot.version.createdAt,
    currentVersionId: snapshot.version.id,
    initialVersionId: snapshot.version.id,
    extractionMethod: "deterministic_parser",
    coverage,
    coverageNote: spec.coverageNote ?? (coverage === "complete_selection" ? null : "Fixture: partial selection"),
    coverageAcknowledgedAt: null,
    extraction: null,
    importIssues: [],
  };
  const historyEntry: HistoryEntry = {
    id: newId("op"),
    datasetId,
    kind: "initial",
    baseVersionId: null,
    resultVersionId: snapshot.version.id,
    operation: null,
    restoredVersionId: null,
    actor: owner.actor,
    createdAt: snapshot.version.createdAt,
    affectedCount: snapshot.rows.length,
    rowCountBefore: null,
    rowCountAfter: snapshot.rows.length,
    changedCellIds: [],
    removedRowIds: [],
    summary: "Fixture import",
  };
  await repos.datasets.create(owner, { dataset, initialSnapshot: snapshot, provenance, historyEntry });
  return { source, selection, dataset, snapshot, provenance, columns };
}

/**
 * Commits a second stored version directly through the repository (bypassing the
 * transform service) by changing one cell's currentValue. Used to test history,
 * restore, and concurrency without depending on the cleaning specialist's module.
 */
export async function commitManualEdit(
  owner: Owner,
  seeded: { dataset: Dataset },
  base: DatasetVersionSnapshot,
  rowIndex: number,
  columnId: string,
  newValue: string,
): Promise<DatasetVersionSnapshot> {
  const repos = getRepositories();
  const versionId = newId("ver");
  const operationId = newId("op");
  const rows = structuredClone(base.rows);
  const cell = rows[rowIndex].cells[columnId];
  const changedCellId = cell.id;
  rows[rowIndex].cells[columnId] = {
    ...cell,
    id: newId("cell"),
    currentValue: newValue,
    missingReason: null,
    origin: "user_edit",
    reviewStatus: "corrected",
    parentCellIds: [cell.id],
  };
  const snapshot: DatasetVersionSnapshot = {
    version: {
      ...base.version,
      id: versionId,
      parentVersionId: base.version.id,
      createdAt: new Date().toISOString(),
      operationId,
      reviewSummary: computeReviewSummary(rows),
    },
    rows,
  };
  await repos.datasets.commitVersion(owner, {
    datasetId: seeded.dataset.id,
    expectedVersionId: base.version.id,
    snapshot,
    targetVersionId: null,
    newProvenance: [],
    historyEntry: {
      id: operationId,
      datasetId: seeded.dataset.id,
      kind: "transform",
      baseVersionId: base.version.id,
      resultVersionId: versionId,
      operation: {
        type: "edit_cell",
        rowId: rows[rowIndex].id,
        columnId,
        cellId: changedCellId,
        newValue,
        explicitType: "decimal",
        missingReason: null,
        note: null,
      },
      restoredVersionId: null,
      actor: owner.actor,
      createdAt: snapshot.version.createdAt,
      affectedCount: 1,
      rowCountBefore: base.rows.length,
      rowCountAfter: rows.length,
      changedCellIds: [changedCellId],
      removedRowIds: [],
      summary: "Fixture manual edit",
    },
  });
  return snapshot;
}

const encoder = new TextEncoder();
export const utf8 = (s: string) => encoder.encode(s);
