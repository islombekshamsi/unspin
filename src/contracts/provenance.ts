import { z } from "zod";
import { IdSchema, IsoDateTimeSchema, PdfBoxSchema, PixelBoxSchema } from "./common";

export const ExtractionMethodSchema = z.enum([
  "deterministic_parser",
  "pdf_text",
  "pdf_vector",
  "vision_estimate",
  "manual",
]);
export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>;

export const LocatorOriginSchema = z.enum(["parser", "model_hint", "user_confirmed", "operation"]);
export type LocatorOrigin = z.infer<typeof LocatorOriginSchema>;

export const LocatorAvailabilitySchema = z.enum(["precise", "region_only", "page_only", "unavailable"]);
export type LocatorAvailability = z.infer<typeof LocatorAvailabilitySchema>;

/**
 * Where a value came from. Boxes always name their coordinate system.
 * Model-proposed boxes keep locatorOrigin "model_hint" and must be styled as hints.
 */
export const LocatorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("image_box"),
    coordinateSystem: z.literal("oriented_source_pixels"),
    box: PixelBoxSchema,
  }),
  z.object({
    type: z.literal("pdf_box"),
    pageNumber: z.number().int().positive(),
    coordinateSystem: z.literal("pdf_user_space_points"),
    box: PdfBoxSchema,
  }),
  z.object({
    type: z.literal("pdf_page"),
    pageNumber: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("figure_label"),
    label: z.string().max(500),
    pageNumber: z.number().int().positive().nullable(),
  }),
  z.object({
    type: z.literal("csv_record"),
    /** Zero-based index of the data record (after header records). */
    recordIndex: z.number().int().min(0),
    /** One-based physical line span; multiline quoted fields span several lines. */
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    fieldIndex: z.number().int().min(0).nullable(),
  }),
  z.object({
    type: z.literal("xlsx_cell"),
    sheetName: z.string(),
    address: z.string().regex(/^[A-Z]{1,3}[1-9]\d*$/),
  }),
  z.object({
    type: z.literal("user_edit"),
    operationId: IdSchema,
  }),
  z.object({
    type: z.literal("derived_operation"),
    operationId: IdSchema,
  }),
]);
export type Locator = z.infer<typeof LocatorSchema>;
export type LocatorType = Locator["type"];

export const ProvenanceSchema = z.object({
  id: IdSchema,
  sourceId: IdSchema,
  sourceSelectionId: IdSchema,
  locator: LocatorSchema,
  locatorOrigin: LocatorOriginSchema,
  locatorAvailability: LocatorAvailabilitySchema,
  label: z.string().max(500),
  extractionMethod: ExtractionMethodSchema,
  createdAt: IsoDateTimeSchema,
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
