import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";
import { DataTypeSchema, MissingReasonSchema, ReviewStatusSchema } from "./dataset";

/**
 * Discriminated allowlist of dataset transformations. Nothing here carries
 * executable strings, SQL, formulas, or model-supplied code.
 */

const EditCell = z.object({
  type: z.literal("edit_cell"),
  rowId: IdSchema,
  columnId: IdSchema,
  cellId: IdSchema,
  /** Null marks the cell missing; missingReason is then required. */
  newValue: z.union([z.string(), z.boolean()]).nullable(),
  explicitType: DataTypeSchema,
  missingReason: MissingReasonSchema.nullable(),
  note: z.string().max(1000).nullable(),
});

const RenameColumn = z.object({
  type: z.literal("rename_column"),
  columnId: IdSchema,
  newLabel: z.string().min(1).max(300),
});

const SetColumnUnit = z.object({
  type: z.literal("set_column_unit"),
  columnId: IdSchema,
  unit: z.string().max(64).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
});

const TrimText = z.object({
  type: z.literal("trim_text"),
  columnIds: z.array(IdSchema).min(1),
  rowIds: z.array(IdSchema).min(1).nullable(),
});

export const NumericLocaleSchema = z.object({
  decimalSeparator: z.enum([".", ","]),
  /** Thousands separator accepted when groupingPolicy allows it. */
  groupingSeparator: z.enum([",", ".", " ", "\u00a0", "'"]).nullable(),
});
export type NumericLocale = z.infer<typeof NumericLocaleSchema>;

const ParseNumeric = z.object({
  type: z.literal("parse_numeric"),
  columnId: IdSchema,
  locale: NumericLocaleSchema,
  groupingPolicy: z.enum(["forbid", "allow"]),
  /** keep_percent_number: "12.5%" -> 12.5 (percent_number). to_fraction: -> 0.125. reject: flag as failure. */
  percentPolicy: z.enum(["reject", "keep_percent_number", "to_fraction"]),
  /** strip_symbol requires an explicit ISO currency recorded on the column. */
  currencyPolicy: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("reject") }),
    z.object({ mode: z.literal("strip_symbol"), currency: z.string().regex(/^[A-Z]{3}$/) }),
  ]),
  /** Accept "(123)" as -123. */
  parenthesesNegative: z.boolean(),
  onFailure: z.literal("keep_and_flag"),
});

export const DateFormatSchema = z.enum([
  "ISO_8601",
  "YYYY-MM-DD",
  "MM/DD/YYYY",
  "DD/MM/YYYY",
  "DD.MM.YYYY",
  "YYYY-MM",
  "YYYY",
]);
export type DateFormat = z.infer<typeof DateFormatSchema>;

const ParseDate = z.object({
  type: z.literal("parse_date"),
  columnId: IdSchema,
  format: DateFormatSchema,
  timezonePolicy: z.enum(["date_only", "utc"]),
  onFailure: z.literal("keep_and_flag"),
});

const MarkMissing = z.object({
  type: z.literal("mark_missing"),
  columnId: IdSchema,
  /** Exact (case-sensitive, untrimmed) tokens to treat as missing, e.g. "NA", "—". */
  explicitTokens: z.array(z.string().max(64)).min(1).max(32),
  rowIds: z.array(IdSchema).min(1).nullable(),
  missingReason: MissingReasonSchema,
});

const RemoveSelectedRows = z.object({
  type: z.literal("remove_selected_rows"),
  rowIds: z.array(IdSchema).min(1),
});

const RemoveExactDuplicates = z.object({
  type: z.literal("remove_exact_duplicates"),
  /** Columns compared using currentValue + valueType + missingReason. */
  columnIds: z.array(IdSchema).min(1),
  retainPolicy: z.literal("first_in_source_order"),
});

const ConvertUnit = z.object({
  type: z.literal("convert_unit"),
  columnId: IdSchema,
  registeredConversionId: z.string().min(1).max(64),
});

const SetReviewStatus = z.object({
  type: z.literal("set_review_status"),
  cellIds: z.array(IdSchema).min(1),
  /** Records a user review event; it is not scientific validation. */
  reviewStatus: ReviewStatusSchema.exclude(["corrected"]),
});

export const TransformOperationSchema = z.discriminatedUnion("type", [
  EditCell,
  RenameColumn,
  SetColumnUnit,
  TrimText,
  ParseNumeric,
  ParseDate,
  MarkMissing,
  RemoveSelectedRows,
  RemoveExactDuplicates,
  ConvertUnit,
  SetReviewStatus,
]);
export type TransformOperation = z.infer<typeof TransformOperationSchema>;
export type TransformOperationType = TransformOperation["type"];

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export const CellStateSchema = z.object({
  rawText: z.string().nullable(),
  currentValue: z.union([z.string(), z.boolean()]).nullable(),
  valueType: DataTypeSchema,
  missingReason: MissingReasonSchema.nullable(),
});
export type CellState = z.infer<typeof CellStateSchema>;

export const CellChangeSchema = z.object({
  rowId: IdSchema,
  columnId: IdSchema,
  cellId: IdSchema,
  before: CellStateSchema,
  after: CellStateSchema,
});
export type CellChange = z.infer<typeof CellChangeSchema>;

export const TransformPreviewSchema = z.object({
  /** Deterministic sha256 of baseVersionId + canonical operation JSON. */
  operationHash: z.string().regex(/^[a-f0-9]{64}$/),
  operation: TransformOperationSchema,
  baseVersionId: IdSchema,
  affectedCount: z.number().int().nonnegative(),
  rowCountBefore: z.number().int().nonnegative(),
  rowCountAfter: z.number().int().nonnegative(),
  totalChanges: z.number().int().nonnegative(),
  /** One page of actual before/after cell changes. */
  changes: z.array(CellChangeSchema),
  changesCursor: z.string().nullable(),
  removedRowIds: z.array(IdSchema),
  /** Cells whose parse failed and were kept unchanged and flagged. */
  failedCellIds: z.array(IdSchema),
  warnings: z.array(z.string()),
  precisionEffects: z.array(z.string()),
});
export type TransformPreview = z.infer<typeof TransformPreviewSchema>;

export const PreviewTransformRequestSchema = z.object({
  expectedVersionId: IdSchema,
  operation: TransformOperationSchema,
  cursor: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type PreviewTransformRequest = z.infer<typeof PreviewTransformRequestSchema>;

export const ApplyTransformRequestSchema = z.object({
  expectedVersionId: IdSchema,
  operation: TransformOperationSchema,
  operationHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ApplyTransformRequest = z.infer<typeof ApplyTransformRequestSchema>;

export const RestoreVersionRequestSchema = z.object({
  expectedVersionId: IdSchema,
  targetVersionId: IdSchema,
});
export type RestoreVersionRequest = z.infer<typeof RestoreVersionRequestSchema>;

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export const ActorSchema = z.object({
  kind: z.enum(["guest", "account", "system"]),
  /** Display-safe label only, e.g. "Guest session" or an account name. */
  label: z.string().max(200),
});
export type Actor = z.infer<typeof ActorSchema>;

export const HistoryEntrySchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  kind: z.enum(["initial", "transform", "restore"]),
  baseVersionId: IdSchema.nullable(),
  resultVersionId: IdSchema,
  /** Present for transforms; restore entries record targetVersionId instead. */
  operation: TransformOperationSchema.nullable(),
  restoredVersionId: IdSchema.nullable(),
  actor: ActorSchema,
  createdAt: IsoDateTimeSchema,
  affectedCount: z.number().int().nonnegative(),
  rowCountBefore: z.number().int().nonnegative().nullable(),
  rowCountAfter: z.number().int().nonnegative(),
  changedCellIds: z.array(IdSchema),
  removedRowIds: z.array(IdSchema),
  summary: z.string().max(500),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
