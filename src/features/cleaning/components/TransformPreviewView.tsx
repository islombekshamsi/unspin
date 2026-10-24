"use client";

import { useEffect, useMemo, useState } from "react";
import type { CellState, Column, Row, TransformPreview } from "@/contracts";
import { Button, ErrorState, Spinner } from "@/components/ui";
import { fetchRowsByIds } from "@/features/grid/lib/rows";
import { MISSING_LABELS, TYPE_LABELS, valueText } from "@/features/grid/lib/format";
import { ApiClientError } from "@/lib/api/client";
import { PREVIEW_PAGE_SIZE } from "../lib/useTransformFlow";

const REMOVED_PAGE = 20;

/** Actual before/after values from the server preview, one page at a time. */
export function TransformPreviewView({
  preview,
  page,
  busy,
  columns,
  datasetId,
  onPage,
}: {
  preview: TransformPreview;
  page: number;
  busy: boolean;
  columns: Column[];
  datasetId: string;
  onPage: (page: number) => void;
}) {
  const colLabel = useMemo(() => new Map(columns.map((c) => [c.id, c.label])), [columns]);
  const changeRows = useRowsById(datasetId, preview.baseVersionId, [...new Set(preview.changes.map((c) => c.rowId))]);
  const pages = Math.max(1, Math.ceil(preview.totalChanges / PREVIEW_PAGE_SIZE));
  const columnChanges = preview.totalChanges === 0 && preview.removedRowIds.length === 0 && preview.affectedCount > 0;

  return (
    <div className="flex flex-col gap-4 text-[13px]" aria-busy={busy || undefined}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Stat label="Affected" value={String(preview.affectedCount)} />
        <Stat label="Cell changes" value={String(preview.totalChanges)} />
        <Stat label="Rows" value={preview.rowCountBefore === preview.rowCountAfter ? String(preview.rowCountAfter) : `${preview.rowCountBefore} → ${preview.rowCountAfter}`} />
        <Stat label="Left unchanged (flagged)" value={String(preview.failedCellIds.length)} />
      </dl>

      {preview.warnings.length > 0 && (
        <section aria-label="Warnings" className="rounded-md border border-estimate-rule bg-estimate-soft px-3 py-2">
          <h3 className="text-[12px] font-semibold text-estimate">Check before applying</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}
      {preview.precisionEffects.length > 0 && (
        <section aria-label="Precision and meaning">
          <h3 className="text-[12px] font-semibold text-ink-muted">Precision and meaning</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">
            {preview.precisionEffects.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}
      {columnChanges && <p className="text-ink-muted">This changes column settings only; no cell values change.</p>}

      {preview.removedRowIds.length > 0 && <RemovedRows preview={preview} columns={columns} datasetId={datasetId} />}

      {preview.totalChanges > 0 && (
        <section aria-label="Before and after">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold text-ink-muted">
              Before → after{pages > 1 ? ` · page ${page + 1} of ${pages}` : ""}
            </h3>
            {busy && <Spinner />}
          </div>
          <div className="mt-1 overflow-x-auto rounded-md border border-rule">
            <table className="w-full border-collapse text-left">
              <thead className="bg-sunken text-[12px] text-ink-muted">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">Source row</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Column</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Original text</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Before</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.map((c) => (
                  <tr key={c.cellId} className="border-t border-rule align-top">
                    <td className="tabular px-2 py-1.5 text-ink-muted">{rowNumber(changeRows, c.rowId)}</td>
                    <td className="px-2 py-1.5 text-ink-muted">{colLabel.get(c.columnId) ?? "—"}</td>
                    <td className="px-2 py-1.5 font-mono text-[12px] whitespace-pre-wrap text-ink-muted">{c.before.rawText === null ? <em>none</em> : JSON.stringify(c.before.rawText)}</td>
                    <td className="px-2 py-1.5">
                      <StateText s={c.before} />
                    </td>
                    <td className="px-2 py-1.5">
                      <StateText s={c.after} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button size="sm" disabled={busy || page === 0} onClick={() => onPage(page - 1)}>
                Previous
              </Button>
              <Button size="sm" disabled={busy || !preview.changesCursor} onClick={() => onPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </section>
      )}

      {preview.affectedCount === 0 && preview.removedRowIds.length === 0 && preview.totalChanges === 0 && (
        <p className="rounded-md border border-dashed border-rule-strong bg-sunken px-3 py-2 text-ink-muted">
          Nothing would change with these settings{preview.failedCellIds.length > 0 ? "; every candidate value failed and would stay as it is" : ""}.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className="tabular text-base font-semibold text-ink">{value}</dd>
    </div>
  );
}

export function StateText({ s }: { s: CellState }) {
  if (s.currentValue === null) {
    return <span className="text-ink-muted italic">— missing ({s.missingReason ? MISSING_LABELS[s.missingReason] : "no reason"})</span>;
  }
  return (
    <span>
      <span className="font-mono text-[12px] whitespace-pre-wrap text-ink">{JSON.stringify(valueText(s.currentValue))}</span>{" "}
      <span className="text-[11px] text-ink-faint">{TYPE_LABELS[s.valueType]}</span>
    </span>
  );
}

interface RowsById {
  ready: boolean;
  rows: Map<string, Row> | null;
  error: ApiClientError | null;
}

/** Looks up specific base-version rows (for row numbers and removed-row contents). */
function useRowsById(datasetId: string, versionId: string, ids: string[]): RowsById {
  const [result, setResult] = useState<{ key: string; rows: Map<string, Row> | null; error: ApiClientError | null }>({ key: "", rows: null, error: null });
  const key = `${versionId}:${ids.join(",")}`;

  useEffect(() => {
    if (ids.length === 0) return;
    const ac = new AbortController();
    fetchRowsByIds(datasetId, versionId, ids, ac.signal).then(
      (rows) => setResult({ key, rows, error: null }),
      (e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof ApiClientError) setResult({ key, rows: null, error: e });
      },
    );
    return () => ac.abort();
    // ids are captured by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, datasetId]);

  const ready = result.key === key;
  return { ready, rows: ready ? result.rows : null, error: ready ? result.error : null };
}

function rowNumber(r: RowsById, rowId: string): string {
  if (!r.ready) return "…";
  const row = r.rows?.get(rowId);
  return row ? String(row.sourceOrder + 1) : "?";
}

function RemovedRows({ preview, columns, datasetId }: { preview: TransformPreview; columns: Column[]; datasetId: string }) {
  const [page, setPage] = useState(0);
  const ids = preview.removedRowIds.slice(page * REMOVED_PAGE, (page + 1) * REMOVED_PAGE);
  const result = useRowsById(datasetId, preview.baseVersionId, ids);

  const pages = Math.ceil(preview.removedRowIds.length / REMOVED_PAGE);
  const ready = result.ready;
  const shown = columns.slice(0, 6);
  return (
    <section aria-label="Rows that would be removed">
      <h3 className="text-[12px] font-semibold text-danger">
        {preview.removedRowIds.length} row{preview.removedRowIds.length === 1 ? "" : "s"} would be removed{pages > 1 ? ` · page ${page + 1} of ${pages}` : ""}
      </h3>
      {ready && result.error && <ErrorState className="mt-1" title="Could not load the rows to show them" message={result.error.message} code={result.error.code} />}
      {!ready && (
        <p className="mt-1 flex items-center gap-2 text-ink-muted" role="status">
          <Spinner /> Loading the rows…
        </p>
      )}
      {ready && result.rows && (
        <div className="mt-1 overflow-x-auto rounded-md border border-danger-rule">
          <table className="w-full border-collapse text-left">
            <thead className="bg-danger-soft text-[12px] text-ink-muted">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">Source row</th>
                {shown.map((c) => (
                  <th key={c.id} scope="col" className="px-2 py-1.5 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ids.map((id) => {
                const row = result.rows!.get(id);
                return (
                  <tr key={id} className="border-t border-rule">
                    <td className="tabular px-2 py-1.5 text-ink-muted">{row ? row.sourceOrder + 1 : "?"}</td>
                    {shown.map((c) => {
                      const cell = row?.cells[c.id];
                      return (
                        <td key={c.id} className="px-2 py-1.5">
                          {cell ? <StateText s={cell} /> : <span className="text-ink-faint">no cell</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {columns.length > shown.length && <p className="px-2 py-1 text-[12px] text-ink-faint">Showing the first {shown.length} of {columns.length} columns.</p>}
        </div>
      )}
      {pages > 1 && (
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </section>
  );
}
