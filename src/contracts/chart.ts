import { z } from "zod";
import { IdSchema } from "./common";

export const ChartKindSchema = z.enum(["bar", "line", "scatter"]);
export type ChartKind = z.infer<typeof ChartKindSchema>;

export const AxisScaleSchema = z.enum(["linear", "log", "category", "date"]);
export type AxisScale = z.infer<typeof AxisScaleSchema>;

export const ChartSeriesSchema = z.object({
  seriesId: IdSchema,
  yColumnId: IdSchema,
  label: z.string().max(300),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  visible: z.boolean(),
});
export type ChartSeries = z.infer<typeof ChartSeriesSchema>;

export const BaselinePolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("include_zero") }),
  z.object({ mode: z.literal("fit_data") }),
  z.object({ mode: z.literal("explicit_bounds"), min: z.number(), max: z.number() }),
]);
export type BaselinePolicy = z.infer<typeof BaselinePolicySchema>;

export const NormalizationSchema = z.object({
  /** Row whose value becomes the index base. */
  baseRowId: IdSchema,
  formula: z.literal("value / base * 100"),
  compatibility: z.enum(["compatible", "incompatible", "unknown"]),
});
export type Normalization = z.infer<typeof NormalizationSchema>;

export const ChartConfigSchema = z.object({
  id: IdSchema,
  datasetVersionIds: z.array(IdSchema).min(1),
  kind: ChartKindSchema,
  xColumnId: IdSchema,
  series: z.array(ChartSeriesSchema).min(1),
  xScale: AxisScaleSchema,
  yScale: AxisScaleSchema,
  baselinePolicy: BaselinePolicySchema,
  normalization: NormalizationSchema.nullable(),
  missingPolicy: z.literal("gaps"),
  aggregation: z.null(),
  sampling: z.object({ method: z.literal("every_nth"), keptCount: z.number().int() }).nullable(),
  displayedUnits: z.object({ x: z.string().nullable(), y: z.string().nullable() }),
  configVersion: z.number().int().positive(),
});
export type ChartConfig = z.infer<typeof ChartConfigSchema>;

export const ChartQueryRequestSchema = z.object({
  savedViewId: IdSchema.optional(),
  versionId: IdSchema,
  xColumnId: IdSchema,
  yColumnIds: z.array(IdSchema).min(1).max(12),
  maxPoints: z.number().int().min(1).max(20000).optional(),
});
export type ChartQueryRequest = z.infer<typeof ChartQueryRequestSchema>;

export const ChartPointSchema = z.object({
  /** Stable: `${rowId}:${yColumnId}`. Never an array position. */
  pointId: z.string(),
  rowId: IdSchema,
  /** The row's position in the original selection (Row.sourceOrder), for "source row N" descriptions. */
  sourceOrder: z.number().int().min(0),
  yColumnId: IdSchema,
  xCellId: IdSchema,
  yCellId: IdSchema,
  /** Numeric x as decimal string, date x as ISO string, category x as text; null if missing. */
  x: z.string().nullable(),
  /** Decimal string; null produces a gap. */
  y: z.string().nullable(),
  provenanceIds: z.array(IdSchema),
  yOrigin: z.enum(["parsed", "transcribed", "estimated", "derived", "user_edit"]),
});
export type ChartPoint = z.infer<typeof ChartPointSchema>;

export const ChartQueryResultSchema = z.object({
  versionId: IdSchema,
  xColumnId: IdSchema,
  xKind: z.enum(["numeric", "date", "category"]),
  points: z.array(ChartPointSchema),
  sampling: z.object({ method: z.literal("every_nth"), keptCount: z.number().int(), totalCount: z.number().int() }).nullable(),
  excluded: z.object({
    missingY: z.number().int().nonnegative(),
    nonNumericY: z.number().int().nonnegative(),
    missingX: z.number().int().nonnegative(),
  }),
});
export type ChartQueryResult = z.infer<typeof ChartQueryResultSchema>;

/** Linked selection shared by grid, chart, and source panels. */
export const SelectionEventSchema = z.object({
  origin: z.enum(["grid", "chart", "source", "quality"]),
  datasetVersionId: IdSchema,
  rowIds: z.array(IdSchema),
  cellIds: z.array(IdSchema),
  provenanceIds: z.array(IdSchema),
});
export type SelectionEvent = z.infer<typeof SelectionEventSchema>;
