import { GoogleGenAI } from "@google/genai";

/** One generateContent request, independent of the SDK's types. */
export interface GeminiRequest {
  model: string;
  systemInstruction: string;
  prompt: string;
  media: { mimeType: string; base64: string } | null;
  responseJsonSchema: unknown;
  maxOutputTokens: number;
  /** Per-attempt bound; the caller's signal still cancels earlier. */
  timeoutMs: number;
}

export interface TokenUsage {
  promptTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
  totalTokens: number | null;
}

export interface GeminiRawResult {
  text: string | undefined;
  finishReason: string | null;
  blockReason: string | null;
  usage: TokenUsage | null;
  modelVersion: string | null;
}

/**
 * Network boundary. Production uses SdkTransport; isolated protocol tests inject
 * a stub. A stub transport must never be wired into the application.
 */
export interface GeminiTransport {
  generate(request: GeminiRequest, signal: AbortSignal): Promise<GeminiRawResult>;
}

export class SdkTransport implements GeminiTransport {
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generate(request: GeminiRequest, signal: AbortSignal): Promise<GeminiRawResult> {
    const response = await this.client.models.generateContent({
      model: request.model,
      contents: [
        {
          role: "user",
          parts: request.media
            ? [{ inlineData: { mimeType: request.media.mimeType, data: request.media.base64 } }, { text: request.prompt }]
            : [{ text: request.prompt }],
        },
      ],
      config: {
        systemInstruction: request.systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema: request.responseJsonSchema,
        maxOutputTokens: request.maxOutputTokens,
        candidateCount: 1,
        abortSignal: signal,
        // Retries are owned by GeminiProvider so they stay bounded and visible.
        httpOptions: { timeout: request.timeoutMs },
        // A cut-off answer is reported as such instead of silently re-requested.
        automaticContinuation: false,
      },
    });
    const candidate = response.candidates?.[0];
    const u = response.usageMetadata;
    return {
      text: response.text,
      finishReason: candidate?.finishReason ?? null,
      blockReason: response.promptFeedback?.blockReason ?? null,
      usage: u
        ? {
            promptTokens: u.promptTokenCount ?? null,
            outputTokens: u.candidatesTokenCount ?? null,
            thoughtTokens: u.thoughtsTokenCount ?? null,
            totalTokens: u.totalTokenCount ?? null,
          }
        : null,
      modelVersion: response.modelVersion ?? null,
    };
  }
}
