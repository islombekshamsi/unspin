"use client";

import { useCallback, useRef, useState } from "react";
import type { DatasetDetail, TransformOperation, TransformPreview } from "@/contracts";
import { ApiClientError, api } from "@/lib/api/client";

export const PREVIEW_PAGE_SIZE = 50;

/**
 * One explicit preview -> apply transaction against the displayed version.
 * Apply sends the exact previewed operation, its base version, and its hash; the server refuses
 * anything else. Committed results reach the workspace only through onDetailChange.
 */
export type FlowState =
  | { status: "idle" }
  | { status: "previewing"; operation: TransformOperation; preview: TransformPreview | null; page: number }
  | { status: "ready"; operation: TransformOperation; preview: TransformPreview; page: number }
  | { status: "applying"; operation: TransformOperation; preview: TransformPreview; page: number }
  | { status: "failed"; phase: "preview" | "apply"; operation: TransformOperation; preview: TransformPreview | null; error: ApiClientError }
  | { status: "conflict"; operation: TransformOperation; currentVersionId: string | null }
  | { status: "applied"; summary: string };

export function useTransformFlow(detail: DatasetDetail, onDetailChange: (d: DatasetDetail) => void) {
  const [state, setState] = useState<FlowState>({ status: "idle" });
  const seq = useRef(0);
  const datasetId = detail.dataset.id;
  const versionId = detail.version.id;

  const handleError = useCallback((e: unknown, phase: "preview" | "apply", operation: TransformOperation, preview: TransformPreview | null) => {
    if (!(e instanceof ApiClientError)) throw e;
    if (e.code === "version_conflict") setState({ status: "conflict", operation, currentVersionId: e.currentVersionId });
    else setState({ status: "failed", phase, operation, preview, error: e });
  }, []);

  const preview = useCallback(
    async (operation: TransformOperation, page = 0) => {
      const id = ++seq.current;
      setState((s) => ({
        status: "previewing",
        operation,
        // Keep the current page visible while the next one loads, but only for the same operation.
        preview: "preview" in s && s.preview && s.operation === operation ? s.preview : null,
        page: "page" in s && "operation" in s && s.operation === operation ? s.page : 0,
      }));
      try {
        const p = await api.previewTransform(datasetId, {
          expectedVersionId: versionId,
          operation,
          cursor: page > 0 ? String(page * PREVIEW_PAGE_SIZE) : null,
          limit: PREVIEW_PAGE_SIZE,
        });
        if (id === seq.current) setState({ status: "ready", operation, preview: p, page });
      } catch (e) {
        if (id === seq.current) handleError(e, "preview", operation, null);
      }
    },
    [datasetId, versionId, handleError],
  );

  const apply = useCallback(async () => {
    if (state.status !== "ready") return;
    const { operation, preview: p, page } = state;
    const id = ++seq.current;
    setState({ status: "applying", operation, preview: p, page });
    try {
      const next = await api.applyTransform(datasetId, { expectedVersionId: p.baseVersionId, operation: p.operation, operationHash: p.operationHash });
      if (id !== seq.current) return;
      setState({ status: "applied", summary: summarize(p) });
      onDetailChange(next);
    } catch (e) {
      if (id === seq.current) handleError(e, "apply", operation, p);
    }
  }, [state, datasetId, onDetailChange, handleError]);

  const reset = useCallback(() => {
    seq.current += 1;
    setState({ status: "idle" });
  }, []);

  return { state, preview, apply, reset };
}

function summarize(p: TransformPreview): string {
  if (p.removedRowIds.length > 0) return `Saved. Removed ${p.removedRowIds.length} row${p.removedRowIds.length === 1 ? "" : "s"}.`;
  return `Saved. ${p.affectedCount} change${p.affectedCount === 1 ? "" : "s"} applied.`;
}

/** Loads the dataset's current version after a conflict. */
export async function loadLatest(datasetId: string, onDetailChange: (d: DatasetDetail) => void): Promise<ApiClientError | null> {
  try {
    onDetailChange(await api.getDataset(datasetId));
    return null;
  } catch (e) {
    if (e instanceof ApiClientError) return e;
    throw e;
  }
}
