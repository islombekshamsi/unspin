import { createHash } from "node:crypto";
import {
  AppError,
  type CellChange,
  type Column,
  type DatasetVersionSnapshot,
  type Provenance,
  type Row,
  type TransformOperation,
} from "@/contracts";

/**
 * Transform service seam (owner: Cleaning specialist).
 * Pure and deterministic given (base snapshot, operation): preview and apply call the same function.
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
  void base;
  void provenance;
  void ctx;
  throw new AppError("unsupported_operation", `Operation "${operation.type}" is not implemented yet.`);
}

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
