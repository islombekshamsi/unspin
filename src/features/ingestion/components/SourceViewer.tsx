"use client";

import { useMemo, useState } from "react";
import type { Provenance } from "@/contracts";
import { Badge, Button, ErrorState, UnavailableNote } from "@/components/ui";
import type { SourceViewerProps } from "@/features/workspace/seams";
import { api } from "@/lib/api/client";
import { normalizeRotation, type NormRect, type PageFrame } from "@/server/sources/geometry";
import { buildAnchors, selectionRect, type Anchor } from "../lib/anchors";
import { PdfCanvas, usePdfDocument, usePdfPage } from "../lib/use-pdf";
import { StructuredRecordView } from "./StructuredRecordView";

const MAX_DRAWN = 400;

export function SourceViewer({ source, selection, provenance, activeProvenanceIds, onSourceSelect }: SourceViewerProps) {
  if (source.kind === "csv" || source.kind === "xlsx") {
    return <StructuredRecordView source={source} selection={selection} provenance={provenance} activeProvenanceIds={activeProvenanceIds} onSourceSelect={onSourceSelect} />;
  }
  if (source.kind === "image") return <ImageView source={source} selection={selection} provenance={provenance} activeProvenanceIds={activeProvenanceIds} onSourceSelect={onSourceSelect} />;
  return <PdfView source={source} selection={selection} provenance={provenance} activeProvenanceIds={activeProvenanceIds} onSourceSelect={onSourceSelect} />;
}

function useActiveSet(ids: string[]) {
  const key = ids.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Set(ids), [key]);
}

function ImageView({ source, selection, provenance, activeProvenanceIds, onSourceSelect }: SourceViewerProps) {
  const info = source.image!;
  const active = useActiveSet(activeProvenanceIds);
  const [showAll, setShowAll] = useState(false);
  const [failed, setFailed] = useState(false);
  const anchors = useMemo(() => buildAnchors(source, selection, provenance, active, () => null, showAll), [source, selection, provenance, active, showAll]);
  const sel = selectionRect(source, selection, null);
  return (
    <div className="flex flex-col gap-2">
      <ViewerToolbar anchors={anchors} provenanceCount={provenance.length} showAll={showAll} onShowAll={setShowAll} />
      {failed ? (
        <ErrorState title="The image could not be displayed" message="The stored source file could not be loaded." />
      ) : (
        <div
          className="relative mx-auto w-full overflow-hidden rounded-md border border-rule bg-sunken"
          style={{ aspectRatio: String(info.orientedWidth / info.orientedHeight), maxWidth: `min(100%, calc(70vh * ${info.orientedWidth / info.orientedHeight}))` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- authorized private blob */}
          <img
            src={api.sourceContentUrl(source.id)}
            alt={`Source image ${source.filename}`}
            className="absolute inset-0 h-full w-full object-fill"
            style={{ imageOrientation: "from-image" }}
            onError={() => setFailed(true)}
          />
          <Overlay selection={sel} anchors={anchors} onSourceSelect={onSourceSelect} />
        </div>
      )}
      <AnchorList anchors={anchors} onSourceSelect={onSourceSelect} />
    </div>
  );
}

function PdfView({ source, selection, provenance, activeProvenanceIds, onSourceSelect }: SourceViewerProps) {
  const { doc, error, loading } = usePdfDocument(api.sourceContentUrl(source.id));
  const active = useActiveSet(activeProvenanceIds);
  const [showAll, setShowAll] = useState(false);
  const activeKey = activeProvenanceIds.join(",");
  const activePage = useMemo(() => firstActivePage(provenance, active), [provenance, active]);
  const basePage = activePage ?? (selection?.kind === "pdf_region" ? selection.pageNumber : 1);
  const [manual, setManual] = useState<{ key: string; page: number } | null>(null);
  const pageNumber = manual?.key === activeKey ? manual.page : basePage;
  const pageCount = doc?.numPages ?? source.pageCount ?? 1;
  const { page, aspect, error: pageError } = usePdfPage(doc, pageNumber);
  const frame: PageFrame | null = page ? frameOf(page.view, page.rotate) : null;
  const anchors = useMemo(
    () => buildAnchors(source, selection, provenance, active, (n) => (n === pageNumber ? frame : null), showAll),
    // frame is derived from page; page identity covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, selection, provenance, active, showAll, pageNumber, page],
  );
  const onPage = anchors.filter((a) => a.pageNumber === null || a.pageNumber === pageNumber);
  const sel = selection?.kind === "pdf_region" && selection.pageNumber === pageNumber ? selectionRect(source, selection, frame) : null;
  const go = (n: number) => setManual({ key: activeKey, page: Math.min(pageCount, Math.max(1, n)) });

  return (
    <div className="flex flex-col gap-2">
      <ViewerToolbar anchors={anchors} provenanceCount={provenance.length} showAll={showAll} onShowAll={setShowAll}>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => go(pageNumber - 1)} disabled={pageNumber <= 1} aria-label="Previous page">
            ‹
          </Button>
          <span className="tabular text-[12px] text-ink-muted" aria-live="polite">
            Page {pageNumber} of {pageCount}
          </span>
          <Button size="sm" variant="ghost" onClick={() => go(pageNumber + 1)} disabled={pageNumber >= pageCount} aria-label="Next page">
            ›
          </Button>
          {selection?.kind === "pdf_region" && pageNumber !== selection.pageNumber && (
            <Button size="sm" variant="ghost" onClick={() => go(selection.pageNumber)}>
              Go to selected page
            </Button>
          )}
        </div>
      </ViewerToolbar>
      {error && <ErrorState title="The PDF could not be displayed" message={error} />}
      {pageError && <ErrorState title="Page unavailable" message={pageError} />}
      {loading && (
        <p className="text-[13px] text-ink-muted" role="status">
          Loading PDF…
        </p>
      )}
      {page && aspect && (
        <div className="relative mx-auto w-full overflow-hidden rounded-md border border-rule bg-white" style={{ aspectRatio: String(aspect), maxWidth: `min(100%, calc(70vh * ${aspect}))` }}>
          <PdfCanvas page={page} label={`Page ${pageNumber} of ${source.filename}`} />
          <Overlay selection={sel} anchors={onPage} onSourceSelect={onSourceSelect} />
        </div>
      )}
      <AnchorList anchors={anchors} onSourceSelect={onSourceSelect} currentPage={pageNumber} onGoToPage={go} />
    </div>
  );
}

function frameOf(view: number[], rotate: number): PageFrame {
  const [a, b, c, d] = view;
  return { view: [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)], rotation: normalizeRotation(rotate) };
}

function firstActivePage(provenance: Provenance[], active: Set<string>): number | null {
  if (active.size === 0) return null;
  for (const p of provenance) {
    if (!active.has(p.id)) continue;
    const l = p.locator;
    if (l.type === "pdf_box" || l.type === "pdf_page") return l.pageNumber;
    if (l.type === "figure_label" && l.pageNumber) return l.pageNumber;
  }
  return null;
}

function ViewerToolbar({
  anchors,
  provenanceCount,
  showAll,
  onShowAll,
  children,
}: {
  anchors: Anchor[];
  provenanceCount: number;
  showAll: boolean;
  onShowAll: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  const activeCount = anchors.filter((a) => a.active).length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {children ?? <span />}
      <div className="flex items-center gap-3 text-[12px] text-ink-muted">
        {activeCount > 0 && <span aria-live="polite">{activeCount === 1 ? "1 linked reference" : `${activeCount} linked references`}</span>}
        {provenanceCount > 0 && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showAll} onChange={(e) => onShowAll(e.target.checked)} className="accent-[var(--accent)]" />
            Show all source marks
          </label>
        )}
      </div>
    </div>
  );
}

/** Selection outline plus anchors. Only real geometry is drawn; styles differ by certainty, not only by color. */
function Overlay({ selection, anchors, onSourceSelect }: { selection: NormRect | null; anchors: Anchor[]; onSourceSelect?: (ids: string[]) => void }) {
  const drawn = anchors.filter((a) => a.rect).sort((a, b) => Number(a.active) - Number(b.active)).slice(-MAX_DRAWN);
  return (
    <div className="pointer-events-none absolute inset-0">
      {selection && (
        <div
          aria-hidden="true"
          className="absolute border-2 border-accent/70"
          style={{ ...pos(selection), boxShadow: "0 0 0 9999px rgba(27, 26, 23, 0.18)" }}
        >
          <span className="absolute top-0 left-0 rounded-br-sm bg-accent px-1 text-[10px] leading-4 text-accent-ink">Selected region</span>
        </div>
      )}
      {drawn.map((a) => {
        const border = a.style === "precise" ? "border-solid" : a.style === "hint" ? "border-dashed" : "border-dotted";
        const tone = a.active ? (a.style === "precise" ? "border-accent bg-accent/15" : "border-estimate bg-estimate-soft/40") : "border-ink-faint/70";
        const label = `${a.active ? "Linked: " : ""}${a.text}`;
        return (
          <button
            key={a.key}
            type="button"
            title={label}
            aria-label={label}
            onClick={() => onSourceSelect?.(a.provenanceIds)}
            disabled={!onSourceSelect}
            className={`pointer-events-auto absolute border-2 ${border} ${tone} ${a.active ? "z-10" : ""}`}
            style={pos(a.rect!)}
          >
            {a.active && a.style !== "precise" && (
              <span className="absolute top-full left-0 mt-0.5 rounded-sm bg-estimate-soft px-1 text-[10px] leading-4 whitespace-nowrap text-estimate">{a.text}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function pos(r: NormRect): React.CSSProperties {
  return { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${Math.max(r.width * 100, 0.4)}%`, height: `${Math.max(r.height * 100, 0.4)}%` };
}

/** Text alternative for anchors, including page-only and figure-label references that have no box. */
function AnchorList({
  anchors,
  onSourceSelect,
  currentPage,
  onGoToPage,
}: {
  anchors: Anchor[];
  onSourceSelect?: (ids: string[]) => void;
  currentPage?: number;
  onGoToPage?: (n: number) => void;
}) {
  const act = anchors.filter((a) => a.active);
  if (act.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-[12px]" aria-label="Linked source references">
      {act.slice(0, 20).map((a) => (
        <li key={a.key} className="flex flex-wrap items-center gap-2">
          <Badge tone={a.style === "precise" ? "accent" : "estimate"}>{a.style === "precise" ? "located" : a.style === "hint" ? "hint" : a.style === "region" ? "region only" : "page only"}</Badge>
          <span className="text-ink-muted">
            {a.pageNumber ? `Page ${a.pageNumber} · ` : ""}
            {a.text}
            {a.provenanceIds.length > 1 ? ` · ${a.provenanceIds.length} values` : ""}
          </span>
          {a.pageNumber && onGoToPage && a.pageNumber !== currentPage && (
            <Button size="sm" variant="ghost" onClick={() => onGoToPage(a.pageNumber!)}>
              Go to page {a.pageNumber}
            </Button>
          )}
          {!a.rect && onSourceSelect && (
            <Button size="sm" variant="ghost" onClick={() => onSourceSelect(a.provenanceIds)}>
              Select
            </Button>
          )}
        </li>
      ))}
      {act.length > 20 && <li className="text-ink-faint">…and {act.length - 20} more</li>}
      {act.some((a) => a.style === "hint") && (
        <li>
          <UnavailableNote>Dashed boxes are positions proposed by the model. They have not been verified against the source geometry.</UnavailableNote>
        </li>
      )}
    </ul>
  );
}
