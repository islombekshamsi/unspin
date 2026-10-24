import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

export const JobStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobStageSchema = z.enum([
  "queued",
  "preparing_input",
  "awaiting_provider",
  "validating",
  "committing",
  "finished",
]);
export type JobStage = z.infer<typeof JobStageSchema>;

export const JobErrorSchema = z.object({
  code: z.string(),
  message: z.string().max(1000),
  retryable: z.boolean(),
});
export type JobError = z.infer<typeof JobErrorSchema>;

export const JobSchema = z.object({
  id: IdSchema,
  sourceSelectionId: IdSchema,
  operationType: z.enum(["extraction", "structured_parse"]),
  status: JobStatusSchema,
  stage: JobStageSchema,
  cancellationRequested: z.boolean(),
  createdAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.nullable(),
  finishedAt: IsoDateTimeSchema.nullable(),
  attemptCount: z.number().int().nonnegative(),
  /** Only set when progress is measurable (e.g. pages done / total); provider waits are indeterminate. */
  measuredProgress: z.object({ done: z.number().int(), total: z.number().int(), unit: z.string() }).nullable(),
  error: JobErrorSchema.nullable(),
  resultDatasetId: IdSchema.nullable(),
});
export type Job = z.infer<typeof JobSchema>;

export const CreateExtractionRequestSchema = z.object({
  selectionId: IdSchema,
  /** Required true when the selection will be sent to an external model. */
  consentToExternalProcessing: z.boolean(),
});
export type CreateExtractionRequest = z.infer<typeof CreateExtractionRequestSchema>;
