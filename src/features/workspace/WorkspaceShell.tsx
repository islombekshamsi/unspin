"use client";

import { useEffect, useRef, useState } from "react";
import type { DatasetDetail } from "@/contracts";
import { Badge, Button, Dialog, ErrorState, Panel, SegmentedControl, Select, UnavailableNote } from "@/components/ui";
import { HistoryPanel, QualityPanel } from "@/features/cleaning";
import { ComparisonPanel } from "@/features/comparison";
import { CandidateStatus, ExtractionLauncher } from "@/features/extraction";
import { DataGrid } from "@/features/grid";
import { SourceSelector, SourceViewer, UploadPanel } from "@/features/ingestion";
import { ChartPanel } from "@/features/visualization";
import { ApiClientError, api } from "@/lib/api/client";
import { useWorkspace, WorkspaceProvider } from "./context";
import { ExportDialog } from "./ExportDialog";
import type { GridView } from "./seams";

export function Workspace() {
  return (
    <WorkspaceProvider>
      <WorkspaceRouter />
    </WorkspaceProvider>
  );
}

/** Keeps only opaque ids in the URL so a refresh can reload committed work from the server. */
function useUrlState() {
  const ws = useWorkspace();
  const restored = useRef(false);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const params = new URLSearchParams(window.location.search);
    const sourceId = params.get("source");
    const datasetId = params.get("dataset");
    (async () => {
      try {
        if (sourceId) {
          const source = await api.getSource(sourceId);
          ws.setSource(source);
          if (datasetId) await ws.loadDataset(datasetId);
        }
      } catch (e) {
        if (!(e instanceof ApiClientError)) throw e;
        window.history.replaceState(null, "", window.location.pathname);
        setRestoreError(e);
      } finally {
        setRestoring(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (restoring) return;
    const params = new URLSearchParams();
    if (ws.source) params.set("source", ws.source.id);
    if (ws.detail) params.set("dataset", ws.detail.dataset.id);
    const qs = params.toString();
    const next = qs ? `?${qs}` : window.location.pathname;
    if (`${window.location.search}` !== (qs ? `?${qs}` : "")) window.history.replaceState(null, "", next);
  }, [ws.source, ws.detail, restoring]);

  return { restoring, restoreError, clearRestoreError: () => setRestoreError(null) };
}

function WorkspaceRouter() {
  const ws = useWorkspace();
  const { restoring, restoreError, clearRestoreError } = useUrlState();
  const [healthError, setHealthError] = useState<ApiClientError | null>(null);

  useEffect(() => {
    api.health().then(ws.setHealth, (e) => {
      if (e instanceof ApiClientError) setHealthError(e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (restoring) {
    return (
      <main className="flex flex-1 items-center justify-center" aria-busy="true">
        <p className="text-sm text-ink-muted" role="status">
          Loading workspace…
        </p>
      </main>
    );
  }

  if (!ws.source) {
    return <Landing healthError={healthError} restoreError={restoreError} onDismissRestore={clearRestoreError} />;
  }
  if (ws.detail) return <DatasetWorkspace />;
  if (ws.loadError) {
    return (
      <Frame>
        <div className="mx-auto w-full max-w-xl p-6">
          <ErrorState
            title="Could not open the dataset"
            message={ws.loadError.message}
            code={ws.loadError.code}
            requestId={ws.loadError.requestId ?? undefined}
            action={<Button onClick={() => ws.setSelection(null)}>Back to selection</Button>}
          />
        </div>
      </Frame>
    );
  }
  if (!ws.selection) {
    return (
      <Frame>
        <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
          <SourceSelector source={ws.source} onSelectionCreated={ws.setSelection} onReplaceSource={ws.reset} />
        </div>
      </Frame>
    );
  }
  return (
    <Frame>
      <div className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Source" bodyClassName="p-3">
          <SourceViewer source={ws.source} selection={ws.selection} provenance={[]} activeProvenanceIds={[]} />
        </Panel>
        <div>
          <ExtractionLauncher
            source={ws.source}
            selection={ws.selection}
            gemini={ws.health?.capabilities.gemini ?? null}
            onDatasetReady={(id) => void ws.loadDataset(id)}
            onBackToSelection={() => ws.setSelection(null)}
          />
        </div>
      </div>
    </Frame>
  );
}

function Wordmark() {
  return (
    <span className="font-mono text-[15px] font-semibold tracking-[0.18em] text-ink" aria-label="UNSPIN">
      UNSPIN
    </span>
  );
}

function Frame({ children, bar, bounded = false }: { children: React.ReactNode; bar?: React.ReactNode; bounded?: boolean }) {
  const ws = useWorkspace();
  return (
    <div className={bounded ? "flex min-h-screen flex-col lg:h-screen lg:overflow-hidden" : "flex min-h-screen flex-col"}>
      <header className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-surface px-4 py-2">
        <button type="button" onClick={ws.reset} className="rounded-sm" title="Start over with a new file">
          <Wordmark />
        </button>
        {ws.source && (
          <span className="min-w-0 truncate text-[13px] text-ink-muted" title={ws.source.filename}>
            {ws.source.filename} · {formatBytes(ws.source.byteSize)}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">{bar}</div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

function Landing({
  healthError,
  restoreError,
  onDismissRestore,
}: {
  healthError: ApiClientError | null;
  restoreError: ApiClientError | null;
  onDismissRestore: () => void;
}) {
  const ws = useWorkspace();
  const limits = ws.health?.limits ?? null;
  const gemini = ws.health?.capabilities.gemini;
  const persistence = ws.health?.capabilities.persistence;
  return (
    <main className="flex flex-1 flex-col items-center px-4 pt-[12vh] pb-16">
      <div className="w-full max-w-2xl">
        <Wordmark />
        <h1 className="mt-6 text-4xl leading-tight font-semibold tracking-tight text-ink sm:text-5xl">
          Drop your data. <span className="text-accent">Make it usable.</span>
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-6 text-ink-muted">
          Turn a chart, PDF figure, or spreadsheet into a dataset you can check against its source, correct, chart, and export with its full history.
        </p>

        {restoreError && (
          <ErrorState
            className="mt-6"
            title="Your previous workspace could not be reopened"
            message={
              restoreError.code === "not_found" && persistence && !persistence.durable
                ? "This server keeps work in memory only, and it has restarted or the link belongs to another browser session."
                : restoreError.message
            }
            code={restoreError.code}
            action={<Button onClick={onDismissRestore}>Dismiss</Button>}
          />
        )}

        <div className="mt-8">
          <UploadPanel limits={limits} onSourceCreated={ws.setSource} />
        </div>

        <dl className="mt-6 grid gap-x-6 gap-y-3 text-[13px] leading-5 text-ink-muted sm:grid-cols-2">
          <div>
            <dt className="font-medium text-ink">Spreadsheets (CSV, XLSX)</dt>
            <dd>Parsed on this server. Nothing is sent to an AI model.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Charts and PDFs (PNG, JPEG, WebP, PDF)</dt>
            <dd>
              Only the region you select is sent to Google Gemini, after you confirm. Values read from charts are marked as estimates.
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-col gap-2">
          {healthError && <ErrorState title="Server status unavailable" message={healthError.message} code={healthError.code} />}
          {gemini && !gemini.configured && (
            <UnavailableNote>
              {gemini.reason ?? "Chart and PDF extraction is unavailable on this server: the model is not configured."} CSV and XLSX import still work.
            </UnavailableNote>
          )}
          {persistence && !persistence.durable && (
            <UnavailableNote>
              Work is kept for this session only and is lost when the server restarts. Export your results to keep them.
            </UnavailableNote>
          )}
        </div>
      </div>
    </main>
  );
}

type MobileTab = "source" | "data" | "chart";

function DatasetWorkspace() {
  const ws = useWorkspace();
  const detail = ws.detail as DatasetDetail;
  const source = ws.source!;
  const [qualityOpen, setQualityOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [view, setView] = useState<GridView | null>(null);
  const [tab, setTab] = useState<MobileTab>("data");
  const persistence = ws.health?.capabilities.persistence;
  const { dataset, version, versions } = detail;
  const versionIndex = versions.findIndex((v) => v.id === version.id);

  const activeProvenanceIds = ws.linked?.provenanceIds ?? [];

  const bar = (
    <>
      <span className="text-[12px] text-ink-muted" role="status">
        {persistence?.durable ? "Saved" : "Session only — not saved to disk"}
      </span>
      <label className="sr-only" htmlFor="version-select">
        Version
      </label>
      <Select
        id="version-select"
        className="h-8 w-auto text-[13px]"
        value={version.id}
        onChange={(e) => void ws.loadDataset(dataset.id, e.target.value)}
      >
        {versions.map((v, i) => (
          <option key={v.id} value={v.id}>
            v{i + 1}
            {v.id === dataset.currentVersionId ? " (current)" : ""} · {new Date(v.createdAt).toLocaleTimeString()}
          </option>
        ))}
      </Select>
      <Button size="sm" onClick={() => setQualityOpen((o) => !o)} aria-expanded={qualityOpen}>
        Review{version.unresolvedFindingCount > 0 ? ` (${version.unresolvedFindingCount})` : ""}
      </Button>
      <Button size="sm" onClick={() => setHistoryOpen(true)}>
        History
      </Button>
      <Button size="sm" onClick={() => setCompareOpen(true)}>
        Compare
      </Button>
      <Button size="sm" variant="primary" onClick={() => setExportOpen(true)}>
        Export
      </Button>
    </>
  );

  return (
    <Frame bar={bar} bounded>
      <div className="flex flex-col gap-3 border-b border-rule bg-surface px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold text-ink">{dataset.title}</h1>
          <span className="tabular text-[13px] text-ink-muted">
            {version.rowCount} rows × {version.columns.length} columns · version {versionIndex + 1} of {versions.length}
          </span>
          {!ws.isCurrentVersion && (
            <Badge tone="estimate">
              Viewing an older version (read-only)
            </Badge>
          )}
          {!ws.isCurrentVersion && (
            <Button size="sm" variant="ghost" onClick={() => void ws.loadDataset(dataset.id)}>
              Back to current
            </Button>
          )}
        </div>
        <CandidateStatus detail={detail} onAcknowledged={(d) => ws.setDetail({ ...detail, dataset: d })} />
      </div>

      <div className="border-b border-rule bg-surface px-4 py-2 lg:hidden">
        <SegmentedControl<MobileTab>
          label="Workspace panel"
          value={tab}
          onChange={setTab}
          options={[
            { value: "source", label: "Source" },
            { value: "data", label: "Data" },
            { value: "chart", label: "Chart" },
          ]}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="grid min-h-0 flex-1 gap-3 p-3 lg:overflow-auto lg:grid-cols-2 lg:grid-rows-[minmax(320px,1fr)_minmax(320px,1fr)]">
          <Panel title="Source" className={tab === "source" ? "" : "hidden lg:flex"} bodyClassName="overflow-auto p-3">
            <SourceViewer
              source={source}
              selection={ws.selection}
              provenance={detail.provenance}
              activeProvenanceIds={activeProvenanceIds}
              onSourceSelect={(provenanceIds) => {
                const rowIds: string[] = [];
                const cellIds: string[] = [];
                ws.select({ origin: "source", datasetVersionId: version.id, rowIds, cellIds, provenanceIds });
              }}
            />
          </Panel>
          <Panel title="Chart" className={tab === "chart" ? "" : "hidden lg:flex"} bodyClassName="overflow-hidden">
            <ChartPanel detail={detail} linked={ws.linked} onLinkedSelect={ws.select} />
          </Panel>
          <Panel title="Data" className={`lg:col-span-2 ${tab === "data" ? "" : "hidden lg:flex"}`} bodyClassName="overflow-hidden">
            <DataGrid
              detail={detail}
              isCurrentVersion={ws.isCurrentVersion}
              linked={ws.linked}
              onLinkedSelect={ws.select}
              onDetailChange={ws.setDetail}
              onViewChange={setView}
            />
          </Panel>
        </div>
        {qualityOpen && (
          <aside aria-label="Data quality review" className="w-full max-w-sm shrink-0 overflow-auto border-l border-rule bg-surface max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:shadow-overlay">
            <div className="flex items-center justify-between border-b border-rule px-4 py-2">
              <h2 className="text-[13px] font-semibold tracking-wide uppercase">Review</h2>
              <Button size="sm" variant="ghost" onClick={() => setQualityOpen(false)}>
                Close
              </Button>
            </div>
            <QualityPanel
              detail={detail}
              isCurrentVersion={ws.isCurrentVersion}
              linked={ws.linked}
              onLinkedSelect={ws.select}
              onDetailChange={ws.setDetail}
            />
          </aside>
        )}
      </div>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} title="History" description="Every committed change. Restoring makes an earlier stored version current again.">
        <HistoryPanel
          detail={detail}
          onDetailChange={ws.setDetail}
          onViewVersion={(versionId) => {
            setHistoryOpen(false);
            void ws.loadDataset(dataset.id, versionId);
          }}
        />
      </Dialog>
      <Dialog open={compareOpen} onClose={() => setCompareOpen(false)} title="Compare datasets" className="w-[min(1100px,calc(100vw-2rem))]">
        <ComparisonPanel detail={detail} />
      </Dialog>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} detail={detail} view={view} onAcknowledged={() => void ws.loadDataset(dataset.id, version.id)} />
    </Frame>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
