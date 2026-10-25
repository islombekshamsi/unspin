import { ANALYSIS_CONTRACT_VERSION, ANALYSIS_PROMPT_VERSION, AppError, type AnalysisFact, type AnalysisKind } from "@/contracts";
import type { GeminiRawResult } from "@/server/providers/gemini/transport";
import { geminiEnv } from "@/server/config/env";
import { LIMITS } from "@/server/config/limits";
import { SdkTransport } from "@/server/providers/gemini/transport";
import { formatFact } from "./validate";

const SYSTEM = `You write short grounded descriptions of a table from a computed fact catalog.
You may only refer to facts by {{fact:ID}} placeholders. Never invent numbers, dates, series names, or causes.
Do not treat estimates as verified measurements. If a fact limitation says values are estimated, keep that next to the claim.
Do not mention marketing, policy, disease, or news events. If the catalog cannot support a cause, say the dataset cannot establish it.
Return JSON only.`;

export async function generateInsights(args: {
  kind: AnalysisKind;
  question: string | null;
  facts: AnalysisFact[];
  extractionMethod: string;
  coverage: string;
  signal: AbortSignal;
}): Promise<{ text: string; model: string }> {
  const env = geminiEnv();
  if (!env) throw new AppError("not_configured", "Model analysis is not configured on this server.");
  const catalog = args.facts.map((f) => ({
    id: f.id,
    operation: f.operation,
    column: f.columnLabel,
    unit: f.unit,
    value: f.value,
    display: formatFact(f),
    limitations: f.limitations,
  }));
  const prompt = [
    `Contract version: ${ANALYSIS_CONTRACT_VERSION}`,
    `Prompt version: ${ANALYSIS_PROMPT_VERSION}`,
    `Dataset extraction method: ${args.extractionMethod} (estimated means chart-read, not a publisher file).`,
    `Coverage: ${args.coverage}`,
    `Task: ${args.kind === "question" ? `Answer this question using only the catalog: ${args.question}` : "Write 3-5 insight cards about what this catalog supports."}`,
    "Each insight.template may only include numbers via {{fact:ID}} slots. Copy those IDs exactly from the catalog.",
    "Do not write any digit (0-9) outside a {{fact:ID}} placeholder. Do not paste values from limitations; cite the fact instead.",
    "JSON shape: { contractVersion, insights: [{ type, title, template, factIds, limitations, followUps }] }",
    "type is one of contains, trend, quality, next_inspection.",
    "Fact catalog:",
    JSON.stringify(catalog),
  ].join("\n");

  const transport = new SdkTransport(env.apiKey);
  const result: GeminiRawResult = await transport.generate(
    {
      model: env.model,
      systemInstruction: SYSTEM,
      prompt,
      media: null,
      responseJsonSchema: {
        type: "object",
        properties: {
          contractVersion: { type: "string" },
          insights: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                title: { type: "string" },
                template: { type: "string" },
                factIds: { type: "array", items: { type: "string" } },
                limitations: { type: "array", items: { type: "string" } },
                followUps: { type: "array", items: { type: "string" } },
              },
              required: ["type", "title", "template", "factIds", "limitations", "followUps"],
            },
          },
        },
        required: ["contractVersion", "insights"],
      },
      maxOutputTokens: 4096,
      timeoutMs: LIMITS.providerTimeoutMs,
    },
    args.signal,
  );
  if (!result.text) {
    throw new AppError("provider_failure", "The model returned an empty analysis.", { retryable: true });
  }
  return { text: result.text, model: env.model };
}
