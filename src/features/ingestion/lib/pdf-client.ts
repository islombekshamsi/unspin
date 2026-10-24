"use client";

import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * Lazily loads pdf.js with its version-matched worker bundled from node_modules
 * (self-hosted; nothing is fetched from a CDN).
 */
export function loadPdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    }
    return pdfjs;
  });
  pdfjsPromise.catch(() => {
    pdfjsPromise = null;
  });
  return pdfjsPromise;
}

export class PdfLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfLoadError";
  }
}

/** Fetches the authorized source bytes and opens them with pdf.js. */
export async function openSourcePdf(url: string, signal: AbortSignal): Promise<{ doc: PDFDocumentProxy; close: () => void }> {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store", signal });
  if (!res.ok) throw new PdfLoadError(res.status === 404 ? "The stored PDF is no longer available." : `The PDF could not be loaded (${res.status}).`);
  const data = new Uint8Array(await res.arrayBuffer());
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data });
  signal.addEventListener("abort", () => void task.destroy(), { once: true });
  try {
    const doc = await task.promise;
    return { doc, close: () => void task.destroy() };
  } catch {
    void task.destroy();
    throw new PdfLoadError("The PDF could not be displayed in the browser.");
  }
}

/**
 * Renders a page (with its own /Rotate applied) into a canvas sized to cssWidth.
 * Returns the render task so callers can cancel on unmount.
 */
export function renderPageToCanvas(page: PDFPageProxy, canvas: HTMLCanvasElement, cssWidth: number): RenderTask {
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const viewport = page.getViewport({ scale });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
  canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  return page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
}
