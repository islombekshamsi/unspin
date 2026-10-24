import { AppError, type ChartQueryRequest, type ChartQueryResult, type DatasetVersionSnapshot } from "@/contracts";

/**
 * Chart-query seam (owner: Visualization specialist). Pure; runs on the server
 * for POST /datasets/:id/chart-query. Points carry stable row/cell ids.
 */
export function buildChartQuery(
  snapshot: DatasetVersionSnapshot,
  request: ChartQueryRequest,
  maxPoints: number,
): ChartQueryResult {
  void snapshot;
  void request;
  void maxPoints;
  throw new AppError("not_configured", "Chart queries are not implemented yet.");
}
