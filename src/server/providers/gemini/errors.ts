import { ApiError } from "@google/genai";
import { AppError, isAppError } from "@/contracts";

/**
 * Maps any transport failure to a user-safe AppError. Provider bodies are read
 * only to classify (e.g. per-day quota vs per-minute rate); they are never
 * copied into messages, details, or logs.
 */
export interface ClassifiedError {
  error: AppError;
  /** Whether GeminiProvider may transparently try again within its attempt budget. */
  transient: boolean;
  /** Provider-suggested wait before retrying, when given. */
  retryAfterMs: number | null;
  /** Short category for operational logs. */
  category: string;
}

function statusOf(e: unknown): number | null {
  if (e instanceof ApiError) return e.status;
  if (typeof e === "object" && e !== null && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return null;
}

function bodyOf(e: unknown): string {
  return e instanceof Error ? e.message : "";
}

/** Reads "retryDelay": "23s" from a google.rpc.RetryInfo detail without retaining the body. */
export function parseRetryDelayMs(body: string): number | null {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * 1000);
}

function isAbortLike(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

export function classifyProviderError(e: unknown, callerSignal: AbortSignal, model: string): ClassifiedError {
  if (callerSignal.aborted) {
    const reason: unknown = callerSignal.reason;
    const error = isAppError(reason) ? reason : new AppError("cancelled", "Cancelled at your request.");
    return { error, transient: false, retryAfterMs: null, category: error.code };
  }
  if (isAppError(e)) return { error: e, transient: false, retryAfterMs: null, category: e.code };

  const status = statusOf(e);
  const body = bodyOf(e);

  if (status === 401 || status === 403 || (status === 400 && /API[_ ]KEY[_ ]INVALID|API key not valid|API key expired/i.test(body))) {
    return {
      error: new AppError("not_configured", "The configured Gemini key was rejected. An administrator needs to update the server configuration."),
      transient: false,
      retryAfterMs: null,
      category: "auth",
    };
  }
  if (status === 404) {
    return {
      error: new AppError("not_configured", `The configured Gemini model "${model}" is not available to this key. An administrator needs to update GEMINI_MODEL.`),
      transient: false,
      retryAfterMs: null,
      category: "model_unavailable",
    };
  }
  if (status === 429) {
    const retryAfterMs = parseRetryDelayMs(body);
    const daily = /PerDay|per day|daily|billing|limit:\s*0\b|exceeded your current quota/i.test(body);
    if (daily) {
      return {
        error: new AppError("provider_quota", "The model's usage quota for this server is exhausted. Try again later; nothing was saved.", {
          retryable: true,
        }),
        transient: false,
        retryAfterMs,
        category: "quota",
      };
    }
    return {
      error: new AppError("rate_limited", "The model service is receiving too many requests right now. Wait a minute and retry.", {
        retryable: true,
        details: retryAfterMs !== null ? { retryAfterMs } : undefined,
      }),
      transient: true,
      retryAfterMs,
      category: "rate_limited",
    };
  }
  if (status === 408 || status === 504 || (status === null && isAbortLike(e))) {
    return {
      error: new AppError("timeout", "The model did not answer in time. Try again or select a smaller region.", { retryable: true }),
      transient: true,
      retryAfterMs: null,
      category: "timeout",
    };
  }
  if (status === 499) {
    return { error: new AppError("cancelled", "The request was cancelled."), transient: false, retryAfterMs: null, category: "cancelled" };
  }
  if (status !== null && status >= 500) {
    return {
      error: new AppError("provider_failure", "The model service had a temporary problem. Try again shortly; nothing was saved.", { retryable: true }),
      transient: true,
      retryAfterMs: null,
      category: `http_${status}`,
    };
  }
  if (status !== null && status >= 400) {
    return {
      error: new AppError("provider_failure", "The model service rejected the request. Nothing was saved.", { retryable: false }),
      transient: false,
      retryAfterMs: null,
      category: `http_${status}`,
    };
  }
  // Network-level failures (DNS, reset) carry no status.
  return {
    error: new AppError("provider_failure", "Could not reach the model service. Try again shortly; nothing was saved.", { retryable: true }),
    transient: true,
    retryAfterMs: null,
    category: "network",
  };
}
