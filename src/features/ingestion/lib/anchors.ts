import type { Provenance, Source, SourceSelection } from "@/contracts";
import { pdfBoxToDisplayRect, pixelBoxToNormalized, type NormRect, type PageFrame } from "@/server/sources/geometry";

/**
 * How a provenance record may be drawn on an image/PDF source. Only geometry that
 * actually exists is drawn; model-proposed boxes are marked as unverified hints.
 */
export type AnchorStyle = "precise" | "hint" | "region" | "page" | "label";

export interface Anchor {
  key: string;
  provenanceIds: string[];
  active: boolean;
  style: AnchorStyle;
  /** Display-normalized rect on the image/page, when a box exists. */
  rect: NormRect | null;
  pageNumber: number | null;
  text: string;
}

export const STYLE_TEXT: Record<AnchorStyle, string> = {
  precise: "source location",
  hint: "model hint (unverified)",
  region: "exact mark not located",
  page: "page only — exact location unavailable",
  label: "figure reference only",
};

function styleOf(p: Provenance): AnchorStyle {
  if (p.locatorAvailability === "page_only") return "page";
  if (p.locatorAvailability === "region_only") return "region";
  if (p.locatorAvailability === "unavailable") return "label";
  if (p.locatorOrigin === "model_hint") return "hint";
  return "precise";
}

/** Rectangle of the persisted selection on the displayed source, if it has one. */
export function selectionRect(source: Source, selection: SourceSelection | null, frame: PageFrame | null): NormRect | null {
  if (!selection) return null;
  if (selection.kind === "image_region" && source.image) {
    return pixelBoxToNormalized(selection.transform.orientedPixelBox, source.image.orientedWidth, source.image.orientedHeight);
  }
  if (selection.kind === "pdf_region" && frame) return pdfBoxToDisplayRect(frame, selection.transform.pdfBox);
  return null;
}

/**
 * Groups image/PDF provenance into drawable anchors. `frameFor` supplies the
 * unrotated view box and rotation of a PDF page when it is loaded.
 */
export function buildAnchors(
  source: Source,
  selection: SourceSelection | null,
  provenance: Provenance[],
  active: Set<string>,
  frameFor: (pageNumber: number) => PageFrame | null,
  includeInactive: boolean,
): Anchor[] {
  const groups = new Map<string, Anchor>();
  for (const p of provenance) {
    const isActive = active.has(p.id);
    if (!isActive && !includeInactive) continue;
    if (p.sourceId !== source.id) continue;
    const style = styleOf(p);
    const loc = p.locator;
    let rect: NormRect | null = null;
    let pageNumber: number | null = null;
    if (loc.type === "image_box" && source.image) {
      rect = pixelBoxToNormalized(loc.box, source.image.orientedWidth, source.image.orientedHeight);
    } else if (loc.type === "pdf_box") {
      pageNumber = loc.pageNumber;
      const frame = frameFor(loc.pageNumber);
      if (frame) rect = pdfBoxToDisplayRect(frame, loc.box);
    } else if (loc.type === "pdf_page") {
      pageNumber = loc.pageNumber;
    } else if (loc.type === "figure_label") {
      pageNumber = loc.pageNumber;
    } else {
      continue;
    }
    if (style === "region" && !rect) {
      rect = selection?.kind === "pdf_region" ? selectionRect(source, selection, frameFor(selection.pageNumber)) : selectionRect(source, selection, null);
      if (selection?.kind === "pdf_region") pageNumber ??= selection.pageNumber;
    }
    if (style === "page" || style === "label") rect = null;
    const key = `${style}|${pageNumber ?? ""}|${rect ? [rect.x, rect.y, rect.width, rect.height].map((v) => v.toFixed(5)).join(",") : loc.type === "figure_label" ? loc.label : "none"}`;
    const g = groups.get(key);
    if (g) {
      g.provenanceIds.push(p.id);
      g.active ||= isActive;
    } else {
      groups.set(key, {
        key,
        provenanceIds: [p.id],
        active: isActive,
        style,
        rect,
        pageNumber,
        text: loc.type === "figure_label" ? `${STYLE_TEXT[style]}: ${loc.label}` : STYLE_TEXT[style],
      });
    }
  }
  return [...groups.values()];
}
