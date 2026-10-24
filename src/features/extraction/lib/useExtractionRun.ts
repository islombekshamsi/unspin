"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "@/contracts";
import { ApiClientError, api } from "@/lib/api/client";

export interface RunError {
  code: string;
  message: string;
  retryable: boolean;
  requestId: string | null;
}

export type RunState =
  /** Nothing started. */
  | { phase: "idle" }
  /** POST in flight; the server may be processing inline, so no job id is known yet. */
  | { phase: "submitting"; startedAt: number }
  /** A queued/running job is being polled. */
  | { phase: "tracking"; job: Job; startedAt: number; cancelRequested: boolean; cancelError: string | null }
  | { phase: "failed"; error: RunError }
  | { phase: "cancelled" }
  /** The user stopped waiting for an inline request; the server may still finish it. */
  | { phase: "stopped_waiting" }
  | { phase: "done"; datasetId: string };

const DEFAULT_POLL_MS = 1500;
const MAX_POLL_FAILURES = 3;

function toRunError(e: unknown): RunError {
  if (e instanceof ApiClientError) return { code: e.code, message: e.message, retryable: e.retryable, requestId: e.requestId };
  return { code: "internal", message: "Something went wrong in the browser. Nothing was saved.", retryable: true, requestId: null };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/**
 * Drives one extraction/import job and reports its real state. Starting again
 * after a failure or "stop waiting" is safe: the server reuses an existing job
 * for the same selection instead of sending a second request.
 */
export function useExtractionRun(selectionId: string, onDatasetReady: (datasetId: string) => void) {
  const [state, setState] = useState<RunState>({ phase: "idle" });
  const session = useRef<AbortController | null>(null);
  const ready = useRef(onDatasetReady);

  useEffect(() => {
    ready.current = onDatasetReady;
  }, [onDatasetReady]);

  useEffect(() => () => session.current?.abort(), []);

  const settle = useCallback((job: Job, startedAt: number, signal: AbortSignal): boolean => {
    if (signal.aborted) return true;
    if (job.status === "completed") {
      if (job.resultDatasetId) {
        setState({ phase: "done", datasetId: job.resultDatasetId });
        ready.current(job.resultDatasetId);
      } else {
        setState({ phase: "failed", error: { code: "internal", message: "The job finished without a dataset. Nothing was saved.", retryable: true, requestId: null } });
      }
      return true;
    }
    if (job.status === "failed") {
      const err = job.error ?? { code: "internal", message: "Processing failed. Nothing was saved.", retryable: true };
      setState({ phase: "failed", error: { ...err, requestId: null } });
      return true;
    }
    if (job.status === "cancelled") {
      setState({ phase: "cancelled" });
      return true;
    }
    setState((prev) => ({
      phase: "tracking",
      job,
      startedAt,
      cancelRequested: job.cancellationRequested || (prev.phase === "tracking" && prev.cancelRequested),
      cancelError: prev.phase === "tracking" ? prev.cancelError : null,
    }));
    return false;
  }, []);

  const start = useCallback(
    async (consent: boolean) => {
      session.current?.abort();
      const ctrl = new AbortController();
      session.current = ctrl;
      const startedAt = Date.now();
      setState({ phase: "submitting", startedAt });

      let job: Job;
      try {
        job = await api.createExtraction(selectionId, consent, ctrl.signal);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setState({ phase: "failed", error: toRunError(e) });
        return;
      }
      if (settle(job, startedAt, ctrl.signal)) return;

      let pollMs = DEFAULT_POLL_MS;
      let failures = 0;
      for (;;) {
        await wait(pollMs, ctrl.signal);
        if (ctrl.signal.aborted) return;
        try {
          const res = await api.getJob(job.id);
          failures = 0;
          if (settle(res.job, startedAt, ctrl.signal)) return;
          pollMs = res.pollAfterMs ?? DEFAULT_POLL_MS;
        } catch (e) {
          if (ctrl.signal.aborted) return;
          failures += 1;
          if (failures >= MAX_POLL_FAILURES || (e instanceof ApiClientError && e.code !== "network")) {
            setState({ phase: "failed", error: toRunError(e) });
            return;
          }
          pollMs = DEFAULT_POLL_MS * 2 ** failures;
        }
      }
    },
    [selectionId, settle],
  );

  /** Best-effort cancellation of a tracked job; polling continues until the server reports the outcome. */
  const cancel = useCallback(async () => {
    if (state.phase !== "tracking") return;
    const jobId = state.job.id;
    setState((prev) => (prev.phase === "tracking" ? { ...prev, cancelRequested: true, cancelError: null } : prev));
    try {
      await api.cancelJob(jobId);
    } catch (e) {
      setState((prev) =>
        prev.phase === "tracking" ? { ...prev, cancelRequested: false, cancelError: toRunError(e).message } : prev,
      );
    }
  }, [state]);

  /** Stops waiting for an inline request. The server may still complete it. */
  const stopWaiting = useCallback(() => {
    session.current?.abort();
    setState({ phase: "stopped_waiting" });
  }, []);

  const reset = useCallback(() => {
    session.current?.abort();
    setState({ phase: "idle" });
  }, []);

  return { state, start, cancel, stopWaiting, reset };
}
