import { LIMITS } from "@/server/config/limits";
import { GeminiProvider } from "./provider";
import { SdkTransport, type GeminiTransport } from "./transport";

export { GeminiProvider, assertSupportedMime } from "./provider";
export type { ProviderExtraction } from "./provider";
export { PROMPT_VERSION } from "./prompt";
export type { ModelExtraction, ModelColumn, ModelCell } from "./response";
export type { GeminiTransport, GeminiRequest, GeminiRawResult } from "./transport";

/** Builds the production provider from server configuration. */
export function createGeminiProvider(config: { apiKey: string; model: string }, transport?: GeminiTransport): GeminiProvider {
  return new GeminiProvider({
    model: config.model,
    transport: transport ?? new SdkTransport(config.apiKey),
    maxAttempts: LIMITS.providerMaxAttempts,
    timeoutMs: LIMITS.providerTimeoutMs,
    maxOutputTokens: LIMITS.providerMaxOutputTokens,
    maxRows: LIMITS.maxExtractedRowsPerRegion,
    maxHintChars: LIMITS.maxUserHintChars,
  });
}
