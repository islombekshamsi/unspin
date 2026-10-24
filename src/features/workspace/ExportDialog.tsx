"use client";

import { useState } from "react";
import type { DatasetDetail, ExportFormat } from "@/contracts";
import { Button, Dialog, ErrorState, SegmentedControl, UnavailableNote } from "@/components/ui";
import { ApiClientError, api } from "@/lib/api/client";
import type { GridView } from "./seams";

function download(filename: string, mimeType: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function collectViewRowIds(datasetId: string, versionId: string, view: GridView): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await api.getRows(datasetId, {
      versionId,
      cursor,
      limit: 1000,
      sortColumnId: view.sortColumnId,
      sortDirection: view.sortDirection,
      filterColumnId: view.filterColumnId,
      filterText: view.filterText,
    });
    ids.push(...page.rows.map((r) => r.id));
    cursor = page.nextCursor;
  } while (cursor);
  return ids;
}

export function ExportDialog({
  open,
  onClose,
  detail,
  view,
  onAcknowledged,
}: {
  open: boolean;
  onClose: () => void;
  detail: DatasetDetail;
  view: GridView | null;
  onAcknowledged: () => void;
}) {
  const [scope, setScope] = useState<"full" | "view">("full");
  const [formats, setFormats] = useState<Record<ExportFormat, boolean>>({ csv: true, manifest: true, json: false });
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [done, setDone] = useState<string[] | null>(null);

  const { dataset, version } = detail;
  const needsAck = dataset.coverage !== "complete_selection" && !dataset.coverageAcknowledgedAt;
  const viewIsFiltered = !!view && (!!view.filterText || !!view.sortColumnId || view.columnIds.length !== version.columns.length);
  const chosen = (Object.keys(formats) as ExportFormat[]).filter((f) => formats[f]);
  const unreviewed = version.reviewSummary.unreviewed;

  async function run() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const exportScope =
        scope === "view" && view
          ? {
              kind: "view" as const,
              rowIds: await collectViewRowIds(dataset.id, version.id, view),
              columnIds: view.columnIds,
              description: describeView(detail, view),
            }
          : { kind: "full" as const };
      if (exportScope.kind === "view" && exportScope.rowIds.length === 0) {
        setError(new ApiClientError("bad_request", "The current view has no rows to export.", 400, false, null, undefined));
        return;
      }
      const result = await api.createExport(dataset.id, {
        versionId: version.id,
        formats: chosen,
        scope: exportScope,
        acknowledgePartial: ack,
      });
      for (const f of result.files) download(f.filename, f.mimeType, f.content);
      setDone(result.files.map((f) => f.filename));
      if (needsAck && ack) onAcknowledged();
    } catch (e) {
      if (e instanceof ApiClientError) setError(e);
      else throw e;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export data"
      description={
        <>
          Exports version from {new Date(version.createdAt).toLocaleString()} · {version.rowCount} rows × {version.columns.length} columns.
        </>
      }
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={run} loading={busy} disabled={chosen.length === 0 || (needsAck && !ack)}>
            Download
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[12px] font-medium text-ink-muted">Scope</legend>
          <SegmentedControl
            label="Export scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: "full", label: "Whole dataset" },
              { value: "view", label: "Current view", disabled: !view, title: view ? undefined : "The grid has not reported a view yet" },
            ]}
          />
          <p className="text-[12px] text-ink-muted">
            {scope === "full"
              ? "All rows and columns of this version, in source order — not only what the chart shows."
              : view
                ? `${describeView(detail, view)}${viewIsFiltered ? "" : " (same as whole dataset)"}`
                : ""}
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[12px] font-medium text-ink-muted">Files</legend>
          {(
            [
              ["csv", "CSV data", "Spreadsheet-safe: text that could run as a formula is prefixed with an apostrophe."],
              ["manifest", "Provenance manifest (JSON)", "Source hash, selection, extraction method, review states, full history."],
              ["json", "Exact data (JSON)", "Exact strings and types without spreadsheet escaping."],
            ] as const
          ).map(([key, label, hint]) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={formats[key]}
                onChange={(e) => setFormats((f) => ({ ...f, [key]: e.target.checked }))}
              />
              <span>
                {label}
                <span className="block text-[12px] text-ink-muted">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {unreviewed > 0 && (
          <UnavailableNote>
            {unreviewed} of {version.reviewSummary.cellsTotal} values have not been reviewed. Their status is recorded in the manifest; nothing is
            labelled verified automatically.
          </UnavailableNote>
        )}

        {needsAck && (
          <label className="flex items-start gap-2 rounded-md border border-estimate-rule bg-estimate-soft px-3 py-2 text-sm">
            <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>
              I understand this dataset is marked <strong>{dataset.coverage.replace("_", " ")}</strong>: {dataset.coverageNote}
            </span>
          </label>
        )}

        {error && <ErrorState title="Export failed" message={error.message} code={error.code} requestId={error.requestId ?? undefined} />}
        {done && (
          <p role="status" className="text-[13px] text-success">
            Downloaded {done.join(", ")}.
          </p>
        )}
      </div>
    </Dialog>
  );
}

function describeView(detail: DatasetDetail, view: GridView): string {
  const label = (id: string | null) => detail.version.columns.find((c) => c.id === id)?.label ?? "";
  const parts = [`${view.columnIds.length} of ${detail.version.columns.length} columns`];
  if (view.filterColumnId && view.filterText) parts.push(`filtered where “${label(view.filterColumnId)}” contains “${view.filterText}”`);
  if (view.sortColumnId) parts.push(`sorted by “${label(view.sortColumnId)}” ${view.sortDirection === "asc" ? "ascending" : "descending"}`);
  return parts.join(", ");
}
