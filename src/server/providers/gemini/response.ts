import { z } from "zod";
import { AppError } from "@/contracts";
import {
  AXIS_SCALES,
  COLUMN_ROLES,
  COLUMN_TYPES,
  CONTENT_KINDS,
  MISSING_REASONS,
  PERCENT_FORMS,
  READING_METHODS,
  RESULT_STATUSES,
  WARNING_KINDS,
} from "./prompt";

/** Bounded free text from the model; long strings are a protocol violation, not data to keep. */
const ModelText = z.string().max(2000);

export const ModelColumnSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().max(300),
  role: z.enum(COLUMN_ROLES),
  dataType: z.enum(COLUMN_TYPES),
  unit: z.string().max(64).nullable(),
  currency: z.string().max(16).nullable(),
  percent: z.enum(PERCENT_FORMS).nullable(),
  axisScale: z.enum(AXIS_SCALES),
  seriesLabel: z.string().max(300).nullable(),
});
export type ModelColumn = z.infer<typeof ModelColumnSchema>;

export const ModelCellSchema = z.object({
  column: z.string().min(1).max(64),
  text: z.string().max(500).nullable(),
  method: z.enum(READING_METHODS),
  missingReason: z.enum(MISSING_REASONS).nullable(),
  box: z.array(z.number()).nullable(),
  note: ModelText.nullable(),
  sourceQuote: ModelText.nullable().optional(),
});
export type ModelCell = z.infer<typeof ModelCellSchema>;

export const ModelExtractionSchema = z.object({
  status: z.enum(RESULT_STATUSES),
  contentKind: z.enum(CONTENT_KINDS),
  visibleTitle: z.string().max(500).nullable(),
  statusExplanation: ModelText.nullable(),
  coverage: z.enum(["complete", "partial"]),
  coverageNote: ModelText.nullable(),
  columns: z.array(ModelColumnSchema).max(256),
  rows: z.array(z.object({ cells: z.array(ModelCellSchema).max(256) })).max(5000),
  warnings: z.array(z.object({ kind: z.enum(WARNING_KINDS), message: ModelText })).max(100),
});
export type ModelExtraction = z.infer<typeof ModelExtractionSchema>;

/** Finish reasons that mean the output was cut off rather than completed. */
const TRUNCATING = new Set(["MAX_TOKENS", "CONTINUATION"]);
/** Finish/block reasons that mean the provider refused the content. */
const REFUSING = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "OTHER",
  "LANGUAGE",
]);

export interface ParsedResponse {
  extraction: ModelExtraction;
  /** True when the provider reported a cut-off but the JSON still parsed. */
  truncated: boolean;
}

/**
 * Turns raw provider text into a validated extraction. Never returns partially
 * parsed content: malformed or truncated output is an error, not data.
 */
export function parseProviderResponse(raw: {
  text: string | undefined;
  finishReason: string | null;
  blockReason: string | null;
}): ParsedResponse {
  if (raw.blockReason) {
    throw new AppError(
      "extraction_failed",
      "The model provider declined to process this selection under its content policy. Nothing was saved.",
      { details: { providerReason: "blocked" } },
    );
  }
  const finish = raw.finishReason ?? "";
  const truncated = TRUNCATING.has(finish);
  if (REFUSING.has(finish)) {
    throw new AppError(
      "extraction_failed",
      "The model stopped without producing a result for this selection (content policy or unsupported content). Nothing was saved.",
      { details: { providerReason: "refused" } },
    );
  }
  const text = raw.text?.trim() ?? "";
  if (!text) {
    throw new AppError(
      "invalid_provider_response",
      truncated
        ? "The model ran out of output space before returning any data. Try a smaller selection."
        : "The model returned an empty response. Nothing was saved.",
      { retryable: true },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AppError(
      "invalid_provider_response",
      truncated
        ? "The model's response was cut off at its output limit, so the data is incomplete and was not saved. Try a smaller selection."
        : "The model returned a response that is not valid JSON. Nothing was saved.",
      { retryable: true, details: { truncated } },
    );
  }
  const parsed = ModelExtractionSchema.safeParse(json);
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((i) => i.path.filter((p) => typeof p === "string").join(".")))].slice(0, 5);
    throw new AppError("invalid_provider_response", "The model's response did not match the expected structure. Nothing was saved.", {
      retryable: true,
      details: { schemaPaths: paths },
    });
  }
  return { extraction: parsed.data, truncated };
}
