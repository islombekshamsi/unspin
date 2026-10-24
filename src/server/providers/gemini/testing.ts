import { ApiError } from "@google/genai";
import { GeminiProvider } from "./provider";
import type { GeminiRawResult, GeminiRequest, GeminiTransport } from "./transport";

/**
 * Scripted transport for isolated protocol tests ONLY. It must never be wired
 * into the application or used to produce demo data.
 */
export class ScriptedTransport implements GeminiTransport {
  readonly requests: GeminiRequest[] = [];
  readonly signals: AbortSignal[] = [];
  constructor(private readonly script: Array<GeminiRawResult | Error | ((signal: AbortSignal) => Promise<GeminiRawResult>)>) {}

  get calls(): number {
    return this.requests.length;
  }

  async generate(request: GeminiRequest, signal: AbortSignal): Promise<GeminiRawResult> {
    this.requests.push(request);
    this.signals.push(signal);
    const step = this.script[Math.min(this.requests.length - 1, this.script.length - 1)];
    if (step instanceof Error) throw step;
    if (typeof step === "function") return step(signal);
    return step;
  }
}

export function jsonResult(body: unknown, finishReason = "STOP"): GeminiRawResult {
  return {
    text: typeof body === "string" ? body : JSON.stringify(body),
    finishReason,
    blockReason: null,
    usage: { promptTokens: 1000, outputTokens: 200, thoughtTokens: 0, totalTokens: 1200 },
    modelVersion: "test-model-001",
  };
}

export function apiError(status: number, body: unknown): ApiError {
  return new ApiError({ message: JSON.stringify(body), status });
}

export function testProvider(transport: GeminiTransport, overrides: Partial<ConstructorParameters<typeof GeminiProvider>[0]> = {}) {
  return new GeminiProvider({
    model: "test-model",
    transport,
    maxAttempts: 2,
    timeoutMs: 120_000,
    maxOutputTokens: 32_768,
    maxRows: 250,
    maxHintChars: 300,
    sleep: async () => {},
    log: () => {},
    ...overrides,
  });
}
