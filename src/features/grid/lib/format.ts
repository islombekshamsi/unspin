import type { Cell, CellState, Column, DataType, MissingReason, ReviewStatus } from "@/contracts";

export const TYPE_LABELS: Record<DataType, string> = {
  text: "text",
  decimal: "number",
  date: "date",
  datetime: "date-time",
  boolean: "true/false",
  unknown: "unknown",
};

export const MISSING_LABELS: Record<MissingReason, string> = {
  blank: "blank",
  unreadable: "unreadable",
  not_reported: "not reported",
  invalid: "invalid",
  not_applicable: "not applicable",
};

export const REVIEW_LABELS: Record<ReviewStatus, string> = {
  unreviewed: "Not reviewed",
  accepted: "Reviewed",
  corrected: "Corrected",
  unavailable: "Review unavailable",
};

export const ORIGIN_LABELS: Record<Cell["origin"], string> = {
  parsed: "Parsed from the file",
  transcribed: "Transcribed from source text",
  estimated: "Estimated from the image",
  derived: "Derived by an operation",
  user_edit: "Edited by you",
};

/** Short unit/currency/percent tag for a column header, or null. */
export function columnUnitTag(c: Column): string | null {
  const parts: string[] = [];
  if (c.currency) parts.push(c.currency);
  if (c.unit) parts.push(c.unit);
  if (c.percentRepresentation === "percent_number") parts.push("%");
  if (c.percentRepresentation === "fraction") parts.push("fraction of 1");
  return parts.length ? parts.join(" · ") : null;
}

export function valueText(v: CellState["currentValue"]): string {
  if (v === null) return "";
  return typeof v === "boolean" ? String(v) : v;
}

/** Plain-text description of a cell state (used in previews and accessible names). */
export function describeState(s: CellState): string {
  if (s.currentValue === null) return `missing (${s.missingReason ? MISSING_LABELS[s.missingReason] : "no reason"})`;
  return `${valueText(s.currentValue)} (${TYPE_LABELS[s.valueType]})`;
}

export const isNumericType = (t: DataType) => t === "decimal";
