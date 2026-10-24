import { existsSync } from "node:fs";
import path from "node:path";
import { AppError, type PdfTransform } from "@/contracts";
import { LIMITS } from "@/server/config/limits";
import {
  chooseRenderScale,
  displayRectToPdfBox,
  displayedPageSize,
  normalizeRotation,
  WHOLE,
  type NormRect,
  type PageFrame,
} from "./geometry";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

/** Preferred raster density for extraction: 200 DPI (pixels per PDF point = 200/72). */
const PREFERRED_RENDER_SCALE = 200 / 72;

let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * Loads the pdf.js legacy build for Node. The worker module is imported on the
 * main thread (pdf.js "fake worker" via globalThis.pdfjsWorker) so no worker file
 * has to be resolved at runtime by path; DOMMatrix/Path2D come from @napi-rs/canvas.
 */
async function loadPdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const canvas = await import("@napi-rs/canvas");
    const g = globalThis as unknown as Record<string, unknown>;
    g.DOMMatrix ??= canvas.DOMMatrix;
    g.Path2D ??= canvas.Path2D;
    g.ImageData ??= canvas.ImageData;
    g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })();
  try {
    return await pdfjsPromise;
  } catch (e) {
    pdfjsPromise = null;
    throw e;
  }
}

function pdfjsAssetDir(sub: "standard_fonts" | "cmaps"): string | undefined {
  const dir = path.join(process.cwd(), "node_modules", "pdfjs-dist", sub);
  return existsSync(dir) ? dir + path.sep : undefined;
}

async function openPdf(bytes: Uint8Array): Promise<{ doc: PdfDocument; close: () => Promise<void> }> {
  const pdfjs = await loadPdfjs();
  const standardFontDataUrl = pdfjsAssetDir("standard_fonts");
  const cMapUrl = pdfjsAssetDir("cmaps");
  const task = pdfjs.getDocument({
    // pdf.js may transfer (detach) the buffer it receives; always pass a copy.
    data: new Uint8Array(bytes),
    disableFontFace: true,
    enableXfa: false,
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
    ...(cMapUrl ? { cMapUrl, cMapPacked: true } : {}),
  });
  try {
    const doc = await task.promise;
    return { doc, close: () => task.destroy().catch(() => undefined) };
  } catch (e) {
    await task.destroy().catch(() => undefined);
    const name = e instanceof Error ? e.name : "";
    if (name === "PasswordException") {
      throw new AppError("encrypted_file", "This PDF is password-protected. Remove the password and upload it again.");
    }
    throw new AppError("unreadable_source", "The PDF could not be opened. It may be damaged or not a valid PDF.");
  }
}

export async function withPdf<T>(bytes: Uint8Array, fn: (doc: PdfDocument) => Promise<T>): Promise<T> {
  const { doc, close } = await openPdf(bytes);
  try {
    return await fn(doc);
  } finally {
    await close();
  }
}

export function pageFrame(page: PdfPage): PageFrame & { userUnit: number } {
  const [a, b, c, d] = page.view;
  return {
    view: [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)],
    rotation: normalizeRotation(page.rotate),
    userUnit: page.userUnit || 1,
  };
}

/**
 * Resolves the render plan for a selected page region: chooses a scale under
 * LIMITS.pdfRenderMaxPixels, snaps the region to whole output pixels, and records the
 * PDF user-space box of exactly what will be rendered.
 */
export function planPdfRegion(frame: PageFrame, region: NormRect | null): {
  transform: PdfTransform;
  pixelBox: { left: number; top: number; width: number; height: number };
  snapped: NormRect;
} {
  const r = region ?? WHOLE;
  const page = displayedPageSize(frame);
  let { scale } = chooseRenderScale({ width: r.width * page.width, height: r.height * page.height }, PREFERRED_RENDER_SCALE, LIMITS.pdfRenderMaxPixels);
  for (;;) {
    const fullW = page.width * scale;
    const fullH = page.height * scale;
    const maxX = Math.max(1, Math.floor(fullW));
    const maxY = Math.max(1, Math.floor(fullH));
    const left = Math.min(Math.round(r.x * fullW), maxX - 1);
    const top = Math.min(Math.round(r.y * fullH), maxY - 1);
    const right = Math.max(left + 1, Math.min(Math.round((r.x + r.width) * fullW), maxX));
    const bottom = Math.max(top + 1, Math.min(Math.round((r.y + r.height) * fullH), maxY));
    const width = right - left;
    const height = bottom - top;
    if (width * height > LIMITS.pdfRenderMaxPixels) {
      scale *= 0.99;
      continue;
    }
    const snapped: NormRect = { x: left / fullW, y: top / fullH, width: width / fullW, height: height / fullH };
    const pdfBox = displayRectToPdfBox(frame, snapped);
    return {
      transform: {
        page: { widthPt: frame.view[2] - frame.view[0], heightPt: frame.view[3] - frame.view[1], rotation: frame.rotation },
        pdfBox,
        renderScale: scale,
        renderedPixelSize: { width, height },
      },
      pixelBox: { left, top, width, height },
      snapped,
    };
  }
}

/** Renders only the planned region of one page to PNG with pdf.js + @napi-rs/canvas. */
export async function renderPdfRegion(
  bytes: Uint8Array,
  pageNumber: number,
  region: NormRect | null,
): Promise<{ png: Uint8Array; width: number; height: number; transform: PdfTransform; snapped: NormRect; frame: PageFrame }> {
  return withPdf(bytes, async (doc) => {
    if (pageNumber < 1 || pageNumber > doc.numPages) throw new AppError("invalid_selection", "The selected page does not exist in this PDF.");
    const page = await doc.getPage(pageNumber);
    const frame = pageFrame(page);
    const plan = planPdfRegion(frame, region);
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(plan.pixelBox.width, plan.pixelBox.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, plan.pixelBox.width, plan.pixelBox.height);
    const viewport = page.getViewport({
      scale: (plan.transform.renderScale ?? 1) / frame.userUnit,
      offsetX: -plan.pixelBox.left,
      offsetY: -plan.pixelBox.top,
    });
    try {
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
    } catch {
      throw new AppError("unreadable_source", "The selected PDF page could not be rendered.");
    } finally {
      page.cleanup();
    }
    const png = await canvas.encode("png");
    return {
      png: new Uint8Array(png.buffer, png.byteOffset, png.byteLength),
      width: plan.pixelBox.width,
      height: plan.pixelBox.height,
      transform: plan.transform,
      snapped: plan.snapped,
      frame,
    };
  });
}
