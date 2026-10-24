/**
 * Pure coordinate math shared by the server (selection resolution, crops,
 * provenance mapping) and the browser (drawing anchors). No Node or DOM imports.
 *
 * Conventions:
 *  - Normalized rects are top-left based, in [0,1], measured on the displayed
 *    source: the EXIF-oriented image, or the PDF page after its /Rotate is applied.
 *  - Pixel boxes are integer boxes in oriented source pixels.
 *  - PDF boxes are in unrotated PDF user space (origin bottom-left, y up), the
 *    same space as the page's view box.
 */

export interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelBoxLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfBoxLike {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type PdfRotation = 0 | 90 | 180 | 270;

/** Unrotated page geometry: the view box [x0, y0, x1, y1] and the page /Rotate. */
export interface PageFrame {
  view: [number, number, number, number];
  rotation: PdfRotation;
}

const EPS = 1e-9;

export function normalizeRotation(deg: number): PdfRotation {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return r as PdfRotation;
}

export function isValidNormRect(r: NormRect): boolean {
  return (
    [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
    r.x >= -EPS &&
    r.y >= -EPS &&
    r.width > 0 &&
    r.height > 0 &&
    r.x + r.width <= 1 + EPS &&
    r.y + r.height <= 1 + EPS
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Normalized rect → integer pixel box. Edges are rounded independently so that
 * adjacent selections tile without gaps; the result is at least 1×1 and inside bounds.
 */
export function normalizedToPixelBox(r: NormRect, width: number, height: number): PixelBoxLike {
  const left = clamp(Math.round(r.x * width), 0, width - 1);
  const top = clamp(Math.round(r.y * height), 0, height - 1);
  const right = clamp(Math.round((r.x + r.width) * width), left + 1, width);
  const bottom = clamp(Math.round((r.y + r.height) * height), top + 1, height);
  return { left, top, width: right - left, height: bottom - top };
}

export function pixelBoxToNormalized(b: PixelBoxLike, width: number, height: number): NormRect {
  return { x: b.left / width, y: b.top / height, width: b.width / width, height: b.height / height };
}

/**
 * Maps a normalized box inside a crop (the image that was sent) back to the
 * enclosing pixel box in oriented source pixels. Floors the near edges and
 * ceils the far edges so the mapped box never shrinks below the proposed area.
 */
export function mapNormalizedWithinPixelBox(box: NormRect, crop: PixelBoxLike): PixelBoxLike | null {
  if (!isValidNormRect(box)) return null;
  const l = crop.left + box.x * crop.width;
  const t = crop.top + box.y * crop.height;
  const r = crop.left + (box.x + box.width) * crop.width;
  const b = crop.top + (box.y + box.height) * crop.height;
  const left = clamp(Math.floor(l + EPS), crop.left, crop.left + crop.width - 1);
  const top = clamp(Math.floor(t + EPS), crop.top, crop.top + crop.height - 1);
  const right = clamp(Math.ceil(r - EPS), left + 1, crop.left + crop.width);
  const bottom = clamp(Math.ceil(b - EPS), top + 1, crop.top + crop.height);
  return { left, top, width: right - left, height: bottom - top };
}

/** Size of the displayed (rotated) page in points. */
export function displayedPageSize(frame: PageFrame): { width: number; height: number } {
  const w = frame.view[2] - frame.view[0];
  const h = frame.view[3] - frame.view[1];
  return frame.rotation === 90 || frame.rotation === 270 ? { width: h, height: w } : { width: w, height: h };
}

/**
 * A point on the displayed page (normalized, top-left origin) → PDF user space.
 * Matches pdf.js PageViewport for the page's own rotation.
 */
export function displayPointToPdf(frame: PageFrame, u: number, v: number): { x: number; y: number } {
  const [vx0, vy0, vx1, vy1] = frame.view;
  const W = vx1 - vx0;
  const H = vy1 - vy0;
  switch (frame.rotation) {
    case 0:
      return { x: vx0 + u * W, y: vy1 - v * H };
    case 90:
      return { x: vx0 + v * W, y: vy0 + u * H };
    case 180:
      return { x: vx1 - u * W, y: vy0 + v * H };
    case 270:
      return { x: vx1 - v * W, y: vy1 - u * H };
  }
}

/** Inverse of displayPointToPdf. */
export function pdfPointToDisplay(frame: PageFrame, x: number, y: number): { u: number; v: number } {
  const [vx0, vy0, vx1, vy1] = frame.view;
  const W = vx1 - vx0;
  const H = vy1 - vy0;
  switch (frame.rotation) {
    case 0:
      return { u: (x - vx0) / W, v: (vy1 - y) / H };
    case 90:
      return { u: (y - vy0) / H, v: (x - vx0) / W };
    case 180:
      return { u: (vx1 - x) / W, v: (y - vy0) / H };
    case 270:
      return { u: (vy1 - y) / H, v: (vx1 - x) / W };
  }
}

/** Normalized rect on the displayed page → box in unrotated PDF user space (x0<x1, y0<y1). */
export function displayRectToPdfBox(frame: PageFrame, r: NormRect): PdfBoxLike {
  const a = displayPointToPdf(frame, r.x, r.y);
  const b = displayPointToPdf(frame, r.x + r.width, r.y + r.height);
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

/** PDF user-space box → normalized rect on the displayed page. */
export function pdfBoxToDisplayRect(frame: PageFrame, box: PdfBoxLike): NormRect {
  const a = pdfPointToDisplay(frame, box.x0, box.y0);
  const b = pdfPointToDisplay(frame, box.x1, box.y1);
  const x = Math.min(a.u, b.u);
  const y = Math.min(a.v, b.v);
  return { x, y, width: Math.abs(a.u - b.u), height: Math.abs(a.v - b.v) };
}

/** Maps a normalized box inside a selected page region back to normalized page coordinates. */
export function composeNormalized(outer: NormRect, inner: NormRect): NormRect {
  return {
    x: outer.x + inner.x * outer.width,
    y: outer.y + inner.y * outer.height,
    width: inner.width * outer.width,
    height: inner.height * outer.height,
  };
}

export const WHOLE: NormRect = { x: 0, y: 0, width: 1, height: 1 };

/**
 * Raster scale (pixels per PDF point) for a region of `regionPt` points:
 * the preferred scale unless that would exceed maxPixels.
 */
export function chooseRenderScale(
  regionPt: { width: number; height: number },
  preferredScale: number,
  maxPixels: number,
): { scale: number; width: number; height: number } {
  const area = regionPt.width * regionPt.height;
  let scale = preferredScale;
  if (area * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / area);
  let width = Math.max(1, Math.floor(regionPt.width * scale));
  let height = Math.max(1, Math.floor(regionPt.height * scale));
  while (width * height > maxPixels) {
    scale *= 0.99;
    width = Math.max(1, Math.floor(regionPt.width * scale));
    height = Math.max(1, Math.floor(regionPt.height * scale));
  }
  return { scale, width, height };
}
