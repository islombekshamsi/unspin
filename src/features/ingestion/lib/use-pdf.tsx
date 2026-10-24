"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { openSourcePdf, PdfLoadError, renderPageToCanvas } from "./pdf-client";

export function usePdfDocument(url: string): { doc: PDFDocumentProxy | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string; doc: PDFDocumentProxy | null; error: string | null } | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    let close: (() => void) | null = null;
    openSourcePdf(url, ac.signal).then(
      (r) => {
        if (ac.signal.aborted) return r.close();
        close = r.close;
        setState({ url, doc: r.doc, error: null });
      },
      (e: unknown) => {
        if (ac.signal.aborted) return;
        setState({ url, doc: null, error: e instanceof PdfLoadError ? e.message : "The PDF could not be loaded. Check your connection and try again." });
      },
    );
    return () => {
      ac.abort();
      close?.();
    };
  }, [url]);
  const current = state?.url === url ? state : null;
  return { doc: current?.doc ?? null, error: current?.error ?? null, loading: !current };
}

/** Loads a page and reports its displayed (rotation-applied) aspect ratio. */
export function usePdfPage(doc: PDFDocumentProxy | null, pageNumber: number): { page: PDFPageProxy | null; aspect: number | null; error: string | null } {
  const [state, setState] = useState<{ key: string; page: PDFPageProxy | null; aspect: number | null; error: string | null } | null>(null);
  const key = `${doc?.fingerprints?.[0] ?? "none"}:${pageNumber}`;
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    doc.getPage(pageNumber).then(
      (page) => {
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        setState({ key, page, aspect: vp.width / vp.height, error: null });
      },
      () => {
        if (!cancelled) setState({ key, page: null, aspect: null, error: `Page ${pageNumber} could not be loaded.` });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, key]);
  const current = state?.key === key ? state : null;
  return { page: current?.page ?? null, aspect: current?.aspect ?? null, error: current?.error ?? null };
}

/** Width of an element, tracked with ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (Math.abs(prev - w) >= 2 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Canvas that renders one page to fill its parent's width. */
export function PdfCanvas({ page, label, className }: { page: PDFPageProxy; label: string; className?: string }) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const task = renderPageToCanvas(page, canvas, width);
    task.promise.then(
      () => setFailed(null),
      (e: unknown) => {
        if (e instanceof Error && e.name === "RenderingCancelledException") return;
        setFailed("This page could not be drawn.");
      },
    );
    return () => task.cancel();
  }, [page, width]);
  return (
    <div ref={wrapRef} className={className ?? "absolute inset-0"}>
      <canvas ref={canvasRef} role="img" aria-label={label} className="block h-full w-full bg-white" />
      {failed && <p className="absolute inset-x-0 top-2 text-center text-[12px] text-danger">{failed}</p>}
    </div>
  );
}
