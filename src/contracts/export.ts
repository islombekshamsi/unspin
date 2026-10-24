import { z } from "zod";
import { CONTRACT_SCHEMA_VERSION, IdSchema, IsoDateTimeSchema, Sha256HexSchema } from "./common";
import { ColumnSchema, CoverageSchema, ExtractionInfoSchema, ReviewSummarySchema } from "./dataset";
import { HistoryEntrySchema } from "./operations";
import { ProvenanceSchema } from "./provenance";
import { ProcessingDisclosureSchema, SourceKindSchema, SourceSelectionSchema } from "./source";

export const ExportFormatSchema = z.enum(["csv", "json", "manifest"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ExportScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("full") }),
  /** Current view: explicit row ids (in display order) and column ids chosen by the user. */
  z.object({
    kind: z.literal("view"),
    rowIds: z.array(IdSchema).min(1),
    columnIds: z.array(IdSchema).min(1),
    description: z.string().max(500),
  }),
]);
export type ExportScope = z.infer<typeof ExportScopeSchema>;

export const CreateExportRequestSchema = z.object({
  versionId: IdSchema,
  formats: z.array(ExportFormatSchema).min(1),
  scope: ExportScopeSchema,
  /** Required when dataset coverage is partial/uncertain and not yet acknowledged. */
  acknowledgePartial: z.boolean(),
});
export type CreateExportRequest = z.infer<typeof CreateExportRequestSchema>;

export const ExportFileSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  content: z.string(),
});
export type ExportFile = z.infer<typeof ExportFileSchema>;

export const ExportResultSchema = z.object({
  id: IdSchema,
  createdAt: IsoDateTimeSchema,
  files: z.array(ExportFileSchema),
});
export type ExportResult = z.infer<typeof ExportResultSchema>;

/** Machine-readable provenance/history manifest shipped with every export. */
export const ExportManifestSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  software: z.object({ name: z.literal("UNSPIN"), version: z.string() }),
  exportedAt: IsoDateTimeSchema,
  scope: ExportScopeSchema,
  csvPolicy: z.object({
    nullRepresentation: z.string(),
    decimalSeparator: z.literal("."),
    numericValues: z.string(),
    formulaInjection: z.string(),
  }),
  source: z.object({
    sourceId: IdSchema,
    kind: SourceKindSchema,
    filename: z.string(),
    sha256: Sha256HexSchema,
    byteSize: z.number().int(),
    processingDisclosure: ProcessingDisclosureSchema,
  }),
  selection: SourceSelectionSchema,
  dataset: z.object({
    id: IdSchema,
    title: z.string(),
    extractionMethod: z.string(),
    extraction: ExtractionInfoSchema.nullable(),
    coverage: CoverageSchema,
    coverageNote: z.string().nullable(),
    coverageAcknowledgedAt: IsoDateTimeSchema.nullable(),
    initialVersionId: IdSchema,
    exportedVersionId: IdSchema,
    currentVersionId: IdSchema,
  }),
  columns: z.array(ColumnSchema),
  reviewSummary: ReviewSummarySchema,
  reviewStatement: z.string(),
  rowCount: z.number().int(),
  history: z.array(HistoryEntrySchema),
  provenance: z.array(ProvenanceSchema),
});
export type ExportManifest = z.infer<typeof ExportManifestSchema>;
