import {
  AppError,
  isStructuredSelection,
  type ExtractionInput,
  type ParsedDatasetDraft,
  type Source,
  type SourceSelection,
} from "@/contracts";
import { geminiEnv, geminiStatus } from "@/server/config/env";
import { LIMITS } from "@/server/config/limits";
import { assertSupportedMime, createGeminiProvider, type GeminiProvider } from "@/server/providers/gemini";
import { buildExtractionDraft } from "./draft";

/**
 * Extraction service seam (owner: Extraction specialist).
 * Signatures are frozen by the coordinator.
 */

export interface ExtractionAvailability {
  configured: boolean;
  model: string | null;
  /** Human-readable reason when not configured. Never includes secret values. */
  reason: string | null;
}

/** Presence checks only; the key value is never read into the result. */
export function extractionAvailability(): ExtractionAvailability {
  const status = geminiStatus();
  if (!status.keyPresent && !status.model) {
    return { configured: false, model: null, reason: "Chart and PDF extraction is not configured: GEMINI_API_KEY and GEMINI_MODEL are not set on the server." };
  }
  if (!status.keyPresent) {
    return { configured: false, model: status.model, reason: "Chart and PDF extraction is not configured: GEMINI_API_KEY is not set on the server." };
  }
  if (!status.model) {
    return { configured: false, model: null, reason: "Chart and PDF extraction is not configured: GEMINI_MODEL is not set on the server." };
  }
  return { configured: true, model: status.model, reason: null };
}

export interface ExtractArgs {
  source: Source;
  selection: SourceSelection;
  input: ExtractionInput;
  signal: AbortSignal;
}

/**
 * Sends the prepared selection to the model and returns a validated candidate draft.
 * Throws AppError: not_configured, provider_quota, rate_limited, timeout, provider_failure,
 * invalid_provider_response, no_data_found, unreadable_source, extraction_failed,
 * too_many_rows, cancelled.
 */
export async function extractCandidate(args: ExtractArgs): Promise<ParsedDatasetDraft> {
  const env = geminiEnv();
  if (!env) {
    throw new AppError("not_configured", extractionAvailability().reason ?? "Model extraction is not configured on this server.");
  }
  return extractWithProvider(createGeminiProvider(env), args);
}

/** Same pipeline with an explicit provider; used by extractCandidate and isolated tests. */
export async function extractWithProvider(provider: GeminiProvider, args: ExtractArgs): Promise<ParsedDatasetDraft> {
  const { source, selection, input, signal } = args;
  if (isStructuredSelection(selection)) {
    throw new AppError("bad_request", "Spreadsheet selections are parsed locally and never sent to the model.");
  }
  if (selection.sourceId !== source.id) throw new AppError("invalid_selection", "The selection does not belong to this source.");
  assertSupportedMime(input.mimeType);
  if (input.bytes.byteLength === 0) throw new AppError("unreadable_source", "The prepared region is empty.");

  const started = Date.now();
  const result = await provider.extract(input, selection.userHint, signal);
  const draft = buildExtractionDraft({
    source,
    selection,
    input,
    result,
    maxRows: LIMITS.maxExtractedRowsPerRegion,
    maxColumns: LIMITS.maxColumns,
  });
  console.info(
    `[extraction] selection=${selection.id} model=${result.model} prompt=${result.promptVersion} attempts=${result.attempts}` +
      ` rows=${draft.rows.length} cols=${draft.columns.length} coverage=${draft.coverage} issues=${draft.issues.length} elapsedMs=${Date.now() - started}`,
  );
  return draft;
}
