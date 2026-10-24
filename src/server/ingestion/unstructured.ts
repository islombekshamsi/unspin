import {
  AppError,
  type ExtractionInput,
  type Locator,
  type ResolvedSelection,
  type SelectionInput,
  type Source,
  type SourceSelection,
} from "@/contracts";
import {
  composeNormalized,
  displayRectToPdfBox,
  isValidNormRect,
  mapNormalizedWithinPixelBox,
  normalizedToPixelBox,
  type NormRect,
  type PageFrame,
} from "@/server/sources/geometry";
import { cropOrientedRegion } from "@/server/sources/image";
import { pageFrame, planPdfRegion, renderPdfRegion, withPdf } from "@/server/sources/pdf";

type ImageInput = Extract<SelectionInput, { kind: "image_region" }>;
type PdfInput = Extract<SelectionInput, { kind: "pdf_region" }>;

function requireRegion(r: NormRect): void {
  if (!isValidNormRect(r)) throw new AppError("invalid_selection", "The selected region must lie inside the source.");
}

export function resolveImageSelection(source: Source, input: ImageInput): ResolvedSelection {
  const info = source.image;
  if (source.kind !== "image" || !info) throw new AppError("invalid_selection", "This source is not an image.");
  requireRegion(input.region);
  const orientedPixelBox = normalizedToPixelBox(input.region, info.orientedWidth, info.orientedHeight);
  return {
    kind: "image_region",
    sourceId: source.id,
    region: input.region,
    userHint: input.userHint,
    transform: {
      originalWidth: info.originalWidth,
      originalHeight: info.originalHeight,
      exifOrientation: info.exifOrientation,
      orientedWidth: info.orientedWidth,
      orientedHeight: info.orientedHeight,
      orientedPixelBox,
    },
  };
}

export async function resolvePdfSelection(source: Source, bytes: Uint8Array, input: PdfInput): Promise<ResolvedSelection> {
  if (source.kind !== "pdf") throw new AppError("invalid_selection", "This source is not a PDF.");
  if (input.region) requireRegion(input.region);
  return withPdf(bytes, async (doc) => {
    if (input.pageNumber > doc.numPages) {
      throw new AppError("invalid_selection", `Page ${input.pageNumber} does not exist; the PDF has ${doc.numPages} page${doc.numPages === 1 ? "" : "s"}.`);
    }
    const page = await doc.getPage(input.pageNumber);
    const frame = pageFrame(page);
    page.cleanup();
    const plan = planPdfRegion(frame, input.region);
    return {
      kind: "pdf_region",
      sourceId: source.id,
      pageNumber: input.pageNumber,
      region: input.region,
      userHint: input.userHint,
      transform: plan.transform,
    };
  });
}

export async function prepareUnstructuredInput(source: Source, bytes: Uint8Array, selection: SourceSelection): Promise<ExtractionInput> {
  if (selection.kind === "image_region") {
    if (source.kind !== "image") throw new AppError("invalid_selection", "The selection does not match the source type.");
    const box = selection.transform.orientedPixelBox;
    const { png, width, height } = await cropOrientedRegion(bytes, box);
    const regionLocator: Locator = { type: "image_box", coordinateSystem: "oriented_source_pixels", box };
    return {
      mimeType: "image/png",
      bytes: png,
      disclosure: "selected_image_region",
      pageHint: null,
      pixelSize: { width, height },
      regionLocator,
      mapSentBoxToSource: (b) => {
        const mapped = mapNormalizedWithinPixelBox(b, box);
        return mapped ? { type: "image_box", coordinateSystem: "oriented_source_pixels", box: mapped } : null;
      },
    };
  }
  if (selection.kind === "pdf_region") {
    if (source.kind !== "pdf") throw new AppError("invalid_selection", "The selection does not match the source type.");
    const rendered = await renderPdfRegion(bytes, selection.pageNumber, selection.region);
    const stored = selection.transform.renderedPixelSize;
    if (stored && (stored.width !== rendered.width || stored.height !== rendered.height)) {
      throw new AppError("internal", "The PDF region no longer renders at the size recorded for this selection.");
    }
    return {
      mimeType: "image/png",
      bytes: rendered.png,
      disclosure: "rendered_pdf_region",
      pageHint: null,
      pixelSize: { width: rendered.width, height: rendered.height },
      regionLocator: { type: "pdf_box", pageNumber: selection.pageNumber, coordinateSystem: "pdf_user_space_points", box: rendered.transform.pdfBox },
      mapSentBoxToSource: (b) => mapSentPdfBox(rendered.frame, rendered.snapped, selection.pageNumber, b),
    };
  }
  throw new AppError("invalid_selection", "Spreadsheet selections are parsed locally and are never sent for extraction.");
}

/** Normalized box in the rendered region image → PDF user-space box on the page. */
export function mapSentPdfBox(frame: PageFrame, region: NormRect, pageNumber: number, b: NormRect): Locator | null {
  if (!isValidNormRect(b)) return null;
  const onPage = composeNormalized(region, b);
  return { type: "pdf_box", pageNumber, coordinateSystem: "pdf_user_space_points", box: displayRectToPdfBox(frame, onPage) };
}
