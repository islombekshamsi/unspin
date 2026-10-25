"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalysisConsent, AnalysisRecord, AnalysisScopeKind, DatasetDetail, Job, SelectionEvent } from "@/contracts";
import { Badge, Button, ProgressStatus, TextInput } from "@/components/ui";
import { ApiClientError, api } from "@/lib/api/client";
import type { GridView } from "./seams";

const STAGE_LABEL: Record<Job["stage"], string> = {
  queued: "Queued — waiting for the worker",
  preparing_input: "Preparing computed facts",
  awaiting_provider: "Waiting for Gemini",
  validating: "Checking the response against computed facts",
  committing: "Saving the analysis",
  finished: "Finishing",
};

function jobStorageKey(datasetId: string) {
  return `unspin.analysisJob.${datasetId}`;
}

function consentStorageKey(datasetId: string, versionId: string) {
  return `unspin.analysisConsent.${datasetId}.${versionId}`;
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function readStoredConsent(datasetId: string, versionId: string): AnalysisConsent | null {
  try {
    const raw = sessionStorage.getItem(consentStorageKey(datasetId, versionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnalysisConsent;
    if (typeof parsed?.id !== "string" || parsed.datasetId !== datasetId || parsed.versionId !== versionId) return null;
    return parsed;
  } catch {
    sessionStorage.removeItem(consentStorageKey(datasetId, versionId));
    return null;
  }
}

function renderInsight(template: string, facts: AnalysisRecord["facts"]): string {
  const byId = new Map(facts.map((f) => [f.id, f]));
  return template.replace(/\{\{fact:([A-Za-z0-9_-]+)\}\}/g, (_, id: string) => {
    const f = byId.get(id);
    if (!f) return "—";
    const unit = f.unit ? ` ${f.unit}` : "";
    if (f.value.kind === "integer") return `${f.value.n.toLocaleString()}${unit}`;
    if (f.value.kind === "decimal") return `${f.value.value}${unit}`;
    if (f.value.kind === "coverage") return `${f.value.valid}/${f.value.total}`;
    if (f.value.kind === "pair") return `${f.value.from} → ${f.value.to}`;
    if (f.value.kind === "groups") return f.value.items.map((i) => `${i.label} (${i.n})`).join(", ");
    return "—";
  });
}

export function AnalysisPanel({
  detail,
  view,
  linked,
  suggested,
  geminiConfigured,
  geminiModel,
  onEvidence,
  onShowInData,
  onShowSource,
  selectedQuestion,
  onStatus,
}: {
  detail: DatasetDetail;
  view: GridView | null;
  linked: SelectionEvent | null;
  suggested: string[];
  geminiConfigured: boolean;
  geminiModel: string | null;
  onEvidence: (event: SelectionEvent) => void;
  onShowInData: (event: SelectionEvent) => void;
  onShowSource: (event: SelectionEvent) => void;
  selectedQuestion: string | null;
  onStatus?: (label: string | null) => void;
}) {
  const [consent, setConsent] = useState<AnalysisConsent | null>(() =>
    typeof window === "undefined" ? null : readStoredConsent(detail.dataset.id, detail.dataset.currentVersionId),
  );
  const [busy, setBusy] = useState(() => typeof window !== "undefined" && sessionStorage.getItem(jobStorageKey(detail.dataset.id)) !== null);
  const [busyJob, setBusyJob] = useState<Job | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  const [question, setQuestion] = useState(selectedQuestion ?? "");
  const [seenSeed, setSeenSeed] = useState(selectedQuestion);
  if (selectedQuestion !== seenSeed) {
    setSeenSeed(selectedQuestion);
    if (selectedQuestion) setQuestion(selectedQuestion);
  }
  const consentKey = `${detail.dataset.id}.${detail.dataset.currentVersionId}`;
  const [consentFor, setConsentFor] = useState(consentKey);
  if (consentFor !== consentKey) {
    setConsentFor(consentKey);
    setConsent(readStoredConsent(detail.dataset.id, detail.dataset.currentVersionId));
  }
  const [openCard, setOpenCard] = useState<string | null>(null);
  const followGen = useRef(0);

  const selectedIds = linked?.rowIds ?? [];
  const filteredView = Boolean(view && (view.preset !== "all" || view.search || view.filterText));

  function scopeFor(kind: "overview" | "question"): AnalysisScopeKind {
    if (kind === "question" && selectedIds.length > 0) return "selected_records";
    if (filteredView) return "current_view";
    return "entire_dataset";
  }

  useEffect(() => {
    if (!busyJob && !busy) return;
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [busyJob, busy]);

  useEffect(() => {
    if (busyJob) {
      const elapsed = formatElapsed(nowMs - Date.parse(busyJob.startedAt ?? busyJob.createdAt));
      onStatus?.(`${STAGE_LABEL[busyJob.stage]} · ${elapsed}`);
      return;
    }
    if (busy) {
      onStatus?.("Starting analysis");
      return;
    }
    onStatus?.(null);
  }, [busy, busyJob, nowMs, onStatus]);

  useEffect(() => {
    api.listAnalysis(detail.dataset.id).then(setRecords, () => undefined);
    const stored = sessionStorage.getItem(jobStorageKey(detail.dataset.id));
    if (!stored) return;
    void followJob(stored);
    // Resume an in-flight job after refresh; followJob clears busy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.dataset.id, detail.version.id]);

  async function grant() {
    setBusy(true);
    setError(null);
    try {
      const c = await api.createAnalysisConsent(detail.dataset.id, {
        expectedVersionId: detail.dataset.currentVersionId,
        scopeKind: scopeFor("overview"),
        acknowledged: true,
      });
      setConsent(c);
      sessionStorage.setItem(consentStorageKey(detail.dataset.id, c.versionId), JSON.stringify(c));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not record consent.");
    } finally {
      setBusy(false);
    }
  }

  async function followJob(jobId: string) {
    const gen = ++followGen.current;
    sessionStorage.setItem(jobStorageKey(detail.dataset.id), jobId);
    try {
      for (let i = 0; i < 120; i += 1) {
        if (followGen.current !== gen) return;
        const polled = await api.getJob(jobId);
        if (followGen.current !== gen) return;
        setBusyJob(polled.job);
        if (polled.job.status === "completed") {
          if (!polled.job.resultAnalysisId) {
            setError("Analysis finished without a saved result. The table is unchanged. Generate again to retry.");
            return;
          }
          const rec = await api.getAnalysisRecord(detail.dataset.id, polled.job.resultAnalysisId);
          setRecords((prev) => [rec, ...prev.filter((p) => p.id !== rec.id)]);
          if (rec.versionId !== detail.dataset.currentVersionId) {
            setError("This result is from an older version. Generate again to analyze the current table.");
          }
          return;
        }
        if (polled.job.status === "failed" || polled.job.status === "cancelled") {
          setError(polled.job.error?.message ?? "Analysis did not finish.");
          return;
        }
        await new Promise((r) => setTimeout(r, polled.pollAfterMs ?? 1500));
      }
      setError("Analysis is still running. Refresh to reconnect, or try again shortly.");
    } catch (e) {
      if (followGen.current !== gen) return;
      setError(e instanceof ApiClientError ? e.message : "Could not read analysis status.");
    } finally {
      if (followGen.current === gen) {
        sessionStorage.removeItem(jobStorageKey(detail.dataset.id));
        setBusyJob(null);
        setBusy(false);
      }
    }
  }

  async function run(kind: "overview" | "question", q: string | null) {
    if (!consent) {
      setError("Confirm analysis before sending dataset facts to the model.");
      return;
    }
    if (busy) return;
    const scopeKind = scopeFor(kind);
    setBusy(true);
    setNowMs(Date.now());
    setError(null);
    try {
      const job = await api.createAnalysis(detail.dataset.id, {
        expectedVersionId: detail.dataset.currentVersionId,
        consentId: consent.id,
        kind,
        question: q,
        scope: {
          kind: scopeKind,
          versionId: detail.dataset.currentVersionId,
          view:
            scopeKind === "current_view"
              ? {
                  preset: view?.preset ?? "all",
                  search: view?.search ?? null,
                  filterColumnId: view?.filterColumnId ?? null,
                  filterText: view?.filterText ?? null,
                  sort: { columnId: view?.sortColumnId ?? null, direction: view?.sortDirection ?? "asc" },
                  columnIds: view?.columnIds ?? null,
                }
              : null,
          rowIds: scopeKind === "selected_records" ? selectedIds : null,
        },
      });
      setBusyJob(job);
      if (job.status === "queued" || job.status === "running") {
        await followJob(job.id);
        return;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        setError(job.error?.message ?? "Analysis did not finish.");
        return;
      }
      if (job.status === "completed" && !job.resultAnalysisId) {
        setError("Analysis finished without a saved result. Generate again to retry.");
        return;
      }
      if (job.resultAnalysisId) {
        const rec = await api.getAnalysisRecord(detail.dataset.id, job.resultAnalysisId);
        setRecords((prev) => [rec, ...prev.filter((p) => p.id !== rec.id)]);
      }
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Analysis failed.");
    } finally {
      if (!sessionStorage.getItem(jobStorageKey(detail.dataset.id))) {
        setBusy(false);
        setBusyJob(null);
      }
    }
  }

  async function cancel() {
    if (!busyJob) return;
    try {
      const job = await api.cancelJob(busyJob.id);
      setBusyJob(job);
      if (job.status === "cancelled" || job.status === "failed") {
        setError(job.error?.message ?? "Analysis did not finish.");
        followGen.current += 1;
        sessionStorage.removeItem(jobStorageKey(detail.dataset.id));
        setBusy(false);
        setBusyJob(null);
      }
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not request cancellation.");
    }
  }

  const latest = records[0] ?? null;
  const questionScope = scopeFor("question");
  const scopeLabel =
    questionScope === "selected_records"
      ? `Questions: selected records (${selectedIds.length})`
      : questionScope === "current_view"
        ? "Current filtered view"
        : "Entire dataset";
  const elapsedMs = busyJob ? nowMs - Date.parse(busyJob.startedAt ?? busyJob.createdAt) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{scopeLabel}</Badge>
        {latest && (
          <span className="text-[12px] text-ink-muted">
            {latest.kind === "question" && latest.question ? `Answer to “${latest.question}”` : "AI overview"} · {latest.model} · {new Date(latest.createdAt).toLocaleString()}
          </span>
        )}
        {latest?.stale && (
          <>
            <Badge tone="estimate">From an older version</Badge>
            {consent && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("overview", null)}>
                Update analysis
              </Button>
            )}
          </>
        )}
      </div>
      {!geminiConfigured && (
        <p className="text-[14px] text-ink-muted">AI analysis is not configured on this server. The table, chart, and computed facts above still work.</p>
      )}
      {geminiConfigured && !consent && (
        <div className="max-w-3xl text-[14px] leading-6 text-ink-muted">
          <p>
            Analyze this dataset sends computed facts — not the whole spreadsheet file — to Google Gemini
            {geminiModel ? ` (${geminiModel})` : ""}. Import and cleaning stay on this server. Unpaid keys may allow Google to use submitted content to
            improve its products. Cancel keeps every core action working.
          </p>
          <Button className="mt-3" variant="primary" disabled={busy} onClick={() => void grant()}>
            Analyze this dataset
          </Button>
        </div>
      )}
      {consent && (
        <div className="flex max-w-3xl flex-col items-stretch gap-3">
          <Button className="self-start" disabled={busy} onClick={() => void run("overview", null)}>
            {latest ? "Generate a new AI overview" : "Generate AI overview"}
          </Button>
          <label className="text-[13px] font-medium text-ink" htmlFor="ask-data">
            Ask about this data
          </label>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && question.trim()) void run("question", question.trim());
            }}
          >
            <TextInput id="ask-data" className="h-10 flex-1" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="Compare, find a change, or ask what is missing" />
            <Button type="submit" className="h-10" disabled={busy || !question.trim()}>
              Ask
            </Button>
          </form>
          {suggested.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggested.map((s) => (
                <Button key={s} size="sm" variant="secondary" className="h-auto! min-h-8 max-w-full py-1 text-left whitespace-normal!" disabled={busy} onClick={() => { setQuestion(s); void run("question", s); }}>
                  {s}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
      {(busy || busyJob) && (
        <div className="flex flex-col gap-2">
          <ProgressStatus
            label={busyJob ? STAGE_LABEL[busyJob.stage] : "Starting analysis"}
            detail={
              busyJob
                ? `${formatElapsed(elapsedMs)} elapsed${busyJob.status === "queued" ? ". The table and chart stay usable." : ""}`
                : "The table and chart stay usable."
            }
            measured={busyJob?.measuredProgress ?? null}
          />
          {busyJob && busyJob.status !== "completed" && busyJob.status !== "failed" && busyJob.status !== "cancelled" && (
            <Button size="sm" variant="danger" className="self-start" onClick={() => void cancel()}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="text-[14px] text-danger" role="alert">
          {error}
        </p>
      )}
      {consent && !latest && !busy && !error && (
        <p className="text-[14px] text-ink-muted">
          Nothing generated yet. Generate an overview or ask a question.
        </p>
      )}
      {latest && (
        <ul className="grid gap-4 md:grid-cols-2">
          {latest.insights.map((card) => {
            const body = renderInsight(card.template, latest.facts);
            const open = openCard === card.title;
            const fact = latest.facts.find((f) => card.factIds.includes(f.id) && (f.evidence.rowIds.length > 0 || f.evidence.cellIds.length > 0));
            const event: SelectionEvent | null = fact
              ? { origin: "quality", datasetVersionId: latest.versionId, rowIds: fact.evidence.rowIds, cellIds: fact.evidence.cellIds, provenanceIds: [] }
              : null;
            return (
              <li key={card.title} className="flex flex-col gap-3 rounded-xl border border-rule bg-surface px-5 py-4">
                <button
                  type="button"
                  className="flex flex-col gap-1 rounded-sm text-left"
                  aria-expanded={open}
                  onClick={() => {
                    setOpenCard(open ? null : card.title);
                    if (event) onEvidence(event);
                  }}
                >
                  <span className="text-[12px] tracking-wide text-ink-faint uppercase">{card.type.replace("_", " ")}</span>
                  <span className="text-[15px] font-semibold text-ink">{card.title}</span>
                  <span className="text-[14px] leading-6 text-ink-muted">{body}</span>
                </button>
                {open && (card.limitations.length > 0 || card.followUps.length > 0) && (
                  <ul className="flex flex-col gap-1.5 rounded-lg bg-sunken px-3 py-2 text-[13px] text-ink-muted">
                    {card.limitations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                    {card.followUps.map((f) => (
                      <li key={f}>
                        <button type="button" className="text-left text-accent underline" onClick={() => setQuestion(f)}>
                          {f}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-auto flex flex-wrap gap-2">
                  {event && (
                    <>
                      <Button size="sm" onClick={() => onShowInData(event)}>
                        Show in data
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onShowSource(event)}>
                        Show source
                      </Button>
                    </>
                  )}
                  {(card.limitations.length > 0 || card.followUps.length > 0) && (
                    <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpenCard(open ? null : card.title)}>
                      {open ? "Hide details" : "Details"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
