import { z } from "zod";
import { DecimalStringSchema, IdSchema, IsoDateTimeSchema } from "./common";
import { ViewSpecSchema } from "./view";

export const ANALYSIS_PROMPT_VERSION = "analysis-overview-v1" as const;
export const ANALYSIS_CONTRACT_VERSION = "unspin.analysis/1" as const;

export const AnalysisScopeKindSchema = z.enum(["entire_dataset", "current_view", "selected_records"]);
export type AnalysisScopeKind = z.infer<typeof AnalysisScopeKindSchema>;

export const AnalysisScopeSchema = z
  .object({
    kind: AnalysisScopeKindSchema,
    versionId: IdSchema,
    view: ViewSpecSchema.nullable(),
    rowIds: z.array(IdSchema).max(200).nullable(),
  })
  .superRefine((s, ctx) => {
    if (s.kind === "selected_records" && (!s.rowIds || s.rowIds.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "selected_records requires rowIds." });
    }
    if (s.kind === "current_view" && s.view === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "current_view requires a view spec." });
    }
  });
export type AnalysisScope = z.infer<typeof AnalysisScopeSchema>;

export const FactOperationSchema = z.enum([
  "count",
  "missing_coverage",
  "min",
  "max",
  "mean",
  "median",
  "first",
  "last",
  "adjacent_change",
  "group_counts",
]);
export type FactOperation = z.infer<typeof FactOperationSchema>;

export const FactEvidenceSchema = z.object({
  kind: z.enum(["rows", "query"]),
  rowIds: z.array(IdSchema).max(50),
  cellIds: z.array(IdSchema).max(50),
  count: z.number().int().nonnegative(),
});
export type FactEvidence = z.infer<typeof FactEvidenceSchema>;

export const FactValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("integer"), n: z.number().int() }),
  z.object({ kind: z.literal("decimal"), value: DecimalStringSchema }),
  z.object({
    kind: z.literal("coverage"),
    valid: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("pair"),
    from: DecimalStringSchema,
    to: DecimalStringSchema,
    delta: DecimalStringSchema,
  }),
  z.object({
    kind: z.literal("groups"),
    items: z.array(z.object({ label: z.string().max(300), n: z.number().int().nonnegative() })).max(20),
  }),
]);
export type FactValue = z.infer<typeof FactValueSchema>;

export const AnalysisFactSchema = z.object({
  id: IdSchema,
  versionId: IdSchema,
  operation: FactOperationSchema,
  columnId: IdSchema.nullable(),
  columnLabel: z.string().max(300).nullable(),
  unit: z.string().max(64).nullable(),
  value: FactValueSchema,
  evidence: FactEvidenceSchema,
  limitations: z.array(z.string().max(400)).max(8),
});
export type AnalysisFact = z.infer<typeof AnalysisFactSchema>;

export const InsightTypeSchema = z.enum(["contains", "trend", "quality", "next_inspection"]);
export type InsightType = z.infer<typeof InsightTypeSchema>;

/** Explanation is a template; every {{fact:id}} slot is replaced from the catalog at render time. */
export const InsightCardSchema = z.object({
  type: InsightTypeSchema,
  title: z.string().min(1).max(80),
  template: z.string().min(1).max(600),
  factIds: z.array(IdSchema).min(1).max(8),
  limitations: z.array(z.string().max(400)).max(6),
  followUps: z.array(z.string().max(160)).max(4),
});
export type InsightCard = z.infer<typeof InsightCardSchema>;

export const ModelInsightResponseSchema = z.object({
  contractVersion: z.literal(ANALYSIS_CONTRACT_VERSION),
  insights: z.array(InsightCardSchema).min(1).max(5),
  unusedFactIds: z.array(IdSchema).max(32).optional(),
});
export type ModelInsightResponse = z.infer<typeof ModelInsightResponseSchema>;

export const AnalysisKindSchema = z.enum(["overview", "question"]);
export type AnalysisKind = z.infer<typeof AnalysisKindSchema>;

export const AnalysisRecordSchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  versionId: IdSchema,
  kind: AnalysisKindSchema,
  question: z.string().max(500).nullable(),
  scope: AnalysisScopeSchema,
  facts: z.array(AnalysisFactSchema).max(80),
  insights: z.array(InsightCardSchema).max(5),
  model: z.string().max(80),
  promptVersion: z.string().max(64),
  createdAt: IsoDateTimeSchema,
  stale: z.boolean(),
});
export type AnalysisRecord = z.infer<typeof AnalysisRecordSchema>;

export const AnalysisConsentSchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  versionId: IdSchema,
  scopeKind: AnalysisScopeKindSchema,
  grantedAt: IsoDateTimeSchema,
  model: z.string().max(80),
  disclosure: z.string().max(2000),
});
export type AnalysisConsent = z.infer<typeof AnalysisConsentSchema>;

export const CreateAnalysisConsentRequestSchema = z.object({
  expectedVersionId: IdSchema,
  scopeKind: AnalysisScopeKindSchema,
  acknowledged: z.literal(true),
});
export type CreateAnalysisConsentRequest = z.infer<typeof CreateAnalysisConsentRequestSchema>;

export const CreateAnalysisRequestSchema = z.object({
  expectedVersionId: IdSchema,
  consentId: IdSchema,
  kind: AnalysisKindSchema,
  question: z.string().min(1).max(500).nullable(),
  scope: AnalysisScopeSchema,
});
export type CreateAnalysisRequest = z.infer<typeof CreateAnalysisRequestSchema>;

export const DatasetProfileKindSchema = z.enum(["time_series", "categorical", "tabular", "insufficient"]);
export type DatasetProfileKind = z.infer<typeof DatasetProfileKindSchema>;

export const ProfileHighlightSchema = z.object({
  title: z.string().max(80),
  body: z.string().max(400),
  factIds: z.array(IdSchema).max(6),
});
export type ProfileHighlight = z.infer<typeof ProfileHighlightSchema>;

export const DatasetOverviewSchema = z.object({
  versionId: IdSchema,
  kind: DatasetProfileKindSchema,
  highlights: z.array(ProfileHighlightSchema).max(6),
  facts: z.array(AnalysisFactSchema).max(80),
  presetCounts: z.array(z.object({ preset: z.enum(["all", "needs_review", "estimated", "edited"]), rowCount: z.number().int().nonnegative() })),
  suggestedQuestions: z.array(z.string().max(160)).max(6),
  notes: z.array(z.string().max(400)).max(8),
});
export type DatasetOverview = z.infer<typeof DatasetOverviewSchema>;
