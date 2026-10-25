import { z } from "zod";
import {
  IdSchema,
  IsoDateTimeSchema,
  NormalizedRectSchema,
  PdfBoxSchema,
  PixelBoxSchema,
  Sha256HexSchema,
} from "./common";

export const SourceKindSchema = z.enum(["pdf", "image", "csv", "xlsx"]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const ProcessingDisclosureSchema = z.enum([
  "local_parser",
  "gemini_selected_region",
  "gemini_whole_file",
]);
export type ProcessingDisclosure = z.infer<typeof ProcessingDisclosureSchema>;

/** Capabilities reflect the implemented path for this source, not aspirations. */
export const SourceCapabilitiesSchema = z.object({
  preview: z.boolean(),
  crop: z.boolean(),
  selectSheet: z.boolean(),
  textCoordinates: z.boolean(),
});
export type SourceCapabilities = z.infer<typeof SourceCapabilitiesSchema>;

/** Raster facts for image sources, captured at validation time. */
export const ImageInfoSchema = z.object({
  format: z.enum(["png", "jpeg", "webp"]),
  originalWidth: z.number().int().positive(),
  originalHeight: z.number().int().positive(),
  /** EXIF orientation tag 1..8; 1 when absent. */
  exifOrientation: z.number().int().min(1).max(8),
  /** Dimensions after applying orientation; normalized selections are measured against these. */
  orientedWidth: z.number().int().positive(),
  orientedHeight: z.number().int().positive(),
});
export type ImageInfo = z.infer<typeof ImageInfoSchema>;

export const SourceSchema = z.object({
  id: IdSchema,
  /** Display metadata only; never used to build storage paths. */
  filename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(128),
  byteSize: z.number().int().nonnegative(),
  sha256: Sha256HexSchema,
  createdAt: IsoDateTimeSchema,
  kind: SourceKindSchema,
  pageCount: z.number().int().positive().nullable(),
  sheetNames: z.array(z.string()).nullable(),
  processingDisclosure: ProcessingDisclosureSchema,
  capabilities: SourceCapabilitiesSchema,
  image: ImageInfoSchema.nullable(),
});
export type Source = z.infer<typeof SourceSchema>;

/** Output of upload validation, before the server assigns id/createdAt. */
export const ValidatedUploadSchema = SourceSchema.omit({ id: true, createdAt: true });
export type ValidatedUpload = z.infer<typeof ValidatedUploadSchema>;

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

export const UserHintSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .describe("Bounded description of the intended figure/series. Untrusted data, never instructions.");

const ImageRegionInput = z.object({
  kind: z.literal("image_region"),
  region: NormalizedRectSchema,
  userHint: UserHintSchema.nullable(),
  /** Explicit-value structuring from prose; absent keeps chart/table extraction. */
  extractionMode: z.enum(["chart_table", "text"]).optional(),
});

const PdfRegionInput = z.object({
  kind: z.literal("pdf_region"),
  pageNumber: z.number().int().positive(),
  /** Null selects the whole page. */
  region: NormalizedRectSchema.nullable(),
  userHint: UserHintSchema.nullable(),
  /** Explicit-value structuring from prose; absent keeps chart/table extraction. */
  extractionMode: z.enum(["chart_table", "text"]).optional(),
});

export const CsvDelimiterSchema = z.enum([",", ";", "\t", "|"]);
export type CsvDelimiter = z.infer<typeof CsvDelimiterSchema>;

const CsvRecordsInput = z.object({
  kind: z.literal("csv_records"),
  delimiter: CsvDelimiterSchema,
  /**
   * Records before the header that are not part of the table (for example "#" comment lines).
   * Absent means 0. Skipped records are disclosed as an import issue; line numbers stay physical.
   */
  skipLeadingRecords: z.number().int().min(0).max(10_000).optional(),
  /** 0 means no header record; column labels are then generated as "Column 1".. */
  headerRecordCount: z.number().int().min(0).max(1),
  /** Zero-based source column indexes; null selects all columns. */
  selectedColumnIndexes: z.array(z.number().int().min(0)).min(1).nullable(),
  /** Zero-based data-record interval (after header records), end exclusive; null selects all. */
  recordInterval: z
    .object({ start: z.number().int().min(0), endExclusive: z.number().int().positive() })
    .refine((r) => r.endExclusive > r.start, "Interval must be non-empty")
    .nullable(),
});

const XlsxRangeInput = z.object({
  kind: z.literal("xlsx_range"),
  sheetName: z.string().min(1),
  /** A1-style range such as "A1:F40"; null selects the sheet's used range. */
  range: z
    .string()
    .regex(/^[A-Z]{1,3}[1-9]\d*:[A-Z]{1,3}[1-9]\d*$/)
    .nullable(),
  headerRowCount: z.number().int().min(0).max(1),
});

/** What the client submits. The server resolves transforms and persists a SourceSelection. */
export const SelectionInputSchema = z.discriminatedUnion("kind", [
  ImageRegionInput,
  PdfRegionInput,
  CsvRecordsInput,
  XlsxRangeInput,
]);
export type SelectionInput = z.infer<typeof SelectionInputSchema>;

export const CreateSelectionRequestSchema = z.object({
  sourceId: IdSchema,
  selection: SelectionInputSchema,
});
export type CreateSelectionRequest = z.infer<typeof CreateSelectionRequestSchema>;

/** Reproducible mapping from the normalized selection to original pixels. */
export const ImageTransformSchema = z.object({
  originalWidth: z.number().int().positive(),
  originalHeight: z.number().int().positive(),
  exifOrientation: z.number().int().min(1).max(8),
  orientedWidth: z.number().int().positive(),
  orientedHeight: z.number().int().positive(),
  /** Crop box in oriented-pixel space. */
  orientedPixelBox: PixelBoxSchema,
});
export type ImageTransform = z.infer<typeof ImageTransformSchema>;

export const PdfPageGeometrySchema = z.object({
  /** Unrotated page size in PDF points (from the page view box). */
  widthPt: z.number().positive(),
  heightPt: z.number().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});
export type PdfPageGeometry = z.infer<typeof PdfPageGeometrySchema>;

export const PdfTransformSchema = z.object({
  page: PdfPageGeometrySchema,
  /** Selected box in unrotated PDF user space; whole page when region was null. */
  pdfBox: PdfBoxSchema,
  /** Render scale used to rasterize the region (pixels per PDF point), when rasterized. */
  renderScale: z.number().positive().nullable(),
  renderedPixelSize: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .nullable(),
});
export type PdfTransform = z.infer<typeof PdfTransformSchema>;

const SelectionBase = z.object({
  id: IdSchema,
  sourceId: IdSchema,
  createdAt: IsoDateTimeSchema,
});

export const SourceSelectionSchema = z.discriminatedUnion("kind", [
  SelectionBase.extend(ImageRegionInput.shape).extend({ transform: ImageTransformSchema }),
  SelectionBase.extend(PdfRegionInput.shape).extend({ transform: PdfTransformSchema }),
  SelectionBase.extend(CsvRecordsInput.shape),
  SelectionBase.extend(XlsxRangeInput.shape),
]);
export type SourceSelection = z.infer<typeof SourceSelectionSchema>;

/** Selection fields that ingestion resolves before the server assigns id/createdAt. */
export type ResolvedSelection = DistributiveOmit<SourceSelection, "id" | "createdAt">;

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function isStructuredSelection(
  s: SourceSelection,
): s is Extract<SourceSelection, { kind: "csv_records" | "xlsx_range" }> {
  return s.kind === "csv_records" || s.kind === "xlsx_range";
}

// ---------------------------------------------------------------------------
// Structured preview (CSV/XLSX inspection before a selection is committed)
// ---------------------------------------------------------------------------

export const StructuredInspectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("csv"),
    suggestedDelimiter: CsvDelimiterSchema,
    delimiterUsed: CsvDelimiterSchema,
    /** Leading records that look like comments; header suggestion and record stats are computed after them. */
    suggestedSkipLeadingRecords: z.number().int().nonnegative(),
    skipReason: z.string().nullable(),
    suggestedHeaderRecordCount: z.number().int().min(0).max(1),
    hasBom: z.boolean(),
    totalRecords: z.number().int().nonnegative(),
    /** Raw field strings for the first records exactly as parsed, starting at record 0 (skipped records included). */
    previewRecords: z.array(z.array(z.string())),
    maxFieldCount: z.number().int().nonnegative(),
    inconsistentRecords: z.array(
      z.object({ recordIndex: z.number().int(), fieldCount: z.number().int() }),
    ),
    issues: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("xlsx"),
    sheets: z.array(
      z.object({
        name: z.string(),
        state: z.enum(["visible", "hidden", "veryHidden"]),
        usedRange: z.string().nullable(),
        rowCount: z.number().int().nonnegative(),
        columnCount: z.number().int().nonnegative(),
        mergedRanges: z.array(z.string()),
        formulaCellCount: z.number().int().nonnegative(),
        formulasWithoutCachedValue: z.number().int().nonnegative(),
      }),
    ),
    sheetUsed: z.string().nullable(),
    /** Displayed text for the first rows of the selected sheet; null for empty cells. */
    previewRows: z.array(z.array(z.string().nullable())),
    issues: z.array(z.string()),
  }),
]);
export type StructuredInspection = z.infer<typeof StructuredInspectionSchema>;
