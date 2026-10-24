"use client";

import { useId, useState, type ReactNode } from "react";
import type { SelectionInput, SourceSelection } from "@/contracts";
import { Badge, Button, ErrorState, Panel } from "@/components/ui";
import type { SourceSelectorProps } from "@/features/workspace/seams";
import { ApiClientError, api } from "@/lib/api/client";
import { formatBytes } from "../lib/format";
import { CsvSelector } from "./CsvSelector";
import { ImageSelector } from "./ImageSelector";
import { PdfSelector } from "./PdfSelector";
import { XlsxSelector } from "./XlsxSelector";

const KIND_LABEL = { image: "Image", pdf: "PDF", csv: "CSV", xlsx: "Excel workbook" } as const;
export const HINT_MAX = 300;

export interface SubmitState {
  submitting: boolean;
  error: ApiClientError | null;
  submit: (input: SelectionInput) => Promise<void>;
}

export function SourceSelector({ source, onSelectionCreated, onReplaceSource }: SourceSelectorProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);

  const submit = async (input: SelectionInput) => {
    setSubmitting(true);
    setError(null);
    try {
      const selection: SourceSelection = await api.createSelection(source.id, input);
      onSelectionCreated(selection);
    } catch (e) {
      setError(e instanceof ApiClientError ? e : new ApiClientError("internal", "The selection could not be saved. Try again.", 0, true, null, undefined));
    } finally {
      setSubmitting(false);
    }
  };
  const state: SubmitState = { submitting, error, submit };

  return (
    <Panel
      title={`Choose what to use from this ${KIND_LABEL[source.kind].toLowerCase()}`}
      actions={
        <Button size="sm" variant="ghost" onClick={onReplaceSource}>
          Upload a different file
        </Button>
      }
      bodyClassName="p-4 sm:p-5"
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted">
        <span className="min-w-0 truncate font-medium text-ink" title={source.filename}>
          {source.filename}
        </span>
        <Badge>{KIND_LABEL[source.kind]}</Badge>
        <span className="tabular">{formatBytes(source.byteSize)}</span>
        {source.kind === "pdf" && source.pageCount && <span className="tabular">{source.pageCount} pages</span>}
        {source.kind === "image" && source.image && (
          <span className="tabular">
            {source.image.orientedWidth} × {source.image.orientedHeight} px
            {source.image.exifOrientation !== 1 ? " (rotated using its orientation tag)" : ""}
          </span>
        )}
        {source.kind === "xlsx" && source.sheetNames && <span>{source.sheetNames.length} sheets</span>}
      </div>
      {source.kind === "image" && <ImageSelector source={source} state={state} />}
      {source.kind === "pdf" && <PdfSelector source={source} state={state} />}
      {source.kind === "csv" && <CsvSelector source={source} state={state} />}
      {source.kind === "xlsx" && <XlsxSelector source={source} state={state} />}
    </Panel>
  );
}

/** Scope statement, optional hint (image/PDF only), and the submit action. */
export function SelectionFooter({
  scope,
  disclosure,
  hint,
  onHintChange,
  canSubmit,
  disabledReason,
  onSubmit,
  state,
  extra,
}: {
  scope: string;
  disclosure: string;
  hint?: string;
  onHintChange?: (v: string) => void;
  canSubmit: boolean;
  disabledReason?: string;
  onSubmit: () => void;
  state: SubmitState;
  extra?: ReactNode;
}) {
  const hintId = useId();
  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-rule pt-4">
      {onHintChange && (
        <div className="flex flex-col gap-1">
          <label htmlFor={hintId} className="text-[12px] font-medium text-ink-muted">
            What should be read here? (optional)
          </label>
          <textarea
            id={hintId}
            value={hint}
            maxLength={HINT_MAX}
            rows={2}
            onChange={(e) => onHintChange(e.target.value)}
            placeholder="e.g. the bar chart of 2019–2023 revenue; use the left axis"
            className="w-full rounded-md border border-rule-strong bg-surface px-2.5 py-2 text-sm text-ink placeholder:text-ink-faint"
          />
          <p className="text-[12px] text-ink-faint">
            Identifies the figure or series only; it is treated as a description, not as instructions. {hint?.length ?? 0}/{HINT_MAX}
          </p>
        </div>
      )}
      <div className="rounded-md bg-sunken px-3 py-2 text-[13px] leading-5 text-ink">
        <p className="font-medium">{scope}</p>
        <p className="text-ink-muted">{disclosure}</p>
      </div>
      {extra}
      {state.error && (
        <ErrorState title="This selection could not be used" message={state.error.message} code={state.error.code === "network" ? undefined : state.error.code} requestId={state.error.requestId ?? undefined} />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={onSubmit} disabled={!canSubmit} loading={state.submitting}>
          Use this selection
        </Button>
        {!canSubmit && disabledReason && <span className="text-[12px] text-ink-muted">{disabledReason}</span>}
      </div>
    </div>
  );
}

export function cleanHint(h: string): string | null {
  const t = h.trim().slice(0, HINT_MAX);
  return t.length > 0 ? t : null;
}
