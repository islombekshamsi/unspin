import { AppError, type ExtractionInput } from "@/contracts";
import { classifyProviderError } from "./errors";
import { PROMPT_VERSION, RESPONSE_JSON_SCHEMA, buildSystemInstruction, buildUserPrompt, sanitizeHint } from "./prompt";
import { parseProviderResponse, type ModelExtraction } from "./response";
import type { GeminiRawResult, GeminiTransport, TokenUsage } from "./transport";

export interface GeminiProviderOptions {
  model: string;
  transport: GeminiTransport;
  maxAttempts: number;
  /** Total budget across attempts. */
  timeoutMs: number;
  maxOutputTokens: number;
  maxRows: number;
  maxHintChars: number;
  /** Injectable for tests; defaults to real time. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

export interface ProviderExtraction {
  extraction: ModelExtraction;
  truncated: boolean;
  model: string;
  modelVersion: string | null;
  promptVersion: string;
  requestedAt: string;
  attempts: number;
  elapsedMs: number;
  usage: TokenUsage | null;
}

/** Leave room for one meaningful attempt; a retry with less time left is pointless. */
const MIN_ATTEMPT_MS = 10_000;
const MAX_BACKOFF_MS = 15_000;

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/**
 * The only component that talks to Gemini. Prompt construction, transport,
 * response parsing, and retry policy are separate pieces composed here.
 * Requests are read-only, so repeating one is idempotent.
 */
export class GeminiProvider {
  constructor(private readonly opts: GeminiProviderOptions) {}

  get model(): string {
    return this.opts.model;
  }

  async extract(
    input: Pick<ExtractionInput, "bytes" | "mimeType" | "pixelSize" | "pageHint" | "disclosure">,
    userHint: string | null,
    signal: AbortSignal,
  ): Promise<ProviderExtraction> {
    const now = this.opts.now ?? Date.now;
    const sleep = this.opts.sleep ?? abortableSleep;
    const log = this.opts.log ?? ((line: string) => console.info(line));
    const started = now();
    const requestedAt = new Date(started).toISOString();
    const deadline = started + this.opts.timeoutMs;

    const request = {
      model: this.opts.model,
      systemInstruction: buildSystemInstruction(this.opts.maxRows),
      prompt: buildUserPrompt({
        maxRows: this.opts.maxRows,
        pixelSize: input.pixelSize,
        pageHint: input.pageHint,
        wholeDocument: input.disclosure === "whole_pdf_with_page_hint",
        userHint: sanitizeHint(userHint, this.opts.maxHintChars),
      }),
      media: { mimeType: input.mimeType, base64: toBase64(input.bytes) },
      responseJsonSchema: RESPONSE_JSON_SCHEMA,
      maxOutputTokens: this.opts.maxOutputTokens,
    };

    const maxAttempts = Math.max(1, this.opts.maxAttempts);
    for (let attempt = 1; ; attempt++) {
      if (signal.aborted) throw classifyProviderError(signal.reason, signal, this.opts.model).error;
      const attemptStart = now();
      const remaining = deadline - attemptStart;
      let raw: GeminiRawResult;
      try {
        raw = await this.opts.transport.generate({ ...request, timeoutMs: Math.max(1, remaining) }, signal);
      } catch (e) {
        const c = classifyProviderError(e, signal, this.opts.model);
        log(`[gemini] attempt=${attempt} outcome=error category=${c.category} elapsedMs=${now() - attemptStart}`);
        const wait = Math.min(c.retryAfterMs ?? 1_000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
        const timeLeftAfterWait = deadline - now() - wait;
        const canRetry =
          c.transient &&
          attempt < maxAttempts &&
          timeLeftAfterWait >= MIN_ATTEMPT_MS &&
          (c.retryAfterMs === null || c.retryAfterMs <= MAX_BACKOFF_MS);
        if (!canRetry) throw c.error;
        try {
          await sleep(wait, signal);
        } catch {
          throw classifyProviderError(signal.reason, signal, this.opts.model).error;
        }
        continue;
      }

      const usage = raw.usage;
      log(
        `[gemini] attempt=${attempt} outcome=response finish=${raw.finishReason ?? "none"} elapsedMs=${now() - attemptStart}` +
          ` tokensIn=${usage?.promptTokens ?? "?"} tokensOut=${usage?.outputTokens ?? "?"} tokensThought=${usage?.thoughtTokens ?? "?"}`,
      );
      // Malformed/blocked responses are not transient; the caller may retry explicitly.
      const parsed = parseProviderResponse(raw);
      return {
        extraction: parsed.extraction,
        truncated: parsed.truncated,
        model: this.opts.model,
        modelVersion: raw.modelVersion,
        promptVersion: PROMPT_VERSION,
        requestedAt,
        attempts: attempt,
        elapsedMs: now() - started,
        usage,
      };
    }
  }
}

export function assertSupportedMime(mime: string): void {
  if (!["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(mime)) {
    throw new AppError("unsupported_media_type", "This input type cannot be sent for extraction.");
  }
}
