import { z } from "zod";
import { IdSchema } from "./common";
import { DatasetSchema, DatasetVersionSchema, RowSchema } from "./dataset";
import { ProvenanceSchema } from "./provenance";
import { QualityFindingSchema } from "./quality";
import { HistoryEntrySchema } from "./operations";

/** Every successful JSON response carries a requestId alongside its payload. */
export type ApiOk<T> = T & { requestId: string };

export const LimitsSchema = z.object({
  maxUploadBytes: z.number().int(),
  maxStructuredRows: z.number().int(),
  maxColumns: z.number().int(),
  maxImagePixels: z.number().int(),
  maxPdfPages: z.number().int(),
  maxPdfRegionsPerExtraction: z.number().int(),
  maxExtractedRowsPerRegion: z.number().int(),
  maxRowsPageSize: z.number().int(),
  maxChartPoints: z.number().int(),
  acceptedKinds: z.array(z.string()),
  acceptedMimeTypes: z.array(z.string()),
});
export type Limits = z.infer<typeof LimitsSchema>;

export const HealthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  capabilities: z.object({
    gemini: z.object({ configured: z.boolean(), model: z.string().nullable(), reason: z.string().nullable() }),
    persistence: z.object({
      mode: z.enum(["memory", "postgres"]),
      durable: z.boolean(),
      ready: z.boolean(),
    }),
    blobStorage: z.object({ mode: z.enum(["memory", "filesystem", "s3"]), ready: z.boolean() }),
    jobs: z.object({ mode: z.enum(["inline", "worker"]) }),
    accounts: z.object({ configured: z.boolean() }),
    sharing: z.object({ available: z.boolean() }),
    narration: z.object({ configured: z.boolean() }),
  }),
  limits: LimitsSchema,
});
export type Health = z.infer<typeof HealthSchema>;

export const DatasetDetailSchema = z.object({
  dataset: DatasetSchema,
  version: DatasetVersionSchema,
  /** All versions' metadata, oldest first, for the version selector. */
  versions: z.array(DatasetVersionSchema),
  provenance: z.array(ProvenanceSchema),
});
export type DatasetDetail = z.infer<typeof DatasetDetailSchema>;

export const RowsQuerySchema = z.object({
  versionId: IdSchema,
  cursor: z.string().nullable().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  sortColumnId: IdSchema.nullable().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  /** Case-insensitive substring filter on displayed text of one column. */
  filterColumnId: IdSchema.nullable().optional(),
  filterText: z.string().max(200).nullable().optional(),
  /** Only these rows, in sourceOrder. Comma-separated in the query string; at most MAX_ROW_IDS_PER_QUERY. */
  rowIds: z
    .preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(IdSchema).min(1).max(100))
    .optional(),
});
export type RowsQuery = z.infer<typeof RowsQuerySchema>;
export const MAX_ROW_IDS_PER_QUERY = 100;

export const RowsPageSchema = z.object({
  versionId: IdSchema,
  rows: z.array(RowSchema),
  /** Total after filtering. */
  totalRows: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});
export type RowsPage = z.infer<typeof RowsPageSchema>;

export const FindingsResponseSchema = z.object({
  versionId: IdSchema,
  findings: z.array(QualityFindingSchema),
});

export const HistoryResponseSchema = z.object({
  datasetId: IdSchema,
  currentVersionId: IdSchema,
  entries: z.array(HistoryEntrySchema),
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

export const AcknowledgeCoverageRequestSchema = z.object({
  expectedVersionId: IdSchema,
  acknowledged: z.literal(true),
});
