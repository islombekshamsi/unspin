import { createHash } from "node:crypto";
import {
  AppError,
  CONTRACT_SCHEMA_VERSION,
  ColumnSchema,
  DatasetSchema,
  ProvenanceSchema,
  RowSchema,
  computeReviewSummary,
  isAppError,
  isStructuredSelection,
  newId,
  type CreateExtractionRequest,
  type Dataset,
  type DatasetVersionSnapshot,
  type HistoryEntry,
  type Job,
  type Owner,
  type ParsedDatasetDraft,
} from "@/contracts";
import { jobsMode } from "@/server/config/env";
import { LIMITS } from "@/server/config/limits";
import { extractCandidate, extractionAvailability } from "@/server/extraction";
import { parseStructuredSelection, prepareExtractionInput } from "@/server/ingestion";
import { computeFindings } from "@/server/quality";
import { getRepositories } from "@/server/storage";
import { getSelection, getSourceBytes } from "./sources";

const now = () => new Date().toISOString();

export async function createExtraction(owner: Owner, req: CreateExtractionRequest): Promise<Job> {
  const repos = getRepositories();
  let selection = await getSelection(owner, req.selectionId);
  if (req.extractionMode && !isStructuredSelection(selection) && req.extractionMode !== (selection.extractionMode ?? "chart_table")) {
    // A separate immutable selection prevents a text-mode run reusing a chart-mode job or dataset.
    const id = `sel_${createHash("sha256").update(`${selection.id}:${req.extractionMode}`).digest("hex").slice(0, 32)}`;
    const existing = await repos.selections.get(owner, id);
    if (existing) selection = existing;
    else {
      selection = { ...selection, id, extractionMode: req.extractionMode, createdAt: now() };
      await repos.selections.create(owner, selection);
    }
  }
  const structured = isStructuredSelection(selection);

  if (!structured) {
    if (!req.consentToExternalProcessing) {
      throw new AppError("consent_required", "Confirm that the selected region may be sent to the external model before extraction.");
    }
    const availability = extractionAvailability();
    if (!availability.configured) {
      throw new AppError("not_configured", availability.reason ?? "Model extraction is not configured on this server.");
    }
  }

  const job: Job = {
    id: newId("job"),
    sourceSelectionId: selection.id,
    operationType: structured ? "structured_parse" : "extraction",
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
    analysis: null,
  };

  const baseKey = `${selection.id}:${CONTRACT_SCHEMA_VERSION}`;
  let { job: stored } = await repos.jobs.createOrGet(owner, job, baseKey);
  if (stored.status === "failed" || stored.status === "cancelled") {
    // A finished unsuccessful attempt does not block an explicit retry.
    ({ job: stored } = await repos.jobs.createOrGet(owner, job, `${baseKey}:retry:${job.id}`));
  }

  if (stored.status === "queued" && jobsMode() === "inline") {
    await runJob(stored.id, null);
    return (await repos.jobs.get(owner, stored.id)) ?? stored;
  }
  return stored;
}

export async function getJob(owner: Owner, jobId: string): Promise<Job> {
  const job = await getRepositories().jobs.get(owner, jobId);
  if (!job) throw new AppError("not_found", "Job not found.");
  return job;
}

export async function cancelJob(owner: Owner, jobId: string): Promise<Job> {
  const job = await getRepositories().jobs.requestCancel(owner, jobId);
  if (!job) throw new AppError("not_found", "Job not found.");
  return job;
}

/**
 * Executes one job attempt. Safe under at-least-once delivery: completion is
 * idempotent per selection (an existing dataset for the selection is reused).
 */
export async function runJob(jobId: string, workerId: string | null): Promise<void> {
  const repos = getRepositories();
  const record = await repos.jobs.getRecord(jobId);
  if (!record) return;
  const owner = record.owner;
  const started = await repos.jobs.transition(jobId, ["queued", "running"], {
    status: "running",
    stage: "preparing_input",
    startedAt: record.job.startedAt ?? now(),
    attemptCount: record.job.attemptCount + 1,
  });
  if (!started) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new AppError("timeout", "The extraction took too long and was stopped.", { retryable: true })), LIMITS.providerTimeoutMs + 5_000);
  const cancelPoll = setInterval(async () => {
    const r = await repos.jobs.getRecord(jobId);
    if (r?.job.cancellationRequested) controller.abort(new AppError("cancelled", "Cancelled at your request."));
    if (workerId) await repos.jobs.heartbeat(jobId, workerId, 30_000);
  }, 1_000);

  try {
    const selection = await getSelection(owner, started.sourceSelectionId);
    const existing = await repos.datasets.findBySelection(owner, selection.id);
    if (existing) {
      await repos.jobs.transition(jobId, ["running"], {
        status: "completed",
        stage: "finished",
        finishedAt: now(),
        resultDatasetId: existing.id,
        error: null,
      });
      return;
    }

    const { source, bytes } = await getSourceBytes(owner, selection.sourceId);
    let draft: ParsedDatasetDraft;
    if (isStructuredSelection(selection)) {
      draft = await parseStructuredSelection(source, bytes, selection);
    } else {
      const input = await prepareExtractionInput(source, bytes, selection);
      throwIfAborted(controller.signal);
      await repos.jobs.transition(jobId, ["running"], { stage: "awaiting_provider" });
      draft = await extractCandidate({ source, selection, input, signal: controller.signal });
    }
    throwIfAborted(controller.signal);
    await repos.jobs.transition(jobId, ["running"], { stage: "validating" });
    validateDraft(draft, isStructuredSelection(selection));

    await repos.jobs.transition(jobId, ["running"], { stage: "committing" });
    throwIfAborted(controller.signal);
    let datasetId = newId("ds");
    const { dataset, snapshot, history } = buildInitialDataset(owner, datasetId, source.id, selection.id, draft);
    try {
      await repos.datasets.create(owner, { dataset, initialSnapshot: snapshot, provenance: draft.provenance, historyEntry: history });
    } catch (e) {
      // Another worker committed this selection first; its dataset is the job's result.
      const winner = isAppError(e) && e.code === "idempotency_conflict" ? e.details?.datasetId : undefined;
      if (typeof winner !== "string") throw e;
      datasetId = winner;
    }

    await repos.jobs.transition(jobId, ["running"], {
      status: "completed",
      stage: "finished",
      finishedAt: now(),
      resultDatasetId: datasetId,
      error: null,
    });
  } catch (e) {
    const reason = controller.signal.aborted ? controller.signal.reason : e;
    const err = isAppError(reason)
      ? reason
      : isAppError(e)
        ? e
        : new AppError("internal", "Processing failed unexpectedly. Nothing was saved.", { retryable: true });
    if (!isAppError(e)) console.error(`[job] ${jobId} internal ${e instanceof Error ? e.name : typeof e}`);
    await repos.jobs.transition(jobId, ["running"], {
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

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new AppError("cancelled", "Cancelled.");
}

/** Structural and referential checks on any draft before it becomes a dataset version. */
export function validateDraft(draft: ParsedDatasetDraft, structured: boolean) {
  const fail = (msg: string) => {
    throw new AppError(structured ? "unreadable_source" : "semantic_validation_failed", msg);
  };
  if (draft.columns.length === 0) throw new AppError("no_data_found", "No columns were found in the selection.");
  if (draft.rows.length === 0) throw new AppError("no_data_found", "No data rows were found in the selection.");
  if (draft.columns.length > LIMITS.maxColumns) {
    throw new AppError("too_many_columns", `The selection has ${draft.columns.length} columns; the limit is ${LIMITS.maxColumns}.`);
  }
  const rowLimit = structured ? LIMITS.maxStructuredRows : LIMITS.maxExtractedRowsPerRegion;
  if (draft.rows.length > rowLimit) {
    throw new AppError("too_many_rows", `The selection has ${draft.rows.length} rows; the limit is ${rowLimit}. Choose a smaller selection.`);
  }
  if (draft.coverage !== "complete_selection" && !draft.coverageNote?.trim()) fail("Partial coverage must explain what was omitted.");

  const columnIds = new Set<string>();
  for (const c of draft.columns) {
    ColumnSchema.parse(c);
    if (columnIds.has(c.id)) fail("Duplicate column id.");
    columnIds.add(c.id);
  }
  const provIds = new Set<string>();
  for (const p of draft.provenance) {
    ProvenanceSchema.parse(p);
    provIds.add(p.id);
  }
  const rowIds = new Set<string>();
  const cellIds = new Set<string>();
  const orders = new Set<number>();
  for (const r of draft.rows) {
    const parsed = RowSchema.safeParse(r);
    if (!parsed.success) fail("A row did not match the dataset schema.");
    if (rowIds.has(r.id) || orders.has(r.sourceOrder)) fail("Duplicate row identity.");
    rowIds.add(r.id);
    orders.add(r.sourceOrder);
    const keys = Object.keys(r.cells);
    if (keys.length !== columnIds.size || keys.some((k) => !columnIds.has(k))) fail("A row does not have exactly one cell per column.");
    for (const cell of Object.values(r.cells)) {
      if (cellIds.has(cell.id)) fail("Duplicate cell id.");
      cellIds.add(cell.id);
      if (cell.provenanceIds.length === 0) fail("Every value needs a source reference.");
      if (cell.provenanceIds.some((id) => !provIds.has(id))) fail("A value references unknown provenance.");
    }
  }
}

export function buildInitialDataset(
  owner: Owner,
  datasetId: string,
  sourceId: string,
  selectionId: string,
  draft: ParsedDatasetDraft,
): { dataset: Dataset; snapshot: DatasetVersionSnapshot; history: HistoryEntry } {
  const versionId = newId("ver");
  const createdAt = now();
  const rows = [...draft.rows].sort((a, b) => a.sourceOrder - b.sourceOrder);
  const dataset: Dataset = DatasetSchema.parse({
    id: datasetId,
    sourceId,
    sourceSelectionId: selectionId,
    title: draft.title.slice(0, 300) || "Untitled dataset",
    description: draft.description.slice(0, 2000),
    createdAt,
    currentVersionId: versionId,
    initialVersionId: versionId,
    extractionMethod: draft.extractionMethod,
    coverage: draft.coverage,
    coverageNote: draft.coverageNote,
    coverageAcknowledgedAt: null,
    extraction: draft.extraction,
    importIssues: draft.issues,
  });
  const snapshot: DatasetVersionSnapshot = {
    version: {
      id: versionId,
      datasetId,
      parentVersionId: null,
      createdAt,
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      columns: draft.columns,
      rowCount: rows.length,
      operationId: null,
      unresolvedFindingCount: 0,
      reviewSummary: computeReviewSummary(rows),
    },
    rows,
  };
  snapshot.version.unresolvedFindingCount = computeFindings(dataset, snapshot).filter((f) => f.severity !== "info").length;
  const history: HistoryEntry = {
    id: newId("op"),
    datasetId,
    kind: "initial",
    baseVersionId: null,
    resultVersionId: versionId,
    operation: null,
    restoredVersionId: null,
    actor: owner.actor,
    createdAt,
    affectedCount: rows.length,
    rowCountBefore: null,
    rowCountAfter: rows.length,
    changedCellIds: [],
    removedRowIds: [],
    summary:
      draft.extractionMethod === "deterministic_parser"
        ? `Imported ${rows.length} rows × ${draft.columns.length} columns with the local parser`
        : `Extracted ${rows.length} candidate rows × ${draft.columns.length} columns (${draft.extractionMethod.replace("_", " ")})`,
  };
  return { dataset, snapshot, history };
}
