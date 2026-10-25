import {
  ANALYSIS_PROMPT_VERSION,
  AppError,
  isAppError,
  newId,
  type AnalysisConsent,
  type AnalysisRecord,
  type CreateAnalysisConsentRequest,
  type CreateAnalysisRequest,
  type Job,
  type Owner,
} from "@/contracts";
import { LIMITS } from "@/server/config/limits";
import { generateInsights } from "@/server/analysis/generate";
import { buildOverview } from "@/server/analysis/profile";
import { parseModelInsights, validateInsights } from "@/server/analysis/validate";
import { applyView, defaultViewSpec } from "@/server/analysis/view-match";
import { geminiEnv, jobsMode } from "@/server/config/env";
import { getRepositories } from "@/server/storage";
import { requireDataset, requireVersion } from "./datasets";

const now = () => new Date().toISOString();

export function analysisDisclosure(model: string): string {
  return `Optional analysis sends column labels, computed facts (counts, ranges, coverage), and any records named in those facts to Google Gemini (${model}). Spreadsheet bytes stay on this server. Chart/PDF extraction consent is separate. If this server uses an unpaid Gemini key, Google’s terms may allow submitted content to be used to improve its products. Analysis does not edit your table.`;
}

export async function createAnalysisConsent(owner: Owner, datasetId: string, req: CreateAnalysisConsentRequest): Promise<AnalysisConsent> {
  const dataset = await requireDataset(owner, datasetId);
  if (dataset.currentVersionId !== req.expectedVersionId) {
    throw new AppError("version_conflict", "The dataset changed since you loaded it. Reload the latest version and try again.", {
      details: { currentVersionId: dataset.currentVersionId },
    });
  }
  const env = geminiEnv();
  if (!env) throw new AppError("not_configured", "Model analysis is not configured on this server.");
  const consent: AnalysisConsent = {
    id: newId("cns"),
    datasetId,
    versionId: req.expectedVersionId,
    scopeKind: req.scopeKind,
    grantedAt: now(),
    model: env.model,
    disclosure: analysisDisclosure(env.model),
  };
  await getRepositories().analysis.putConsent(owner, consent);
  return consent;
}

export async function listAnalysis(owner: Owner, datasetId: string): Promise<AnalysisRecord[]> {
  const dataset = await requireDataset(owner, datasetId);
  const rows = await getRepositories().analysis.list(owner, datasetId);
  return rows.map((r) => ({ ...r, stale: r.versionId !== dataset.currentVersionId }));
}

export async function getAnalysis(owner: Owner, datasetId: string, analysisId: string): Promise<AnalysisRecord> {
  const dataset = await requireDataset(owner, datasetId);
  const rec = await getRepositories().analysis.get(owner, datasetId, analysisId);
  if (!rec) throw new AppError("not_found", "Analysis not found.");
  return { ...rec, stale: rec.versionId !== dataset.currentVersionId };
}

export async function createAnalysisJob(owner: Owner, datasetId: string, req: CreateAnalysisRequest): Promise<Job> {
  const dataset = await requireDataset(owner, datasetId);
  if (dataset.currentVersionId !== req.expectedVersionId) {
    throw new AppError("version_conflict", "The dataset changed since you loaded it. Reload the latest version and try again.", {
      details: { currentVersionId: dataset.currentVersionId },
    });
  }
  if (req.scope.versionId !== req.expectedVersionId) {
    throw new AppError("bad_request", "Analysis scope version must match the current dataset version.");
  }
  if (req.kind === "question" && !(req.question ?? "").trim()) {
    throw new AppError("bad_request", "A question is required.");
  }
  const consent = await getRepositories().analysis.getConsent(owner, req.consentId);
  if (!consent || consent.datasetId !== datasetId) {
    throw new AppError("consent_required", "Confirm analysis before sending dataset facts to the model.");
  }
  if (consent.versionId !== dataset.currentVersionId) {
    throw new AppError("consent_required", "The data changed after you consented. Review the new scope and confirm again.");
  }
  const repos = getRepositories();
  const cached = (await repos.analysis.list(owner, datasetId)).find(
    (r) =>
      r.versionId === dataset.currentVersionId &&
      r.kind === req.kind &&
      (r.question ?? "") === (req.question ?? "") &&
      JSON.stringify(r.scope) === JSON.stringify(req.scope) &&
      r.promptVersion === ANALYSIS_PROMPT_VERSION,
  );
  if (cached) {
    return {
      id: newId("job"),
      sourceSelectionId: dataset.sourceSelectionId,
      operationType: "analysis",
      status: "completed",
      stage: "finished",
      cancellationRequested: false,
      createdAt: cached.createdAt,
      startedAt: cached.createdAt,
      finishedAt: cached.createdAt,
      attemptCount: 0,
      measuredProgress: null,
      error: null,
      resultDatasetId: null,
      resultAnalysisId: cached.id,
      analysis: { datasetId, request: req },
    };
  }
  const env = geminiEnv();
  if (!env) throw new AppError("not_configured", "Model analysis is not configured on this server.");

  const job: Job = {
    id: newId("job"),
    sourceSelectionId: dataset.sourceSelectionId,
    operationType: "analysis",
    status: "queued",
    stage: "queued",
    cancellationRequested: false,
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
    attemptCount: 0,
    measuredProgress: null,
    error: null,
    resultDatasetId: null,
    resultAnalysisId: null,
    analysis: { datasetId, request: req },
  };
  const key = `analysis:${datasetId}:${req.kind}:${req.question ?? ""}:${JSON.stringify(req.scope)}:${ANALYSIS_PROMPT_VERSION}`;
  let { job: stored } = await repos.jobs.createOrGet(owner, job, key);
  if (stored.status === "failed" || stored.status === "cancelled" || (stored.status === "completed" && !stored.resultAnalysisId)) {
    ({ job: stored } = await repos.jobs.createOrGet(owner, job, `${key}:retry:${job.id}`));
  }
  if (stored.status === "queued" && jobsMode() === "inline") {
    await runAnalysisJob(stored.id);
    return (await repos.jobs.get(owner, stored.id)) ?? stored;
  }
  return stored;
}

export async function runAnalysisJob(jobId: string): Promise<void> {
  const repos = getRepositories();
  const rec = await repos.jobs.getRecord(jobId);
  if (!rec || rec.job.operationType !== "analysis") return;
  const payload = rec.job.analysis;
  const started = await repos.jobs.transition(jobId, ["queued", "running"], {
    status: "running",
    stage: "preparing_input",
    startedAt: rec.job.startedAt ?? now(),
    attemptCount: rec.job.attemptCount + 1,
  });
  if (!started) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new AppError("timeout", "The analysis took too long and was stopped. Your table is unchanged.", { retryable: true }),
    );
  }, LIMITS.providerTimeoutMs);
  const cancelPoll = setInterval(() => {
    void repos.jobs.getRecord(jobId).then((r) => {
      if (r?.job.cancellationRequested) controller.abort(new AppError("cancelled", "Cancelled at your request."));
    });
  }, 1_000);
  try {
    if (!payload) throw new AppError("internal", "Analysis request was missing from the job.");
    const dataset = await requireDataset(rec.owner, payload.datasetId);
    const snapshot = await requireVersion(rec.owner, payload.datasetId, payload.request.expectedVersionId);
    const spec = payload.request.scope.kind === "current_view" ? (payload.request.scope.view ?? defaultViewSpec()) : defaultViewSpec();
    let rows = applyView(snapshot.rows, spec);
    if (payload.request.scope.kind === "selected_records" && payload.request.scope.rowIds) {
      const wanted = new Set(payload.request.scope.rowIds);
      rows = snapshot.rows.filter((r) => wanted.has(r.id));
    }
    await repos.jobs.transition(jobId, ["running"], { stage: "awaiting_provider" });
    const overview = buildOverview(snapshot, rows);
    const generated = await generateInsights({
      kind: payload.request.kind,
      question: payload.request.question,
      facts: overview.facts,
      extractionMethod: dataset.extractionMethod,
      coverage: dataset.coverage,
      signal: controller.signal,
    });
    await repos.jobs.transition(jobId, ["running"], { stage: "validating" });
    const parsed = parseModelInsights(generated.text);
    const insights = validateInsights(parsed.insights, overview.facts);
    const record: AnalysisRecord = {
      id: newId("anl"),
      datasetId: payload.datasetId,
      versionId: snapshot.version.id,
      kind: payload.request.kind,
      question: payload.request.question,
      scope: payload.request.scope,
      facts: overview.facts,
      insights,
      model: generated.model,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      createdAt: now(),
      stale: false,
    };
    await repos.jobs.transition(jobId, ["running"], { stage: "committing" });
    await repos.analysis.create(rec.owner, record);
    await repos.jobs.transition(jobId, ["running"], {
      status: "completed",
      stage: "finished",
      finishedAt: now(),
      resultAnalysisId: record.id,
    });
  } catch (e) {
    const reason = controller.signal.aborted ? controller.signal.reason : e;
    const err = isAppError(reason)
      ? reason
      : isAppError(e)
        ? e
        : new AppError("provider_failure", "The model request did not finish. Your table is unchanged.", { retryable: true });
    if (!isAppError(e) && !isAppError(reason)) {
      console.error("[analysis] unexpected failure", e instanceof Error ? e.message : e);
    }
    await repos.jobs.transition(jobId, ["running", "queued"], {
      status: err.code === "cancelled" ? "cancelled" : "failed",
      stage: "finished",
      finishedAt: now(),
      error: { code: err.code, message: err.message, retryable: err.retryable },
    });
  } finally {
    clearTimeout(timeout);
    clearInterval(cancelPoll);
  }
}
