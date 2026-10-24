import {
  AppError,
  type ExtractionInput,
  type ParsedDatasetDraft,
  type Source,
  type SourceSelection,
} from "@/contracts";

/**
 * Extraction service seam (owner: Extraction specialist).
 * Signatures are frozen by the coordinator; implementations replace these bodies.
 */

export interface ExtractionAvailability {
  configured: boolean;
  model: string | null;
  /** Human-readable reason when not configured. Never includes secret values. */
  reason: string | null;
}

export function extractionAvailability(): ExtractionAvailability {
  return { configured: false, model: null, reason: "Model extraction is not implemented yet." };
}

/**
 * Sends the prepared selection to the model and returns a validated candidate draft.
 * Throws AppError: not_configured, provider_quota, rate_limited, timeout, provider_failure,
 * invalid_provider_response, no_data_found, semantic_validation_failed, cancelled.
 */
export async function extractCandidate(args: {
  source: Source;
  selection: SourceSelection;
  input: ExtractionInput;
  signal: AbortSignal;
}): Promise<ParsedDatasetDraft> {
  void args;
  throw new AppError("not_configured", "Model extraction is not implemented yet.");
}
