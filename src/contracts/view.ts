import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

/** Named row subsets offered in the grid toolbar. Counts may overlap; they are not parts of a total. */
export const ViewPresetSchema = z.enum(["all", "needs_review", "estimated", "edited"]);
export type ViewPreset = z.infer<typeof ViewPresetSchema>;

export const ViewSortSchema = z.object({
  columnId: IdSchema.nullable(),
  direction: z.enum(["asc", "desc"]),
});
export type ViewSort = z.infer<typeof ViewSortSchema>;

/**
 * Display-only view. Sorting, hiding columns, search, and presets never create a dataset version.
 * Filter predicates are allowlisted; the server applies them to the full version, not the loaded page.
 */
export const ViewSpecSchema = z.object({
  preset: ViewPresetSchema.default("all"),
  search: z.string().max(200).nullable(),
  filterColumnId: IdSchema.nullable(),
  filterText: z.string().max(200).nullable(),
  sort: ViewSortSchema,
  /** Visible columns in display order. Null means every column. */
  columnIds: z.array(IdSchema).max(64).nullable(),
});
export type ViewSpec = z.infer<typeof ViewSpecSchema>;

export const SavedViewSchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  name: z.string().min(1).max(80),
  spec: ViewSpecSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SavedView = z.infer<typeof SavedViewSchema>;

export const CreateSavedViewRequestSchema = z.object({
  name: z.string().min(1).max(80),
  spec: ViewSpecSchema,
});
export type CreateSavedViewRequest = z.infer<typeof CreateSavedViewRequestSchema>;

export const UpdateSavedViewRequestSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  spec: ViewSpecSchema.optional(),
});
export type UpdateSavedViewRequest = z.infer<typeof UpdateSavedViewRequestSchema>;

export const PresetCountSchema = z.object({
  preset: ViewPresetSchema,
  /** Rows matching the preset on the current version (search/column filter not applied). */
  rowCount: z.number().int().nonnegative(),
});
export type PresetCount = z.infer<typeof PresetCountSchema>;
