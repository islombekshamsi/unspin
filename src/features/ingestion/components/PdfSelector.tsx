"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Source } from "@/contracts";
import { ErrorState, NumericInput } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { NormRect } from "@/server/sources/geometry";
import { PdfCanvas, usePdfDocument, usePdfPage } from "../lib/use-pdf";
import { RegionSelector } from "./RegionSelector";
import { cleanHint, SelectionFooter, type SubmitState } from "./SourceSelector";

export function PdfSelector({ source, state }: { source: Source; state: SubmitState }) {
  const { doc, error, loading } = usePdfDocument(api.sourceContentUrl(source.id));
  const pageCount = doc?.numPages ?? source.pageCount ?? 0;
  const [pageNumber, setPageNumber] = useState(1);
  const [region, setRegion] = useState<NormRect | null>(null);
  const [hint, setHint] = useState("");
  const [pageInput, setPageInput] = useState<string | null>(null);
  const { page, aspect, error: pageError } = usePdfPage(doc, pageNumber);

  const choosePage = (n: number) => {
    if (n < 1 || n > pageCount || n === pageNumber) return;
    setPageNumber(n);
    setRegion(null);
  };
  const isWhole = region && region.x === 0 && region.y === 0 && region.width === 1 && region.height === 1;

  return (
    <div>
      {error && <ErrorState title="The PDF could not be displayed" message={error} />}
      {loading && (
        <p className="text-[13px] text-ink-muted" role="status">
          Loading pages…
        </p>
      )}
      {doc && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(8rem,11rem)_minmax(0,1fr)]">
          <nav aria-label="Pages" className="order-2 md:order-1">
            <div className="mb-2 flex items-end gap-2">
              <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
                Page
                <NumericInput
                  className="w-20"
                  value={pageInput ?? String(pageNumber)}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={() => {
                    if (pageInput !== null) choosePage(Number(pageInput));
                    setPageInput(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      choosePage(Number(pageInput ?? pageNumber));
                      setPageInput(null);
                    }
                  }}
                />
              </label>
              <span className="pb-2 text-[12px] text-ink-muted">of {pageCount}</span>
            </div>
            <ol className="flex max-h-[24rem] gap-2 overflow-auto pb-1 md:max-h-[70vh] md:flex-col">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <li key={n} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => choosePage(n)}
                    aria-current={n === pageNumber ? "page" : undefined}
                    aria-label={`Page ${n}`}
                    className={`block w-24 rounded-md border-2 p-1 text-left md:w-full ${n === pageNumber ? "border-accent" : "border-transparent hover:border-rule-strong"}`}
                  >
                    <Thumbnail doc={doc} pageNumber={n} />
                    <span className="tabular mt-1 block text-center text-[11px] text-ink-muted">{n}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <div className="order-1 min-w-0 md:order-2">
            {pageError && <ErrorState title="Page unavailable" message={pageError} />}
            {page && aspect && (
              <RegionSelector
                key={pageNumber}
                aspect={aspect}
                value={region}
                onChange={setRegion}
                wholeLabel="Whole page"
                surfaceLabel={`Region selection on page ${pageNumber}`}
              >
                <PdfCanvas page={page} label={`Page ${pageNumber} of ${source.filename}`} />
              </RegionSelector>
            )}
          </div>
        </div>
      )}
      <SelectionFooter
        scope={
          region
            ? isWhole
              ? `Only page ${pageNumber} is processed. Other pages are ignored.`
              : `Only the selected region of page ${pageNumber} is processed. The rest of the page and other pages are ignored.`
            : "Choose one page, then a region on it."
        }
        disclosure="When you start extraction (after a separate confirmation), the server renders just this region to an image and sends only that image to Google Gemini."
        hint={hint}
        onHintChange={setHint}
        canSubmit={!!doc && !!region && !state.submitting}
        disabledReason={region ? undefined : "Select a region or choose “Whole page”."}
        onSubmit={() =>
          region && void state.submit({ kind: "pdf_region", pageNumber, region: isWhole ? null : region, userHint: cleanHint(hint) })
        }
        state={state}
      />
    </div>
  );
}

/** Page thumbnail rendered only once it scrolls into view. */
function Thumbnail({ doc, pageNumber }: { doc: PDFDocumentProxy; pageNumber: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const { page, aspect } = usePdfPage(visible ? doc : null, pageNumber);
  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded-sm border border-rule bg-white" style={{ aspectRatio: String(aspect ?? 0.77) }}>
      {page && <PdfCanvas page={page} label={`Thumbnail of page ${pageNumber}`} />}
    </div>
  );
}
