"use client";

import { useEffect, useState } from "react";
import type { AnalysisFact, DatasetDetail, DatasetOverview, SelectionEvent } from "@/contracts";
import { Button, Spinner } from "@/components/ui";
import { ApiClientError, api } from "@/lib/api/client";
import type { GridView } from "./seams";

const MAX_FACTS = 3;
const GENERIC_LABEL = /^column\s+\d+$/i;

function lead(kind: DatasetOverview["kind"], filename: string): string {
  switch (kind) {
    case "time_series":
      return `A time series from ${filename}.`;
    case "categorical":
      return `Values grouped by category, from ${filename}.`;
    case "tabular":
      return `A table from ${filename}.`;
    default:
      return `A table from ${filename}. There is not enough typed data for a fuller summary yet.`;
  }
}

function factEvent(fact: AnalysisFact, versionId: string): SelectionEvent | null {
  if (fact.evidence.rowIds.length === 0 && fact.evidence.cellIds.length === 0) return null;
  return { origin: "quality", datasetVersionId: versionId, rowIds: fact.evidence.rowIds, cellIds: fact.evidence.cellIds, provenanceIds: [] };
}

export function OverviewBlock({
  detail,
  view,
  sourceName,
  onEvidence,
  onShowInData,
  onShowSource,
  onRenameFields,
  onSuggested,
}: {
  detail: DatasetDetail;
  view: GridView | null;
  sourceName: string;
  onEvidence: (event: SelectionEvent) => void;
  onShowInData: (event: SelectionEvent) => void;
  onShowSource: (event: SelectionEvent) => void;
  onRenameFields?: () => void;
  onSuggested?: (questions: string[]) => void;
}) {
  const [overview, setOverview] = useState<DatasetOverview | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [openFact, setOpenFact] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    api
      .getOverview(detail.dataset.id, detail.version.id, {
        preset: view?.preset ?? "all",
        search: view?.search ?? null,
        filterColumnId: view?.filterColumnId ?? null,
        filterText: view?.filterText ?? null,
        sort: { columnId: view?.sortColumnId ?? null, direction: view?.sortDirection ?? "asc" },
        columnIds: view?.columnIds ?? null,
      }, ac.signal)
      .then((o) => {
        setOverview(o);
        setError(null);
        onSuggested?.(o.suggestedQuestions);
      }, (e) => {
        if (e instanceof ApiClientError) setError(e);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.dataset.id, detail.version.id, view?.preset, view?.search, view?.filterColumnId, view?.filterText]);

  const facts = new Map((overview?.facts ?? []).map((f) => [f.id, f]));
  const columns = detail.version.columns;
  const genericLabels = columns.length > 0 && columns.every((c) => GENERIC_LABEL.test(c.label.trim()));
  const viewNote = view && (view.preset !== "all" || view.search || view.filterText) ? "Summarizing the current data view." : null;
  const notes = (overview?.notes ?? []).filter((n) => !(genericLabels && n.startsWith("Field names are the file")));
  // Whole-table row/column counts already appear in the page header.
  const highlights = (overview?.highlights ?? []).filter(
    (h) => !h.factIds.every((id) => {
      const f = facts.get(id);
      return f?.operation === "count" && f.columnId === null;
    }),
  );
  const shown = showAll ? highlights : highlights.slice(0, MAX_FACTS);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="text-[14px] text-danger" role="alert">
          The summary could not be loaded: {error.message}
        </p>
      )}
      {!overview && !error && (
        <p className="text-[14px] text-ink-muted" role="status">
          <Spinner /> Summarizing this table…
        </p>
      )}
      {overview && (
        <>
          <div className="flex max-w-3xl flex-col gap-2">
            <p className="text-[17px] leading-7 text-ink">{lead(overview.kind, sourceName)}</p>
            {viewNote && <p className="text-[13px] text-ink-muted">{viewNote}</p>}
          </div>

          {genericLabels && (
            <div className="flex max-w-3xl flex-col gap-3 rounded-xl border border-estimate-rule bg-estimate-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-[14px] leading-6">
                <p className="font-semibold text-ink">What each column measures is not recorded.</p>
                <p className="text-ink-muted">
                  The file names its fields only “{columns[0].label}” to “{columns[columns.length - 1].label}”, with no units. Rename a column when you know what it
                  measures.
                </p>
              </div>
              {onRenameFields && (
                <Button className="shrink-0" onClick={onRenameFields}>
                  Rename columns
                </Button>
              )}
            </div>
          )}

          {notes.length > 0 && (
            <ul className="flex max-w-3xl flex-col gap-2 text-[14px] leading-6 text-ink-muted">
              {notes.map((n) => (
                <li key={n} className="flex gap-2">
                  <span aria-hidden="true" className="text-ink-faint">
                    •
                  </span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}

          {highlights.length > 0 && (
            <section aria-label="Computed facts" className="flex flex-col gap-3">
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {shown.map((h) => {
                  const linked = h.factIds
                    .map((id) => facts.get(id))
                    .filter((f): f is AnalysisFact => Boolean(f && (f.evidence.rowIds.length > 0 || f.evidence.cellIds.length > 0)));
                  const event = linked[0] ? factEvent(linked[0], detail.version.id) : null;
                  const detailFact = openFact ? h.factIds.map((id) => facts.get(id)).find((f) => f?.id === openFact) : undefined;
                  return (
                    <li key={h.title} className="flex flex-col gap-3 rounded-xl border border-rule bg-surface px-5 py-4">
                      <button
                        type="button"
                        className="flex flex-col gap-1 rounded-sm text-left"
                        onClick={() => {
                          if (event) onEvidence(event);
                          setOpenFact(detailFact ? null : (linked[0]?.id ?? h.factIds[0] ?? null));
                        }}
                        aria-expanded={Boolean(detailFact)}
                      >
                        <span className="text-[15px] font-semibold text-ink">{h.title}</span>
                        <span className="text-[14px] leading-6 text-ink-muted">{h.body}</span>
                      </button>
                      {detailFact && <FactDetail fact={detailFact} />}
                      {event && (
                        <div className="mt-auto flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => onShowInData(event)}>
                            Show in data
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => onShowSource(event)}>
                            Show source
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {highlights.length > MAX_FACTS && (
                <Button size="sm" variant="ghost" className="self-start" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer facts" : `Show ${highlights.length - MAX_FACTS} more fact${highlights.length - MAX_FACTS === 1 ? "" : "s"}`}
                </Button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function FactDetail({ fact }: { fact: AnalysisFact }) {
  return (
    <div className="rounded-lg bg-sunken px-3 py-2 text-[13px] leading-5 text-ink-muted">
      <p>
        {fact.operation.replace(/_/g, " ")}
        {fact.columnLabel ? ` · ${fact.columnLabel}` : ""}
        {fact.unit ? ` · ${fact.unit}` : ""}
      </p>
      <p className="tabular mt-1 text-ink">
        {fact.value.kind === "decimal" && fact.value.value}
        {fact.value.kind === "integer" && fact.value.n.toLocaleString()}
        {fact.value.kind === "coverage" && `${fact.value.valid}/${fact.value.total} present`}
        {fact.value.kind === "pair" && `${fact.value.from} → ${fact.value.to}`}
      </p>
      {fact.limitations.map((l) => (
        <p key={l} className="mt-1">
          {l}
        </p>
      ))}
      {fact.evidence.kind === "query" && fact.evidence.count > fact.evidence.rowIds.length && (
        <p className="mt-1">This fact covers {fact.evidence.count.toLocaleString()} rows; the evidence shows a sample.</p>
      )}
    </div>
  );
}
