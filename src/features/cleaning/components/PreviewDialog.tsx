"use client";

import type { DatasetDetail } from "@/contracts";
import { Button, Dialog, ErrorState, ProgressStatus } from "@/components/ui";
import { describeOperation, isDestructive } from "../lib/describe";
import type { useTransformFlow } from "../lib/useTransformFlow";
import { ConflictNotice } from "./ConflictNotice";
import { TransformPreviewView } from "./TransformPreviewView";

type Flow = ReturnType<typeof useTransformFlow>;

/** Explicit Apply / Cancel around an actual server preview. Closing never applies anything. */
export function PreviewDialog({ flow, detail, onDetailChange }: { flow: Flow; detail: DatasetDetail; onDetailChange: (d: DatasetDetail) => void }) {
  const { state } = flow;
  const open = state.status !== "idle" && state.status !== "applied";
  const operation = "operation" in state ? state.operation : null;
  const preview = "preview" in state ? state.preview : null;
  const page = "page" in state ? state.page : 0;
  const title = operation ? describeOperation(operation, detail.version.columns) : "Preview";
  const destructive = operation ? isDestructive(operation) : false;
  const nothing = preview && preview.affectedCount === 0 && preview.totalChanges === 0 && preview.removedRowIds.length === 0;

  return (
    <Dialog
      open={open}
      onClose={() => state.status !== "applying" && flow.reset()}
      title={title}
      description="These are the actual values this change would produce. Nothing is saved until you apply it, and every applied change can be undone from History."
      className="w-[min(860px,calc(100vw-2rem))]"
      footer={
        state.status === "conflict" ? null : (
          <>
            <Button onClick={flow.reset} disabled={state.status === "applying"}>
              Cancel
            </Button>
            <Button
              variant={destructive ? "danger" : "primary"}
              onClick={() => void flow.apply()}
              disabled={state.status !== "ready" || !!nothing}
              loading={state.status === "applying"}
            >
              {state.status === "applying"
                ? "Saving…"
                : destructive && preview
                  ? `Remove ${preview.removedRowIds.length} row${preview.removedRowIds.length === 1 ? "" : "s"}`
                  : "Apply change"}
            </Button>
          </>
        )
      }
    >
      {state.status === "previewing" && !state.preview && <ProgressStatus label="Computing preview…" />}
      {state.status === "conflict" && <ConflictNotice datasetId={detail.dataset.id} onDetailChange={(d) => { flow.reset(); onDetailChange(d); }} onDismiss={flow.reset} />}
      {state.status === "failed" && (
        <ErrorState
          className="mb-3"
          title={state.phase === "apply" ? "Not saved" : "Could not preview this change"}
          message={state.error.code === "preview_required" ? "The change differs from the preview. Preview it again before applying." : state.error.message}
          code={state.error.code}
          requestId={state.error.requestId ?? undefined}
          action={
            operation && (
              <Button size="sm" onClick={() => void flow.preview(operation)}>
                Preview again
              </Button>
            )
          }
        />
      )}
      {preview && operation && (
        <TransformPreviewView
          preview={preview}
          page={page}
          busy={state.status === "previewing" || state.status === "applying"}
          columns={detail.version.columns}
          datasetId={detail.dataset.id}
          onPage={(p) => void flow.preview(operation, p)}
        />
      )}
    </Dialog>
  );
}
