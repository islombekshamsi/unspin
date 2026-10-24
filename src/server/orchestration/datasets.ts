import Decimal from "decimal.js";
import {
  AppError,
  CONTRACT_SCHEMA_VERSION,
  computeReviewSummary,
  newId,
  type ApplyTransformRequest,
  type Cell,
  type ChartQueryRequest,
  type ChartQueryResult,
  type CreateExportRequest,
  type Dataset,
  type DatasetDetail,
  type DatasetVersionSnapshot,
  type ExportFile,
  type ExportResult,
  type HistoryEntry,
  type HistoryResponse,
  type Owner,
  type PreviewTransformRequest,
  type QualityFinding,
  type RestoreVersionRequest,
  type RowsPage,
  type RowsQuery,
  type TransformPreview,
} from "@/contracts";
import { buildChartQuery } from "@/features/visualization/lib/chart-query";
import { LIMITS } from "@/server/config/limits";
import { buildCsv, buildJsonData, buildManifest, type ExportContext } from "@/server/exports";
import { computeFindings } from "@/server/quality";
import { getRepositories } from "@/server/storage";
import { computeTransform, operationHash } from "@/server/transforms";
import { getSelection, getSourceRecord } from "./sources";

const now = () => new Date().toISOString();

async function requireDataset(owner: Owner, datasetId: string): Promise<Dataset> {
  const d = await getRepositories().datasets.get(owner, datasetId);
  if (!d) throw new AppError("not_found", "Dataset not found.");
  return d;
}

async function requireVersion(owner: Owner, datasetId: string, versionId: string): Promise<DatasetVersionSnapshot> {
  const v = await getRepositories().datasets.getVersion(owner, datasetId, versionId);
  if (!v) throw new AppError("not_found", "Dataset version not found.");
  return v;
}

function assertCurrent(dataset: Dataset, expectedVersionId: string) {
  if (dataset.currentVersionId !== expectedVersionId) {
    throw new AppError("version_conflict", "The dataset changed since you loaded it. Reload the latest version and try again.", {
      details: { currentVersionId: dataset.currentVersionId },
    });
  }
}

export async function getDatasetDetail(owner: Owner, datasetId: string, versionId?: string | null): Promise<DatasetDetail> {
  const repos = getRepositories();
  const dataset = await requireDataset(owner, datasetId);
  const snapshot = await requireVersion(owner, datasetId, versionId ?? dataset.currentVersionId);
  const [versions, provenance] = await Promise.all([
    repos.datasets.listVersions(owner, datasetId),
    repos.datasets.getProvenance(owner, datasetId),
  ]);
  return { dataset, version: snapshot.version, versions, provenance };
}

export async function listDatasetsForSource(owner: Owner, sourceId: string): Promise<Dataset[]> {
  await getSourceRecord(owner, sourceId);
  return getRepositories().datasets.listBySource(owner, sourceId);
}

// ---------------------------------------------------------------------------
// Rows: allowlisted sort/filter are view operations; the stored version never changes.
// ---------------------------------------------------------------------------

function displayText(cell: Cell | undefined): string {
  if (!cell || cell.currentValue === null) return "";
  return typeof cell.currentValue === "boolean" ? String(cell.currentValue) : cell.currentValue;
}

function compareCells(a: Cell | undefined, b: Cell | undefined): number {
  const am = !a || a.currentValue === null;
  const bm = !b || b.currentValue === null;
  if (am || bm) return am === bm ? 0 : am ? 1 : -1; // missing always last
  if (a!.valueType === "decimal" && b!.valueType === "decimal") {
    try {
      return new Decimal(a!.currentValue as string).cmp(new Decimal(b!.currentValue as string));
    } catch {
      /* fall through to text comparison */
    }
  }
  return displayText(a).localeCompare(displayText(b), undefined, { numeric: true, sensitivity: "base" });
}

export async function getRows(owner: Owner, datasetId: string, q: RowsQuery): Promise<RowsPage> {
  await requireDataset(owner, datasetId);
  const snapshot = await requireVersion(owner, datasetId, q.versionId);
  const columnIds = new Set(snapshot.version.columns.map((c) => c.id));
  for (const id of [q.sortColumnId, q.filterColumnId]) {
    if (id && !columnIds.has(id)) throw new AppError("bad_request", "Unknown column for sort/filter.");
  }
  let rows = snapshot.rows;
  if (q.rowIds) {
    const wanted = new Set(q.rowIds);
    rows = rows.filter((r) => wanted.has(r.id));
  }
  if (q.filterColumnId && q.filterText) {
    const needle = q.filterText.toLocaleLowerCase();
    rows = rows.filter((r) => displayText(r.cells[q.filterColumnId!]).toLocaleLowerCase().includes(needle));
  }
  if (q.sortColumnId) {
    const dir = q.sortDirection === "desc" ? -1 : 1;
    const col = q.sortColumnId;
    rows = [...rows].sort((a, b) => {
      const ca = a.cells[col];
      const cb = b.cells[col];
      const aMissing = !ca || ca.currentValue === null;
      const bMissing = !cb || cb.currentValue === null;
      if (aMissing || bMissing) return aMissing === bMissing ? a.sourceOrder - b.sourceOrder : aMissing ? 1 : -1;
      return compareCells(ca, cb) * dir || a.sourceOrder - b.sourceOrder;
    });
  }
  const limit = Math.min(q.limit ?? 200, LIMITS.maxRowsPageSize);
  const offset = parseCursor(q.cursor);
  const page = rows.slice(offset, offset + limit);
  const next = offset + limit < rows.length ? String(offset + limit) : null;
  return { versionId: snapshot.version.id, rows: page, totalRows: rows.length, nextCursor: next };
}

export async function getFindings(owner: Owner, datasetId: string, versionId: string): Promise<QualityFinding[]> {
  const dataset = await requireDataset(owner, datasetId);
  const snapshot = await requireVersion(owner, datasetId, versionId);
  return computeFindings(dataset, snapshot);
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export async function previewTransform(owner: Owner, datasetId: string, req: PreviewTransformRequest): Promise<TransformPreview> {
  const repos = getRepositories();
  const dataset = await requireDataset(owner, datasetId);
  assertCurrent(dataset, req.expectedVersionId);
  const base = await requireVersion(owner, datasetId, req.expectedVersionId);
  const provenance = await repos.datasets.getProvenance(owner, datasetId);
  const comp = computeTransform(base, provenance, req.operation, {
    operationId: "op_preview",
    now: now(),
    sourceId: dataset.sourceId,
    sourceSelectionId: dataset.sourceSelectionId,
  });
  const limit = req.limit ?? 100;
  const offset = parseCursor(req.cursor);
  return {
    operationHash: operationHash(base.version.id, req.operation),
    operation: req.operation,
    baseVersionId: base.version.id,
    affectedCount: comp.affectedCount,
    rowCountBefore: base.rows.length,
    rowCountAfter: comp.rows.length,
    totalChanges: comp.changes.length,
    changes: comp.changes.slice(offset, offset + limit),
    changesCursor: offset + limit < comp.changes.length ? String(offset + limit) : null,
    removedRowIds: comp.removedRowIds,
    failedCellIds: comp.failedCellIds,
    warnings: comp.warnings,
    precisionEffects: comp.precisionEffects,
  };
}

export async function applyTransform(owner: Owner, datasetId: string, req: ApplyTransformRequest): Promise<DatasetDetail> {
  const repos = getRepositories();
  const dataset = await requireDataset(owner, datasetId);
  assertCurrent(dataset, req.expectedVersionId);
  if (operationHash(req.expectedVersionId, req.operation) !== req.operationHash) {
    throw new AppError("preview_required", "This change differs from the preview you reviewed. Preview it again before applying.");
  }
  const base = await requireVersion(owner, datasetId, req.expectedVersionId);
  const provenance = await repos.datasets.getProvenance(owner, datasetId);
  const operationId = newId("op");
  const createdAt = now();
  const comp = computeTransform(base, provenance, req.operation, {
    operationId,
    now: createdAt,
    sourceId: dataset.sourceId,
    sourceSelectionId: dataset.sourceSelectionId,
  });
  if (comp.affectedCount === 0 && comp.changes.length === 0 && comp.removedRowIds.length === 0 && sameColumns(base, comp.columns)) {
    throw new AppError("unsupported_operation", "This change would not modify the dataset.");
  }
  const versionId = newId("ver");
  const snapshot: DatasetVersionSnapshot = {
    version: {
      id: versionId,
      datasetId,
      parentVersionId: base.version.id,
      createdAt,
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      columns: comp.columns,
      rowCount: comp.rows.length,
      operationId,
      unresolvedFindingCount: 0,
      reviewSummary: computeReviewSummary(comp.rows),
    },
    rows: comp.rows,
  };
  snapshot.version.unresolvedFindingCount = computeFindings(dataset, snapshot).filter((f) => f.severity !== "info").length;
  const history: HistoryEntry = {
    id: operationId,
    datasetId,
    kind: "transform",
    baseVersionId: base.version.id,
    resultVersionId: versionId,
    operation: req.operation,
    restoredVersionId: null,
    actor: owner.actor,
    createdAt,
    affectedCount: comp.affectedCount,
    rowCountBefore: base.rows.length,
    rowCountAfter: comp.rows.length,
    changedCellIds: comp.changes.map((c) => c.cellId),
    removedRowIds: comp.removedRowIds,
    summary: comp.summary.slice(0, 500),
  };
  await repos.datasets.commitVersion(owner, {
    datasetId,
    expectedVersionId: base.version.id,
    snapshot,
    targetVersionId: null,
    newProvenance: comp.newProvenance,
    historyEntry: history,
  });
  return getDatasetDetail(owner, datasetId);
}

function sameColumns(base: DatasetVersionSnapshot, cols: DatasetVersionSnapshot["version"]["columns"]) {
  return JSON.stringify(base.version.columns) === JSON.stringify(cols);
}

/** Undo/redo: makes an actual stored version current again; recorded as its own history entry. */
export async function restoreVersion(owner: Owner, datasetId: string, req: RestoreVersionRequest): Promise<DatasetDetail> {
  const repos = getRepositories();
  const dataset = await requireDataset(owner, datasetId);
  assertCurrent(dataset, req.expectedVersionId);
  if (req.targetVersionId === dataset.currentVersionId) {
    throw new AppError("bad_request", "That version is already current.");
  }
  const target = await requireVersion(owner, datasetId, req.targetVersionId);
  const base = await requireVersion(owner, datasetId, req.expectedVersionId);
  const operationId = newId("op");
  await repos.datasets.commitVersion(owner, {
    datasetId,
    expectedVersionId: req.expectedVersionId,
    snapshot: null,
    targetVersionId: target.version.id,
    newProvenance: [],
    historyEntry: {
      id: operationId,
      datasetId,
      kind: "restore",
      baseVersionId: req.expectedVersionId,
      resultVersionId: target.version.id,
      operation: null,
      restoredVersionId: target.version.id,
      actor: owner.actor,
      createdAt: now(),
      affectedCount: 0,
      rowCountBefore: base.rows.length,
      rowCountAfter: target.rows.length,
      changedCellIds: [],
      removedRowIds: [],
      summary: `Restored stored version from ${new Date(target.version.createdAt).toISOString()}`,
    },
  });
  return getDatasetDetail(owner, datasetId);
}

export async function getHistory(owner: Owner, datasetId: string): Promise<HistoryResponse> {
  const dataset = await requireDataset(owner, datasetId);
  const entries = await getRepositories().datasets.listHistory(owner, datasetId);
  return { datasetId, currentVersionId: dataset.currentVersionId, entries };
}

export async function acknowledgeCoverage(owner: Owner, datasetId: string, expectedVersionId: string): Promise<Dataset> {
  return getRepositories().datasets.acknowledgeCoverage(owner, datasetId, expectedVersionId, now());
}

// ---------------------------------------------------------------------------
// Chart query and exports
// ---------------------------------------------------------------------------

export async function chartQuery(owner: Owner, datasetId: string, req: ChartQueryRequest): Promise<ChartQueryResult> {
  await requireDataset(owner, datasetId);
  const snapshot = await requireVersion(owner, datasetId, req.versionId);
  const cols = new Set(snapshot.version.columns.map((c) => c.id));
  if (!cols.has(req.xColumnId) || req.yColumnIds.some((id) => !cols.has(id))) {
    throw new AppError("bad_request", "Unknown column in chart query.");
  }
  return buildChartQuery(snapshot, req, Math.min(req.maxPoints ?? LIMITS.maxChartPoints, LIMITS.maxChartPoints));
}

export async function createExport(owner: Owner, datasetId: string, req: CreateExportRequest): Promise<ExportResult> {
  const repos = getRepositories();
  const dataset = await requireDataset(owner, datasetId);
  if (dataset.coverage !== "complete_selection" && !dataset.coverageAcknowledgedAt && !req.acknowledgePartial) {
    throw new AppError("partial_ack_required", "This dataset is marked partial/uncertain. Acknowledge its coverage note before exporting.", {
      details: { coverage: dataset.coverage, coverageNote: dataset.coverageNote },
    });
  }
  const snapshot = await requireVersion(owner, datasetId, req.versionId);
  if (req.scope.kind === "view") {
    const rowIds = new Set(snapshot.rows.map((r) => r.id));
    const colIds = new Set(snapshot.version.columns.map((c) => c.id));
    if (req.scope.rowIds.some((id) => !rowIds.has(id)) || req.scope.columnIds.some((id) => !colIds.has(id))) {
      throw new AppError("bad_request", "The export view references rows or columns not in this version.");
    }
  }
  const [{ source }, selection, history, provenance] = await Promise.all([
    getSourceRecord(owner, dataset.sourceId),
    getSelection(owner, dataset.sourceSelectionId),
    repos.datasets.listHistory(owner, datasetId),
    repos.datasets.getProvenance(owner, datasetId),
  ]);
  const exportedAt = now();
  const ctx: ExportContext = { source, selection, dataset, snapshot, history, provenance, scope: req.scope, exportedAt };
  const base = safeFileStem(dataset.title);
  const files: ExportFile[] = [];
  for (const format of new Set(req.formats)) {
    if (format === "csv") files.push({ filename: `${base}.csv`, mimeType: "text/csv;charset=utf-8", content: buildCsv(ctx) });
    if (format === "json") files.push({ filename: `${base}.data.json`, mimeType: "application/json", content: buildJsonData(ctx) });
    if (format === "manifest") {
      files.push({ filename: `${base}.manifest.json`, mimeType: "application/json", content: JSON.stringify(buildManifest(ctx), null, 2) });
    }
  }
  return { id: newId("exp"), createdAt: exportedAt, files };
}

function parseCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  if (!/^\d{1,9}$/.test(cursor)) throw new AppError("bad_request", "Invalid cursor.");
  return Number(cursor);
}

function safeFileStem(title: string): string {
  const s = title.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return s || "unspin-dataset";
}
