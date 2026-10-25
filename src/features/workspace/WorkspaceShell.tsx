"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { DatasetDetail, SelectionEvent } from "@/contracts";
import { Badge, Button, Dialog, Drawer, ErrorState, Menu, Panel, Select, UnavailableNote, cx, type MenuItem } from "@/components/ui";
import { HistoryPanel, QualityPanel } from "@/features/cleaning";
import { ComparisonPanel } from "@/features/comparison";
import { CandidateStatus, ExtractionLauncher } from "@/features/extraction";
import { DataGrid } from "@/features/grid";
import { SourceSelector, SourceViewer, UploadPanel } from "@/features/ingestion";
import { ChartPanel } from "@/features/visualization";
import { ApiClientError, api } from "@/lib/api/client";
import { useWorkspace, WorkspaceProvider } from "./context";
import { AnalysisPanel } from "./AnalysisPanel";
import { ExportDialog } from "./ExportDialog";
import { OverviewBlock } from "./OverviewBlock";
import { PreparedDemoPanel } from "./PreparedDemoPanel";
import { withSourceProvenance } from "./lib/evidence";
import { WORKSPACE_TABS, layoutStorageKey, normalizeLayout, serializeLayout, type WorkspaceTab } from "./lib/layout-state";
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
  if (ws.detail) return <DatasetWorkspace key={ws.detail.dataset.id} />;
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
      <div
        className="flex min-h-screen flex-col bg-canvas text-ink transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] starting:translate-y-2 starting:opacity-0"
      >
        <header className="mx-auto flex w-full max-w-[1320px] shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-[clamp(14px,3vw,36px)] pt-5">
          <button type="button" onClick={ws.reset} title="Start over with a new file" className="rounded-sm text-[15px] font-medium tracking-[-0.03em] text-ink-strong">
            UNSPIN
          </button>
          <span
            className="min-w-0 truncate rounded-full border border-rule bg-surface px-3 py-1 font-mono text-[12px] text-ink-muted"
            title={ws.source.filename}
          >
            {ws.source.filename} · {formatBytes(ws.source.byteSize)}
          </span>
        </header>
        <main className="mx-auto flex min-h-0 w-full max-w-[1320px] flex-1 flex-col px-[clamp(14px,3vw,36px)] pt-[clamp(16px,3.5vh,36px)] pb-4">
          <div className="shrink-0">
            <p className="font-mono text-[12px] tracking-[0.14em] text-accent">FILE CONFIRMED</p>
            <h1 className="mt-2 max-w-[20ch] text-[clamp(1.75rem,3.4vw,2.9rem)] leading-[1.04] font-medium tracking-[-0.045em] text-ink-strong">
              Choose what to use.
            </h1>
            <p className="mt-2 max-w-xl text-[clamp(0.95rem,1.2vw,1.04rem)] leading-6 text-ink-muted">
              Pick the region, page, sheet, or records that matter, then press Use this selection.
            </p>
          </div>
          <div className="mt-5 flex min-h-0 flex-1 flex-col">
            <SourceSelector source={ws.source} onSelectionCreated={ws.setSelection} onReplaceSource={ws.reset} />
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink lg:h-screen lg:overflow-hidden">
      <header className="mx-auto flex w-full max-w-[1320px] shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-[clamp(14px,3vw,36px)] pt-5">
        <button type="button" onClick={ws.reset} title="Start over with a new file" className="rounded-sm text-[15px] font-medium tracking-[-0.03em] text-ink-strong">
          UNSPIN
        </button>
        <span className="min-w-0 truncate rounded-full border border-rule bg-surface px-3 py-1 font-mono text-[12px] text-ink-muted" title={ws.source.filename}>
          {ws.source.filename} · {formatBytes(ws.source.byteSize)}
        </span>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-[1320px] flex-1 flex-col px-[clamp(14px,3vw,36px)] pt-[clamp(16px,3.5vh,36px)] pb-4">
        <p className="eyebrow">SELECTION READY</p>
        <h1 className="mt-2 max-w-[22ch] text-[clamp(1.75rem,3.4vw,2.9rem)] leading-[1.04] font-medium tracking-[-0.045em] text-ink-strong">
          Import this selection.
        </h1>
        <p className="mt-2 max-w-xl text-[clamp(0.95rem,1.2vw,1.04rem)] leading-6 text-ink-muted">
          Check the stored file on the left, then import. The original is never modified.
        </p>
        <div className="mt-5 grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]">
          <Panel title="Source" className="min-h-[12rem]" bodyClassName="overflow-auto p-4 sm:p-5">
            <SourceViewer source={ws.source} selection={ws.selection} provenance={[]} activeProvenanceIds={[]} />
          </Panel>
          <div className="min-h-0 overflow-auto">
            <ExtractionLauncher
              source={ws.source}
              selection={ws.selection}
              gemini={ws.health?.capabilities.gemini ?? null}
              onDatasetReady={(id) => void ws.loadDataset(id)}
              onBackToSelection={() => ws.setSelection(null)}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function Wordmark() {
  return (
    <span className="text-[15px] font-medium tracking-[-0.03em] text-ink-strong" aria-label="UNSPIN">
      UNSPIN
    </span>
  );
}

function Frame({ children, bar, bounded = false }: { children: React.ReactNode; bar?: React.ReactNode; bounded?: boolean }) {
  const ws = useWorkspace();
  return (
    <div className={bounded ? "flex min-h-screen flex-col lg:h-screen lg:overflow-hidden" : "flex min-h-screen flex-col"}>
      <header className="flex min-h-14 items-center gap-x-4 overflow-x-auto px-[clamp(14px,3vw,36px)] py-3">
        <button type="button" onClick={ws.reset} className="rounded-sm" title="Start over with a new file">
          <Wordmark />
        </button>
        {ws.source && (
          <span className="min-w-0 truncate rounded-full border border-rule bg-surface px-3 py-1 font-mono text-[12px] text-ink-muted" title={ws.source.filename}>
            {ws.source.filename} · {formatBytes(ws.source.byteSize)}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">{bar}</div>
      </header>
      <main className={bounded ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "flex min-h-0 flex-1 flex-col"}>
        {children}
      </main>
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
    <div className="flex min-h-screen flex-1 flex-col bg-canvas text-ink">
      <main className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col px-[clamp(14px,3vw,36px)] pt-6 pb-16">
        <header className="flex items-center justify-between">
          <span className="text-[15px] font-medium tracking-[-0.03em] text-ink-strong">UNSPIN</span>
          <span className="font-mono text-[12px] tracking-[0.12em] text-ink-faint">INSPECT · CORRECT · REUSE</span>
        </header>

        <h1 className="mt-[clamp(32px,7vh,72px)] max-w-[18ch] text-[clamp(2.2rem,5vw,4.25rem)] leading-[1.02] font-medium tracking-[-0.045em] text-ink-strong">
          Bring a file. <span className="text-accent">Leave with usable data.</span>
        </h1>
        <p className="mt-4 max-w-xl text-[clamp(0.98rem,1.25vw,1.0625rem)] leading-6 text-ink-muted">
          Upload a file, choose the region that matters, check every value against its source, then export it with the history of what you changed.
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

        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[repeat(3,minmax(0,1fr))] lg:grid-rows-[auto_auto]">
          <div className="min-w-0 lg:col-span-2 lg:row-span-2">
            <UploadPanel limits={limits} onSourceCreated={ws.setSource} onDemoReady={(id) => void ws.loadDataset(id)} />
          </div>
          <BentoTile
            eyebrow="CSV · XLSX"
            title="Spreadsheets"
            body="Parsed on this server. Optional analysis may send computed facts, only after a separate confirmation."
            detail={limits ? `Up to ${limits.maxStructuredRows.toLocaleString()} rows and ${limits.maxColumns} columns per import.` : undefined}
          />
          <BentoTile
            eyebrow="PNG · JPEG · WebP · PDF"
            title="Charts and PDFs"
            body="Only the region you select is sent to Google Gemini, after you confirm. Values read from charts are marked as estimates."
            detail={
              limits
                ? `PDFs up to ${limits.maxPdfPages} pages. Images up to ${Math.round(limits.maxImagePixels / 1_000_000)} megapixels.`
                : undefined
            }
          />
          <div className="rounded-[24px] border border-rule bg-surface px-5 py-4 text-[13px] leading-5 text-ink-muted lg:col-span-3">
            {limits ? null : <span className="mr-2 text-ink-faint">Checking this server&apos;s limits…</span>}
            Legacy .xls, macro-enabled .xlsm, password-protected files, archives, and executables are refused. The file name is shown to you only; the
            type is decided from the file&apos;s contents.
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
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
      </main>
    </div>
  );
}

function BentoTile({ eyebrow, title, body, detail }: { eyebrow: string; title: string; body: string; detail?: string }) {
  return (
    <section className="flex flex-col gap-3 rounded-[24px] border border-rule bg-surface p-5 sm:p-6">
      <p className="font-mono text-[11px] tracking-[0.14em] text-accent">{eyebrow}</p>
      <h2 className="text-[1.35rem] leading-tight font-medium tracking-[-0.03em] text-ink">{title}</h2>
      <p className="text-[14px] leading-[1.5] text-ink-muted">{body}</p>
      {detail && <p className="mt-auto border-t border-rule pt-3 font-mono text-[12px] leading-5 text-ink-faint">{detail}</p>}
    </section>
  );
}

const TAB_LABEL: Record<WorkspaceTab, string> = { overview: "Overview", data: "Data", source: "Source" };
const GUTTER = "px-[clamp(16px,4vw,44px)]";
const CONTENT = `mx-auto w-full max-w-[1440px] ${GUTTER}`;
/** Height of the sticky app bar (h-14); tab bars and scroll targets sit below it. */
const APP_BAR_PX = 56;

function readLayoutTab(datasetId: string): WorkspaceTab {
  try {
    return normalizeLayout(sessionStorage.getItem(layoutStorageKey(datasetId))).tab;
  } catch {
    return "overview";
  }
}

type DrawerKind = "review" | "history" | "import";

function DatasetWorkspace() {
  const ws = useWorkspace();
  const detail = ws.detail as DatasetDetail;
  const source = ws.source!;
  const { dataset, version, versions } = detail;
  const persistence = ws.health?.capabilities.persistence;

  const [tab, setTab] = useState<WorkspaceTab>(() => readLayoutTab(dataset.id));
  const [returnTo, setReturnTo] = useState<WorkspaceTab | null>(null);
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [view, setView] = useState<GridView | null>(null);
  const [askSeed, setAskSeed] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [evidenceNote, setEvidenceNote] = useState<string | null>(null);

  const tabRef = useRef(tab);
  useLayoutEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  const scrollByTab = useRef<Record<WorkspaceTab, number>>({ overview: 0, data: 0, source: 0 });
  const pendingScroll = useRef<"restore" | "panel" | null>(null);
  const tabsAnchor = useRef<HTMLDivElement>(null);
  const tabButtons = useRef<Partial<Record<WorkspaceTab, HTMLButtonElement | null>>>({});
  const analysisRef = useRef<HTMLElement>(null);
  const uid = useId();

  useEffect(() => {
    sessionStorage.setItem(layoutStorageKey(dataset.id), serializeLayout({ version: 2, tab }));
  }, [dataset.id, tab]);

  const panelTop = useCallback(() => {
    const anchor = tabsAnchor.current;
    return anchor ? anchor.getBoundingClientRect().top + window.scrollY - APP_BAR_PX : 0;
  }, []);

  useLayoutEffect(() => {
    const mode = pendingScroll.current;
    pendingScroll.current = null;
    if (mode === "restore") window.scrollTo({ top: scrollByTab.current[tab] });
    else if (mode === "panel") window.scrollTo({ top: Math.min(window.scrollY, panelTop()) });
  }, [tab, panelTop]);

  const switchTab = useCallback((next: WorkspaceTab, opts?: { from?: WorkspaceTab; scroll?: "restore" | "panel" }) => {
    const current = tabRef.current;
    setReturnTo(opts?.from && opts.from !== next ? opts.from : null);
    if (next === current) {
      if (opts?.scroll === "panel") window.scrollTo({ top: Math.min(window.scrollY, panelTop()) });
      return;
    }
    scrollByTab.current[current] = window.scrollY;
    pendingScroll.current = opts?.scroll ?? "restore";
    setTab(next);
  }, [panelTop]);

  const showInData = useCallback(
    (event: SelectionEvent) => {
      setEvidenceNote(null);
      ws.select(event);
      switchTab("data", { from: tabRef.current, scroll: "panel" });
    },
    [ws, switchTab],
  );

  const showSource = useCallback(
    (event: SelectionEvent) => {
      const from = tabRef.current;
      setEvidenceNote(null);
      withSourceProvenance(dataset.id, event).then(
        (resolved) => {
          ws.select(resolved);
          if (resolved.provenanceIds.length === 0) setEvidenceNote("No source location is recorded for this evidence.");
          switchTab("source", { from, scroll: "panel" });
        },
        () => setEvidenceNote("The source location could not be looked up. Try again."),
      );
    },
    [dataset.id, ws, switchTab],
  );

  const askAbout = useCallback(
    (event: SelectionEvent) => {
      ws.select(event);
      setAskSeed("What stands out about the selected point compared with its series?");
      requestAnimationFrame(() => {
        analysisRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        const input = document.getElementById("ask-data");
        if (input) (input as HTMLInputElement).focus({ preventScroll: true });
      });
    },
    [ws],
  );

  const issueCount = version.unresolvedFindingCount;
  const versionIndex = versions.findIndex((v) => v.id === version.id);
  const tabs = WORKSPACE_TABS;

  const menuItems: MenuItem[] = [
    { id: "review", label: issueCount > 0 ? `Review issues (${issueCount})` : "Review and clean data", onSelect: () => setDrawer("review") },
    { id: "history", label: "Version history", hint: `${versions.length} version${versions.length === 1 ? "" : "s"}`, onSelect: () => setDrawer("history") },
    { id: "compare", label: "Compare with another dataset", onSelect: () => setCompareOpen(true) },
    { id: "import", label: "Import details", hint: "File, method, and review counts", onSelect: () => setDrawer("import") },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-30 border-b border-rule bg-canvas/90 backdrop-blur-md">
        <div className={`${CONTENT} flex h-14 items-center gap-3`}>
          <button type="button" onClick={ws.reset} className="shrink-0 rounded-sm" title="Start over with a new file">
            <Wordmark />
          </button>
          <span className="hidden min-w-0 truncate rounded-full border border-rule bg-surface px-3 py-1 font-mono text-[12px] text-ink-muted sm:inline" title={source.filename}>
            {source.filename} · {formatBytes(source.byteSize)}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {issueCount > 0 && (
              <Button className="hidden md:inline-flex" onClick={() => setDrawer("review")}>
                Review issues
                <span className="tabular rounded-full bg-estimate-soft px-1.5 text-[12px] text-estimate">{issueCount}</span>
              </Button>
            )}
            <Menu label="More" items={menuItems} />
            <Button variant="primary" onClick={() => setExportOpen(true)}>
              Export
            </Button>
          </div>
        </div>
      </header>

      <div className={`${CONTENT} pt-8 sm:pt-10`}>
        <p className="font-mono text-[12px] tracking-[0.14em] text-accent">{ws.isCurrentVersion ? "DATASET" : "EARLIER VERSION"}</p>
        <h1 className="mt-2 text-[clamp(1.75rem,3.4vw,2.9rem)] leading-[1.04] font-medium tracking-[-0.045em] break-words text-ink-strong">{dataset.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[14px] text-ink-muted">
          <span className="tabular">{version.rowCount.toLocaleString()} rows</span>
          <span aria-hidden="true">·</span>
          <span className="tabular">{version.columns.length} columns</span>
          <span aria-hidden="true">·</span>
          <span role="status">{persistence?.durable ? "Saved" : "Session only — not saved to disk"}</span>
          <span aria-hidden="true">·</span>
          <label className="sr-only" htmlFor={`${uid}-version`}>
            Version
          </label>
          <span className="inline-block w-44">
            <Select id={`${uid}-version`} className="h-8 py-0 text-[13px]" value={version.id} onChange={(e) => void ws.loadDataset(dataset.id, e.target.value)}>
              {versions.map((v, i) => (
                <option key={v.id} value={v.id}>
                  Version {i + 1}
                  {v.id === dataset.currentVersionId ? " (current)" : ""}
                </option>
              ))}
            </Select>
          </span>
          {!ws.isCurrentVersion && (
            <>
              <Badge tone="estimate">Viewing version {versionIndex + 1} · read-only</Badge>
              <Button size="sm" onClick={() => void ws.loadDataset(dataset.id)}>
                Back to current
              </Button>
            </>
          )}
        </div>
        {dataset.coverage !== "complete_selection" && (
          <div className="mt-5 max-w-4xl">
            <CandidateStatus detail={detail} onAcknowledged={(d) => ws.setDetail({ ...detail, dataset: d })} />
          </div>
        )}
      </div>

      <div ref={tabsAnchor} className="mt-6" />
      <div className="sticky top-14 z-20 border-b border-rule bg-canvas/90 backdrop-blur-md">
        <div className={`${CONTENT} flex items-center gap-4`}>
          <div role="tablist" aria-label="Workspace" className="-mb-px flex gap-1 sm:gap-4">
            {tabs.map((t) => (
              <button
                key={t}
                ref={(el) => {
                  tabButtons.current[t] = el;
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`${uid}-panel-${t}`}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => switchTab(t)}
                onKeyDown={(e) => {
                  const i = tabs.indexOf(t);
                  const next = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length] : e.key === "Home" ? tabs[0] : e.key === "End" ? tabs[tabs.length - 1] : null;
                  if (!next) return;
                  e.preventDefault();
                  switchTab(next);
                  tabButtons.current[next]?.focus();
                }}
                className={cx(
                  "h-12 border-b-2 px-3 text-[15px] font-medium transition-colors motion-safe:duration-150",
                  tab === t ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink",
                )}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
          {analysisStatus && tab !== "overview" && (
            <button type="button" className="ml-auto hidden truncate text-[13px] text-ink-muted hover:text-ink sm:block" onClick={() => switchTab("overview")}>
              AI analysis: {analysisStatus}
            </button>
          )}
        </div>
      </div>

      <main className={`${CONTENT} flex-1 pt-8 pb-20 sm:pt-10`}>
        {(returnTo || evidenceNote) && (
          <div className="mb-6 flex flex-wrap items-center gap-3 text-[14px]">
            {returnTo && (
              <Button size="sm" onClick={() => switchTab(returnTo)}>
                ← Back to {TAB_LABEL[returnTo].toLowerCase()}
              </Button>
            )}
            {returnTo && <span className="text-ink-muted">Showing the evidence you selected.</span>}
            {evidenceNote && (
              <span className="text-ink-muted" role="status">
                {evidenceNote}
              </span>
            )}
          </div>
        )}

        <section id={`${uid}-panel-overview`} role="tabpanel" aria-labelledby={`${uid}-tab-overview`} hidden={tab !== "overview"} className="flex flex-col gap-10">
          <PreparedDemoPanel sourceId={source.id} detail={detail} onOpenDataset={(id) => {
            try { sessionStorage.setItem(layoutStorageKey(id), serializeLayout({ version: 2, tab: "overview" })); } catch { /* The table still opens. */ }
            void ws.loadDataset(id);
          }} onEvidence={async (id, event) => {
            if (id === dataset.id && event.datasetVersionId === detail.version.id) { showSource(event); return; }
            try { sessionStorage.setItem(layoutStorageKey(id), serializeLayout({ version: 2, tab: "source" })); } catch { /* Live workspace still opens. */ }
            await ws.loadDataset(id, event.datasetVersionId);
            ws.select(event);
            if (id === dataset.id) switchTab("source");
          }} />
          {!dataset.description.startsWith('Prepared demo v') && <OverviewBlock
            detail={detail}
            view={view}
            sourceName={source.filename}
            onEvidence={ws.select}
            onShowInData={showInData}
            onShowSource={showSource}
            onRenameFields={ws.isCurrentVersion ? () => setDrawer("review") : undefined}
            onSuggested={setSuggested}
          />}
          <section aria-labelledby={`${uid}-chart-heading`} className="rounded-[24px] border border-rule bg-surface p-5 sm:p-6">
            <h2 id={`${uid}-chart-heading`} className="mb-4 text-[1.35rem] leading-tight font-medium tracking-[-0.03em] text-ink-strong">
              Chart
            </h2>
            <ChartPanel
              detail={detail}
              linked={ws.linked}
              visible={tab === "overview"}
              onLinkedSelect={ws.select}
              onShowInData={showInData}
              onShowSource={showSource}
              onAskSelection={askAbout}
            />
          </section>
          <section ref={analysisRef} aria-labelledby={`${uid}-ai-heading`} className="scroll-mt-32 rounded-[24px] border border-rule bg-surface p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`${uid}-ai-heading`} className="text-[1.35rem] leading-tight font-medium tracking-[-0.03em] text-ink-strong">
                AI analysis
              </h2>
              {analysisStatus && (
                <p className="text-[13px] text-ink-muted" role="status">
                  {analysisStatus}
                </p>
              )}
            </div>
            <AnalysisPanel
              detail={detail}
              view={view}
              linked={ws.linked}
              suggested={suggested}
              geminiConfigured={Boolean(ws.health?.capabilities.gemini.configured)}
              geminiModel={ws.health?.capabilities.gemini.model ?? null}
              onEvidence={ws.select}
              onShowInData={showInData}
              onShowSource={showSource}
              selectedQuestion={askSeed}
              onStatus={setAnalysisStatus}
            />
          </section>
        </section>

        <section id={`${uid}-panel-data`} role="tabpanel" aria-labelledby={`${uid}-tab-data`} hidden={tab !== "data"} className="overflow-hidden rounded-[24px] border border-rule bg-surface">
          <DataGrid
            detail={detail}
            isCurrentVersion={ws.isCurrentVersion}
            linked={ws.linked}
            visible={tab === "data"}
            onLinkedSelect={ws.select}
            onDetailChange={ws.setDetail}
            onViewChange={setView}
            onShowSource={showSource}
            onOpenCleaning={() => setDrawer("review")}
          />
        </section>

        <section id={`${uid}-panel-source`} role="tabpanel" aria-labelledby={`${uid}-tab-source`} hidden={tab !== "source"} className="rounded-[24px] border border-rule bg-surface p-5 sm:p-8">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[1.35rem] leading-tight font-medium tracking-[-0.03em] text-ink-strong">Original file</h2>
            <p className="text-[13px] text-ink-muted">
              {source.filename} · {formatBytes(source.byteSize)} · the stored file is never modified
            </p>
          </div>
          <SourceViewer
            source={source}
            selection={ws.selection}
            provenance={detail.provenance}
            activeProvenanceIds={ws.linked?.provenanceIds ?? []}
            onSourceSelect={(provenanceIds) => ws.select({ origin: "source", datasetVersionId: version.id, rowIds: [], cellIds: [], provenanceIds })}
          />
        </section>
      </main>

      <Drawer
        open={drawer === "review"}
        modal={false}
        onClose={() => setDrawer(null)}
        title={issueCount > 0 ? `Review issues (${issueCount})` : "Review and clean data"}
        description="Every change is previewed first and saved as a new version you can undo."
      >
        <QualityPanel
          detail={detail}
          isCurrentVersion={ws.isCurrentVersion}
          linked={ws.linked}
          onLinkedSelect={(event) => {
            ws.select(event);
            if (tabRef.current !== "data") switchTab("data", { scroll: "panel" });
          }}
          onDetailChange={ws.setDetail}
        />
      </Drawer>
      <Drawer open={drawer === "history"} onClose={() => setDrawer(null)} title="Version history" description="Every committed change. Restoring makes an earlier stored version current again.">
        <div className="p-5">
          <HistoryPanel
            detail={detail}
            onDetailChange={ws.setDetail}
            onViewVersion={(versionId) => {
              setDrawer(null);
              void ws.loadDataset(dataset.id, versionId);
            }}
          />
        </div>
      </Drawer>
      <Drawer open={drawer === "import"} onClose={() => setDrawer(null)} title="Import details">
        <div className="flex flex-col gap-5 p-5 text-[13px]">
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
            <dt className="text-ink-muted">File</dt>
            <dd className="break-words text-ink">{source.filename}</dd>
            <dt className="text-ink-muted">Size</dt>
            <dd className="tabular text-ink">{formatBytes(source.byteSize)}</dd>
            <dt className="text-ink-muted">SHA-256</dt>
            <dd className="font-mono text-[12px] break-all text-ink">{source.sha256}</dd>
            <dt className="text-ink-muted">Uploaded</dt>
            <dd className="text-ink">{new Date(source.createdAt).toLocaleString()}</dd>
          </dl>
          <CandidateStatus detail={detail} onAcknowledged={(d) => ws.setDetail({ ...detail, dataset: d })} />
        </div>
      </Drawer>
      <Dialog open={compareOpen} onClose={() => setCompareOpen(false)} title="Compare datasets" className="w-[min(1100px,calc(100vw-2rem))]">
        <ComparisonPanel detail={detail} />
      </Dialog>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} detail={detail} view={view} onAcknowledged={() => void ws.loadDataset(dataset.id, version.id)} />
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
