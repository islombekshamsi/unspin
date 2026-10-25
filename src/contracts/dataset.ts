import { z } from "zod";
import { CONTRACT_SCHEMA_VERSION, IdSchema, IsoDateTimeSchema } from "./common";
import { ExtractionMethodSchema } from "./provenance";

export const CoverageSchema = z.enum(["complete_selection", "partial_selection", "uncertain"]);
export type Coverage = z.infer<typeof CoverageSchema>;

export const ExtractionInfoSchema = z.object({
  provider: z.literal("gemini"),
  model: z.string(),
  promptVersion: z.string(),
  /** Exactly what bytes the provider received. */
  inputDisclosure: z.enum(["selected_image_region", "rendered_pdf_region", "whole_pdf_with_page_hint"]),
  requestedAt: IsoDateTimeSchema,
});
export type ExtractionInfo = z.infer<typeof ExtractionInfoSchema>;

/** Observation made while parsing/extracting (e.g. inconsistent field count, ambiguous series). */
export const ImportIssueSchema = z.object({
  kind: z.enum([
    "missing_values",
    "repeated_rows",
    "mixed_numeric_format",
    "ambiguous_date",
    "mixed_units",
    "type_mismatch",
    "inconsistent_field_count",
    "extraction_issue",
    "partial_coverage",
  ]),
  severity: z.enum(["info", "review", "blocking"]),
  message: z.string().max(1000),
  rowIds: z.array(IdSchema),
  columnIds: z.array(IdSchema),
  cellIds: z.array(IdSchema),
  evidence: z.array(z.string().max(1000)),
});
export type ImportIssue = z.infer<typeof ImportIssueSchema>;

export const DatasetSchema = z
  .object({
    id: IdSchema,
    sourceId: IdSchema,
    sourceSelectionId: IdSchema,
    title: z.string().min(1).max(300),
    description: z.string().max(2000),
    createdAt: IsoDateTimeSchema,
    currentVersionId: IdSchema,
    initialVersionId: IdSchema,
    extractionMethod: ExtractionMethodSchema,
    coverage: CoverageSchema,
    coverageNote: z.string().max(2000).nullable(),
    /** Set when the user explicitly acknowledged partial/uncertain coverage. */
    coverageAcknowledgedAt: IsoDateTimeSchema.nullable(),
    extraction: ExtractionInfoSchema.nullable(),
    importIssues: z.array(ImportIssueSchema),
    /** Prepared demonstrations can supply a meaningful initial plot; users may change it. */
    defaultChart: z.object({
      kind: z.enum(["bar", "line", "scatter"]),
      xColumnId: IdSchema,
      yColumnIds: z.array(IdSchema).min(1).max(12),
    }).optional(),
  })
  .refine((d) => d.coverage === "complete_selection" || (d.coverageNote ?? "").trim().length > 0, {
    message: "coverageNote is required unless coverage is complete_selection",
    path: ["coverageNote"],
  });
export type Dataset = z.infer<typeof DatasetSchema>;

export const SemanticRoleSchema = z.enum(["category", "x", "y", "uncertainty", "identifier", "other"]);
export type SemanticRole = z.infer<typeof SemanticRoleSchema>;

export const DataTypeSchema = z.enum(["text", "decimal", "date", "datetime", "boolean", "unknown"]);
export type DataType = z.infer<typeof DataTypeSchema>;

export const SourceScaleSchema = z.enum(["linear", "log", "categorical", "unknown"]);
export type SourceScale = z.infer<typeof SourceScaleSchema>;

/**
 * percent_number: 12.5 means 12.5 %. fraction: 0.125 means 12.5 %.
 */
export const PercentRepresentationSchema = z.enum(["percent_number", "fraction"]);
export type PercentRepresentation = z.infer<typeof PercentRepresentationSchema>;

export const DatePolicySchema = z.object({
  /** Parsing format that produced the current values, e.g. "YYYY-MM-DD", "MM/DD/YYYY". */
  format: z.string().max(64),
  /** "date_only" keeps calendar dates without time zone; "utc" stores ISO instants in UTC. */
  timezone: z.enum(["date_only", "utc"]),
});
export type DatePolicy = z.infer<typeof DatePolicySchema>;

export const ColumnSchema = z.object({
  id: IdSchema,
  label: z.string().max(300),
  semanticRole: SemanticRoleSchema,
  dataType: DataTypeSchema,
  unit: z.string().max(64).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  percentRepresentation: PercentRepresentationSchema.nullable(),
  datePolicy: DatePolicySchema.nullable(),
  sourceScale: SourceScaleSchema,
  /** Series identity for wide-format y columns, as named in the source; null when not a series. */
  seriesLabel: z.string().max(300).nullable(),
});
export type Column = z.infer<typeof ColumnSchema>;

export const MissingReasonSchema = z.enum(["blank", "unreadable", "not_reported", "invalid", "not_applicable"]);
export type MissingReason = z.infer<typeof MissingReasonSchema>;

export const CellOriginSchema = z.enum(["parsed", "transcribed", "estimated", "derived", "user_edit"]);
export type CellOrigin = z.infer<typeof CellOriginSchema>;

export const ReviewStatusSchema = z.enum(["unreviewed", "accepted", "corrected", "unavailable"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

/**
 * currentValue encoding by valueType:
 *  - decimal: canonical decimal string (see DecimalStringSchema)
 *  - date: "YYYY-MM-DD"; datetime: ISO 8601 UTC
 *  - boolean: boolean; text/unknown: string
 *  - null always means missing, with missingReason set.
 */
export const CellSchema = z
  .object({
    id: IdSchema,
    /** Original text as read from the source; immutable across versions. Null if the source had no text. */
    rawText: z.string().nullable(),
    currentValue: z.union([z.string(), z.boolean()]).nullable(),
    valueType: DataTypeSchema,
    missingReason: MissingReasonSchema.nullable(),
    origin: CellOriginSchema,
    reviewStatus: ReviewStatusSchema,
    provenanceIds: z.array(IdSchema),
    parentCellIds: z.array(IdSchema),
    notes: z.array(z.string().max(1000)),
  })
  .refine((c) => (c.currentValue === null) === (c.missingReason !== null), {
    message: "missingReason must be set exactly when currentValue is null",
    path: ["missingReason"],
  });
export type Cell = z.infer<typeof CellSchema>;

export const RowSchema = z.object({
  id: IdSchema,
  /** Position in the original source selection. Stable; never re-numbered by sorts or deletions. */
  sourceOrder: z.number().int().min(0),
  /** Keyed by stable column id. */
  cells: z.record(z.string(), CellSchema),
});
export type Row = z.infer<typeof RowSchema>;

export const ReviewSummarySchema = z.object({
  cellsTotal: z.number().int().nonnegative(),
  unreviewed: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  corrected: z.number().int().nonnegative(),
  unavailable: z.number().int().nonnegative(),
});
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

export const DatasetVersionSchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  parentVersionId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  columns: z.array(ColumnSchema),
  rowCount: z.number().int().nonnegative(),
  /** Operation that produced this version; null for the initial version. */
  operationId: IdSchema.nullable(),
  unresolvedFindingCount: z.number().int().nonnegative(),
  reviewSummary: ReviewSummarySchema,
});
export type DatasetVersion = z.infer<typeof DatasetVersionSchema>;

/** Full immutable content of one version. Rows are in sourceOrder. */
export interface DatasetVersionSnapshot {
  version: DatasetVersion;
  rows: Row[];
}

export function computeReviewSummary(rows: Row[]): ReviewSummary {
  const s: ReviewSummary = { cellsTotal: 0, unreviewed: 0, accepted: 0, corrected: 0, unavailable: 0 };
  for (const row of rows) {
    for (const cell of Object.values(row.cells)) {
      s.cellsTotal += 1;
      s[cell.reviewStatus] += 1;
    }
  }
  return s;
}
