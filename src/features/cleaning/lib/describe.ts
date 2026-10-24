import type { Column, FindingKind, FindingSeverity, HistoryEntry, TransformOperation } from "@/contracts";
import { findConversion } from "@/server/transforms/unit-registry";

export const FINDING_KIND_LABELS: Record<FindingKind, string> = {
  missing_values: "Missing values",
  repeated_rows: "Repeated rows",
  mixed_numeric_format: "Mixed number formats",
  ambiguous_date: "Ambiguous dates",
  mixed_units: "Mixed units",
  type_mismatch: "Type mismatch",
  inconsistent_field_count: "Inconsistent field count",
  extraction_issue: "Extraction note",
  partial_coverage: "Partial coverage",
};

export const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  blocking: "Blocking",
  review: "Needs review",
  info: "Info",
};

export const HISTORY_KIND_LABELS: Record<HistoryEntry["kind"], string> = {
  initial: "Imported",
  transform: "Change",
  restore: "Restore",
};

export function isDestructive(op: TransformOperation): boolean {
  return op.type === "remove_selected_rows" || op.type === "remove_exact_duplicates";
}

/** Short title for an operation, e.g. for a preview dialog. */
export function describeOperation(op: TransformOperation, columns: Column[]): string {
  const name = (id: string) => {
    const c = columns.find((x) => x.id === id);
    return c ? `“${c.label}”` : "a column";
  };
  switch (op.type) {
    case "edit_cell":
      return `Edit a cell in ${name(op.columnId)}`;
    case "rename_column":
      return `Rename ${name(op.columnId)} to “${op.newLabel}”`;
    case "set_column_unit":
      return `Set unit/currency of ${name(op.columnId)}`;
    case "trim_text":
      return `Trim whitespace in ${op.columnIds.map(name).join(", ")}`;
    case "parse_numeric":
      return `Read ${name(op.columnId)} as numbers`;
    case "parse_date":
      return `Read ${name(op.columnId)} as dates (${op.format})`;
    case "mark_missing":
      return `Mark ${op.explicitTokens.map((t) => (t.trim() === "" ? "empty text" : JSON.stringify(t))).join(", ")} as missing in ${name(op.columnId)}`;
    case "remove_selected_rows":
      return `Remove ${op.rowIds.length} selected row${op.rowIds.length === 1 ? "" : "s"}`;
    case "remove_exact_duplicates":
      return `Remove exact repeats (compared on ${op.columnIds.length} column${op.columnIds.length === 1 ? "" : "s"})`;
    case "convert_unit":
      return `Convert ${name(op.columnId)} ${findConversion(op.registeredConversionId)?.label ?? op.registeredConversionId}`;
    case "set_review_status":
      return `Mark ${op.cellIds.length} cell${op.cellIds.length === 1 ? "" : "s"} as ${op.reviewStatus === "accepted" ? "reviewed" : op.reviewStatus}`;
  }
}
