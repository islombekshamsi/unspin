import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";
import { TransformOperationSchema } from "./operations";

export const FindingKindSchema = z.enum([
  "missing_values",
  "repeated_rows",
  "mixed_numeric_format",
  "ambiguous_date",
  "mixed_units",
  "type_mismatch",
  "inconsistent_field_count",
  "extraction_issue",
  "partial_coverage",
]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const FindingSeveritySchema = z.enum(["info", "review", "blocking"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

/** A flag is a question for review, not proof of an error. */
export const QualityFindingSchema = z.object({
  id: IdSchema,
  datasetVersionId: IdSchema,
  kind: FindingKindSchema,
  severity: FindingSeveritySchema,
  message: z.string().max(1000),
  affectedRowIds: z.array(IdSchema),
  affectedColumnIds: z.array(IdSchema),
  affectedCellIds: z.array(IdSchema),
  /** Observable facts from the parser/source/values. */
  evidence: z.array(z.string().max(1000)),
  suggestedOperation: TransformOperationSchema.nullable(),
  dismissedAt: IsoDateTimeSchema.nullable(),
});
export type QualityFinding = z.infer<typeof QualityFindingSchema>;
