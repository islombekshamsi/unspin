import { AppError, ModelInsightResponseSchema, type AnalysisFact, type InsightCard, type ModelInsightResponse } from "@/contracts";

const FACT_SLOT = /\{\{fact:([A-Za-z0-9_-]+)\}\}/g;
const NUMBERISH = /(?:\d+\.\d+|\d{3,}|\b\d+\b)/;

export function parseModelInsights(raw: string): ModelInsightResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("invalid_provider_response", "The model did not return valid JSON. No analysis was saved.");
  }
  const result = ModelInsightResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError("invalid_provider_response", "The model response did not match the analysis contract. No analysis was saved.");
  }
  return result.data;
}

/**
 * Every {{fact:id}} must exist. Quantitative tokens in the template that are not
 * placeholders are rejected. Direction words must be supported by referenced pair/min/max facts.
 */
export function validateInsights(insights: InsightCard[], facts: AnalysisFact[]): InsightCard[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const out: InsightCard[] = [];
  for (const card of insights) {
    const slotIds = [...card.template.matchAll(FACT_SLOT)].map((m) => m[1]);
    if (slotIds.some((id) => !byId.has(id))) continue;
    const factIds = [...new Set([...card.factIds.filter((id) => byId.has(id)), ...slotIds])].slice(0, 8);
    if (factIds.length === 0) continue;
    const stripped = card.template.replace(FACT_SLOT, " ");
    const referenced = factIds.map((id) => byId.get(id)!);
    if (NUMBERISH.test(stripped) && !numericTokensMatchFacts(stripped, referenced)) continue;
    if (!directionSupported(card.template, facts)) continue;
    out.push({ ...card, factIds });
    if (out.length >= 5) break;
  }
  if (out.length === 0) {
    console.warn(
      "[analysis] dropped all insights",
      insights.map((c) => ({ title: c.title, template: c.template, factIds: c.factIds })),
    );
    throw new AppError("semantic_validation_failed", "The model did not ground its claims in the computed facts. No analysis was saved.");
  }
  return out;
}

function catalogNumericTokens(facts: AnalysisFact[]): Set<string> {
  const allowed = new Set<string>();
  for (const f of facts) {
    switch (f.value.kind) {
      case "integer":
        allowed.add(String(f.value.n));
        break;
      case "decimal":
        allowed.add(f.value.value);
        break;
      case "coverage":
        allowed.add(String(f.value.valid));
        allowed.add(String(f.value.missing));
        allowed.add(String(f.value.total));
        break;
      case "pair":
        allowed.add(f.value.from);
        allowed.add(f.value.to);
        allowed.add(f.value.delta);
        allowed.add(f.value.delta.replace(/^\+/, ""));
        break;
      case "groups":
        for (const item of f.value.items) allowed.add(String(item.n));
        break;
    }
  }
  return allowed;
}

function numericTokensMatchFacts(stripped: string, facts: AnalysisFact[]): boolean {
  const tokens = stripped.match(/\d+\.\d+|\d{3,}|\b\d+\b/g) ?? [];
  if (tokens.length === 0) return true;
  const allowed = catalogNumericTokens(facts);
  return tokens.every((t) => allowed.has(t));
}

function directionSupported(template: string, facts: AnalysisFact[]): boolean {
  const t = template.toLowerCase();
  const wantsUp = /\b(increas|rose|grew|higher|upward)\b/.test(t);
  const wantsDown = /\b(decreas|fell|drop|lower|declin)\b/.test(t);
  if (!wantsUp && !wantsDown) return true;
  for (const f of facts) {
    if (f.value.kind !== "pair") continue;
    const delta = Number(f.value.delta);
    if (!Number.isFinite(delta)) continue;
    if (wantsUp && delta > 0) return true;
    if (wantsDown && delta < 0) return true;
  }
  return false;
}

export function renderInsight(template: string, facts: AnalysisFact[]): string {
  const byId = new Map(facts.map((f) => [f.id, f]));
  return template.replace(FACT_SLOT, (_, id: string) => {
    const f = byId.get(id);
    if (!f) return "[missing fact]";
    return formatFact(f);
  });
}

export function formatFact(f: AnalysisFact): string {
  const unit = f.unit ? ` ${f.unit}` : "";
  switch (f.value.kind) {
    case "integer":
      return `${f.value.n.toLocaleString()}${unit}`;
    case "decimal":
      return `${f.value.value}${unit}`;
    case "coverage":
      return `${f.value.valid.toLocaleString()} of ${f.value.total.toLocaleString()} present (${f.value.missing.toLocaleString()} missing)`;
    case "pair":
      return `${f.value.from} → ${f.value.to} (${f.value.delta.startsWith("-") ? "" : "+"}${f.value.delta}${unit})`;
    case "groups":
      return f.value.items.map((i) => `${i.label}: ${i.n}`).join("; ");
  }
}
