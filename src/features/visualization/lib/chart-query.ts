import {
  AppError,
  type Cell,
  type ChartPoint,
  type ChartQueryRequest,
  type ChartQueryResult,
  type DatasetVersionSnapshot,
  type Row,
} from "@/contracts";

/**
 * Chart-query seam (owner: Visualization specialist). Pure; runs on the server
 * for POST /datasets/:id/chart-query. Points carry stable row/cell ids.
 *
 * - xKind is "numeric" when every present x cell is a decimal, "date" when every
 *   present x cell is a date/datetime, and "category" otherwise.
 * - Points are emitted row-major in sourceOrder, then in request y-column order.
 * - Missing y keeps the point with y = null (a gap) and counts it in excluded.missingY.
 * - Present non-decimal y and missing x drop the point; counts are per (row, y column).
 * - Values are passed through as stored strings; nothing goes through Number.
 * - When the plottable points exceed maxPoints, whole rows are kept every n-th
 *   (so all series stay aligned) with the smallest n that fits.
 */
export function buildChartQuery(snapshot: DatasetVersionSnapshot, request: ChartQueryRequest, maxPoints: number): ChartQueryResult {
  const columnIds = new Set(snapshot.version.columns.map((c) => c.id));
  const yColumnIds = [...new Set(request.yColumnIds)];
  if (!columnIds.has(request.xColumnId) || yColumnIds.some((id) => !columnIds.has(id))) {
    throw new AppError("bad_request", "Unknown column in chart query.");
  }
  if (!Number.isInteger(maxPoints) || maxPoints < 1) {
    throw new AppError("bad_request", "maxPoints must be a positive integer.");
  }

  const rows = [...snapshot.rows].sort((a, b) => a.sourceOrder - b.sourceOrder);
  const xKind = detectXKind(rows, request.xColumnId);
  const excluded = { missingY: 0, nonNumericY: 0, missingX: 0 };

  const perRow: ChartPoint[][] = [];
  for (const row of rows) {
    const xCell = row.cells[request.xColumnId];
    const points: ChartPoint[] = [];
    for (const yColumnId of yColumnIds) {
      const yCell = row.cells[yColumnId];
      if (!xCell || xCell.currentValue === null) {
        excluded.missingX += 1;
        continue;
      }
      if (!yCell || yCell.currentValue === null) {
        excluded.missingY += 1;
        if (!yCell) continue;
        points.push(makePoint(row, yColumnId, xCell, yCell, null));
        continue;
      }
      if (yCell.valueType !== "decimal" || typeof yCell.currentValue !== "string") {
        excluded.nonNumericY += 1;
        continue;
      }
      points.push(makePoint(row, yColumnId, xCell, yCell, yCell.currentValue));
    }
    if (points.length > 0) perRow.push(points);
  }

  const totalCount = perRow.reduce((n, p) => n + p.length, 0);
  if (totalCount <= maxPoints) {
    return { versionId: snapshot.version.id, xColumnId: request.xColumnId, xKind, points: perRow.flat(), sampling: null, excluded };
  }

  const kept = sampleEveryNthRow(perRow, maxPoints, Math.ceil(totalCount / maxPoints));
  const points = kept.flat();
  return {
    versionId: snapshot.version.id,
    xColumnId: request.xColumnId,
    xKind,
    points,
    sampling: { method: "every_nth", keptCount: points.length, totalCount },
    excluded,
  };
}

function detectXKind(rows: Row[], xColumnId: string): ChartQueryResult["xKind"] {
  let present = 0;
  let decimals = 0;
  let dates = 0;
  for (const row of rows) {
    const cell = row.cells[xColumnId];
    if (!cell || cell.currentValue === null) continue;
    present += 1;
    if (cell.valueType === "decimal" && typeof cell.currentValue === "string") decimals += 1;
    else if ((cell.valueType === "date" || cell.valueType === "datetime") && typeof cell.currentValue === "string") dates += 1;
  }
  if (present > 0 && decimals === present) return "numeric";
  if (present > 0 && dates === present) return "date";
  return "category";
}

function xString(cell: Cell): string {
  const v = cell.currentValue;
  return typeof v === "boolean" ? String(v) : (v as string);
}

function makePoint(row: Row, yColumnId: string, xCell: Cell, yCell: Cell, y: string | null): ChartPoint {
  return {
    pointId: `${row.id}:${yColumnId}`,
    rowId: row.id,
    yColumnId,
    xCellId: xCell.id,
    yCellId: yCell.id,
    x: xString(xCell),
    y,
    provenanceIds: [...new Set([...xCell.provenanceIds, ...yCell.provenanceIds])],
    yOrigin: yCell.origin,
  };
}

function sampleEveryNthRow(perRow: ChartPoint[][], maxPoints: number, startN: number): ChartPoint[][] {
  for (let n = Math.max(2, startN); n <= perRow.length; n += 1) {
    const kept = perRow.filter((_, i) => i % n === 0);
    if (kept.reduce((s, p) => s + p.length, 0) <= maxPoints) return kept;
  }
  // A single row has more series than maxPoints allows.
  return [perRow[0].slice(0, maxPoints)];
}
