"use client";

import { useEffect, useId, useState } from "react";
import { isStructuredSelection } from "@/contracts";
import { Button, Select, Disclosure, ErrorState, Panel, ProgressStatus, UnavailableNote } from "@/components/ui";
import type { ExtractionLauncherProps } from "@/features/workspace/seams";
import { describeSentInput, describeStructuredSelection, errorView, formatElapsed, stageLabel } from "../lib/presentation";
import { useExtractionRun, type RunState } from "../lib/useExtractionRun";

/** Wall-clock time since startedAt, ticking once per second; read only from timer callbacks. */
function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt === null || now === null ? 0 : Math.max(0, now - startedAt);
}

function startedAtOf(state: RunState): number | null {
  return state.phase === "submitting" || state.phase === "tracking" ? state.startedAt : null;
}

export function ExtractionLauncher({ source, selection, gemini, onDatasetReady, onBackToSelection }: ExtractionLauncherProps) {
  const structured = isStructuredSelection(selection);
  const [extractionMode, setExtractionMode] = useState<"chart_table" | "text">("chart_table");
  const run = useExtractionRun(selection.id, onDatasetReady, extractionMode);
  const elapsed = useElapsed(startedAtOf(run.state));
  const [consent, setConsent] = useState(false);
  const consentId = useId();
  const { state } = run;
  const busy = state.phase === "submitting" || state.phase === "tracking" || state.phase === "done";

  const progress = (() => {
    if (state.phase === "submitting") {
      return (
        <ProgressStatus
          label={structured ? "Importing the selection" : "Processing the selected region"}
          detail={`${formatElapsed(elapsed)} elapsed · ${structured ? "Parsing on this server." : "Model response time varies; there is no fixed duration."}`}
        />
      );
    }
    if (state.phase === "tracking") {
      return (
        <ProgressStatus
          label={state.cancelRequested ? "Cancellation requested" : stageLabel(state.job)}
          detail={`${formatElapsed(elapsed)} elapsed${state.job.attemptCount > 1 ? ` · attempt ${state.job.attemptCount}` : ""}`}
          measured={state.job.measuredProgress}
        />
      );
    }
    if (state.phase === "done") return <ProgressStatus label="Opening the dataset" />;
    return null;
  })();

  const runControls =
    state.phase === "submitting" ? (
      <div className="flex flex-col gap-1">
        <Button size="sm" onClick={run.stopWaiting} className="self-start">
          Stop waiting
        </Button>
        <p className="text-[12px] text-ink-faint">
          The server keeps working on a request it has started. Starting again later reuses that request instead of sending a new one.
        </p>
      </div>
    ) : state.phase === "tracking" ? (
      <div className="flex flex-col gap-1">
        <Button size="sm" variant="danger" onClick={() => void run.cancel()} disabled={state.cancelRequested} className="self-start">
          {state.cancelRequested ? "Cancellation requested" : "Cancel"}
        </Button>
        {state.cancelRequested && (
          <p className="text-[12px] text-ink-muted" role="status">
            Cancellation requested. A request already sent to the model may still complete upstream; nothing is saved unless processing finishes first.
          </p>
        )}
        {state.cancelError && <p className="text-[12px] text-danger">Could not request cancellation: {state.cancelError}</p>}
      </div>
    ) : null;

  const outcome = (() => {
    if (state.phase === "failed") {
      const view = errorView(state.error.code, state.error.retryable);
      return (
        <ErrorState
          title={view.title}
          message={view.hint ? `${state.error.message} ${view.hint}` : state.error.message}
          code={state.error.code}
          requestId={state.error.requestId ?? undefined}
          action={
            <>
              {view.canRetry && (
                <Button size="sm" variant="primary" onClick={() => void run.start(structured ? false : consent)} disabled={!structured && !consent}>
                  Retry
                </Button>
              )}
              {(view.suggestAdjust || !view.canRetry) && (
                <Button size="sm" onClick={onBackToSelection}>
                  Adjust selection
                </Button>
              )}
            </>
          }
        />
      );
    }
    if (state.phase === "cancelled") {
      return (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-rule bg-sunken px-3 py-2 text-[13px] text-ink">
          <p>
            Cancelled. Nothing was saved. If the request had already reached the model, it may still have been processed (and counted) upstream.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={run.reset}>
              Start over
            </Button>
            <Button size="sm" variant="ghost" onClick={onBackToSelection}>
              Adjust selection
            </Button>
          </div>
        </div>
      );
    }
    if (state.phase === "stopped_waiting") {
      return (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-rule bg-sunken px-3 py-2 text-[13px] text-ink">
          <p>Stopped waiting. The server may still finish this request; starting again picks up its result if it does.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void run.start(structured ? false : consent)}>
              Check again
            </Button>
            <Button size="sm" variant="ghost" onClick={onBackToSelection}>
              Adjust selection
            </Button>
          </div>
        </div>
      );
    }
    return null;
  })();

  if (structured) {
    return (
      <Panel title="Import data" className="h-full min-h-[12rem]" bodyClassName="flex flex-col gap-3 overflow-auto p-4">
        <p className="text-[13px] leading-5 text-ink">{describeStructuredSelection(selection)}</p>
        <p className="text-[12px] text-ink-muted">Parsed on this server. Values keep their original text.</p>
        <Disclosure summary="Import details" className="text-[12px] text-ink-muted">
          <p>
            A deterministic parser runs on this server. Nothing is sent to an external service. Numbers, dates, and percentages are not reinterpreted.
          </p>
        </Disclosure>
        {progress}
        {runControls}
        {outcome}
        {state.phase === "idle" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void run.start(false)}>
              Import data
            </Button>
            <Button variant="ghost" onClick={onBackToSelection}>
              Adjust selection
            </Button>
          </div>
        )}
      </Panel>
    );
  }

  const sent = describeSentInput(source, selection);
  const configured = gemini?.configured === true;
  const disabledReason =
    gemini === null
      ? "Checking whether extraction is available on this server…"
      : !configured
        ? "Unavailable: chart and PDF extraction is not configured on this server."
        : !consent
          ? "Confirm the statement above to start."
          : null;
  const hint = "userHint" in selection ? selection.userHint : null;

  return (
    <Panel title={extractionMode === "text" ? "Build data from text" : "Extract data"} className="h-full min-h-[12rem]" bodyClassName="flex flex-col gap-3 overflow-auto p-4">
      <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
        What should we read?
        <Select value={extractionMode} disabled={busy} onChange={(e) => { setExtractionMode(e.target.value as "chart_table" | "text"); run.reset(); }}>
          <option value="chart_table">Existing chart or table</option>
          <option value="text">Build from text</option>
        </Select>
      </label>
      {extractionMode === "text" && (
        <p className="rounded-2xl border border-accent/30 bg-accent-soft p-3 text-[13px] leading-5 text-ink">
          Turn reported numbers in paragraphs into a table and chart automatically. Each value keeps a source quote and page reference for review. Only explicit values are used; missing numbers, trends, and forecasts are never invented. Select a region containing the relevant text and its context.
        </p>
      )}
      <p className="text-[13px] leading-5 text-ink">
        Extraction covers only {selection.kind === "pdf_region" ? `the selection on page ${selection.pageNumber}` : "the selected region"}, not the rest of the
        file. {extractionMode === "text" ? "Values are transcribed from the text and organized by AI; review their quotes, units, and periods against the source." : "Values read from a chart are estimates that you review against the source."}
      </p>

      <section aria-labelledby={`${consentId}-sent`} className="flex flex-col gap-2 rounded-md border border-rule-strong bg-canvas px-3 py-3">
        <h3 id={`${consentId}-sent`} className="text-[12px] font-semibold tracking-wide text-ink uppercase">
          Sent for external processing
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px] leading-5">
          <dt className="text-ink-muted">What</dt>
          <dd className="text-ink">
            {sent.what}
            {sent.notSent && <span className="text-ink-muted"> {sent.notSent}</span>}
          </dd>
          {hint && (
            <>
              <dt className="text-ink-muted">Your hint</dt>
              <dd className="break-words text-ink">“{hint}”</dd>
            </>
          )}
          <dt className="text-ink-muted">To</dt>
          <dd className="text-ink">Google Gemini{configured && gemini?.model ? <> (model <span className="font-mono text-[12px]">{gemini.model}</span>)</> : null}</dd>
        </dl>
        {sent.wholeFile && (
          <p className="rounded-sm border border-estimate-rule bg-estimate-soft px-2 py-1 text-[12px] leading-4 text-estimate">
            This sends the entire PDF, not only the selected page.
          </p>
        )}
        <p className="text-[12px] leading-4 text-ink-muted">
          Under Gemini&apos;s terms for unpaid use, Google may use submitted content to improve its products, and people may review it. Do not send
          sensitive, confidential, or personal information unless this server is set up for paid processing that covers it.
        </p>
      </section>

      {!busy && (gemini === null || configured) && (
        <label htmlFor={consentId} className="flex items-start gap-2 text-[13px] leading-5 text-ink">
          <input
            id={consentId}
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>I confirm that this content may be sent to Google Gemini as described above.</span>
        </label>
      )}

      {progress}
      {runControls}
      {outcome}

      {state.phase === "idle" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void run.start(true)} disabled={disabledReason !== null} aria-describedby={disabledReason ? `${consentId}-why` : undefined}>
              {extractionMode === "text" ? "Build table and chart" : "Start extraction"}
            </Button>
            <Button variant="ghost" onClick={onBackToSelection}>
              Adjust selection
            </Button>
          </div>
          {disabledReason && (
            <p id={`${consentId}-why`} className="text-[12px] text-ink-muted">
              {disabledReason}
            </p>
          )}
        </div>
      )}
      {gemini !== null && !configured && state.phase === "idle" && (
        <UnavailableNote>
          The server is missing its model provider key or model setting. An administrator can enable extraction in the server environment; this page
          cannot. Your selection is kept, and CSV and XLSX import still work.
        </UnavailableNote>
      )}
    </Panel>
  );
}
