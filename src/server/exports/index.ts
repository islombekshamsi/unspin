import {
  AppError,
  type Dataset,
  type DatasetVersionSnapshot,
  type ExportManifest,
  type ExportScope,
  type HistoryEntry,
  type Provenance,
  type Source,
  type SourceSelection,
} from "@/contracts";

/**
 * Export service seam (owner: Infrastructure specialist).
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

/** CSV of the selected committed version and scope with formula-injection protection. */
export function buildCsv(ctx: ExportContext): string {
  void ctx;
  throw new AppError("not_configured", "CSV export is not implemented yet.");
}

/** Exact machine-readable data (no spreadsheet escaping). */
export function buildJsonData(ctx: ExportContext): string {
  void ctx;
  throw new AppError("not_configured", "JSON export is not implemented yet.");
}

export function buildManifest(ctx: ExportContext): ExportManifest {
  void ctx;
  throw new AppError("not_configured", "Manifest export is not implemented yet.");
}
