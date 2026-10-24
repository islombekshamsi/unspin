import { CONTRACT_SCHEMA_VERSION, computeReviewSummary, type Cell, type Column, type DatasetVersionSnapshot, type Row } from "@/contracts";
import type { TransformContext } from "./index";

/** Builds small synthetic snapshots for unit tests only (never product/demo data). */
export function column(id: string, patch: Partial<Column> = {}): Column {
  return {
    id,
    label: id,
    semanticRole: "other",
    dataType: "text",
    unit: null,
    currency: null,
    percentRepresentation: null,
    datePolicy: null,
    sourceScale: "unknown",
    seriesLabel: null,
    ...patch,
  };
}

export function textCell(id: string, text: string | null, patch: Partial<Cell> = {}): Cell {
  return {
    id,
    rawText: text,
    currentValue: text,
    valueType: "text",
    missingReason: text === null ? "blank" : null,
    origin: "parsed",
    reviewStatus: "unreviewed",
    provenanceIds: [`prov_${id}`],
    parentCellIds: [],
    notes: [],
    ...patch,
  };
}

/** values[r][c] -> row "r{r}", cell "c{r}_{colId}". */
export function snapshot(columns: Column[], values: Array<Array<string | null>>, versionId = "ver_base"): DatasetVersionSnapshot {
  const rows: Row[] = values.map((vals, r) => ({
    id: `r${r}`,
    sourceOrder: r,
    cells: Object.fromEntries(columns.map((c, i) => [c.id, textCell(`c${r}_${c.id}`, vals[i] ?? null)])),
  }));
  return {
    version: {
      id: versionId,
      datasetId: "ds_test",
      parentVersionId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      columns,
      rowCount: rows.length,
      operationId: null,
      unresolvedFindingCount: 0,
      reviewSummary: computeReviewSummary(rows),
    },
    rows,
  };
}

export const ctx = (operationId = "op_preview"): TransformContext => ({
  operationId,
  now: "2026-01-02T00:00:00.000Z",
  sourceId: "src_test",
  sourceSelectionId: "sel_test",
});
