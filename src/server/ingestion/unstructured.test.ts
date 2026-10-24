import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { LIMITS } from "@/server/config/limits";
import { displayPointToPdf, normalizedToPixelBox, pdfBoxToDisplayRect, type PageFrame, type PdfRotation } from "@/server/sources/geometry";
import { prepareExtractionInput, resolveSelection, validateUpload } from "./index";
import { asSource, makePdf, withIds } from "./test-support/fixtures";

async function pixels(png: Uint8Array) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { at: (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)], info };
}

describe("image region round trip", () => {
  it("crops in oriented space for an EXIF-rotated photo and maps sent boxes back exactly", async () => {
    // Stored 40×20: left half red, right half blue. Orientation 6 displays it rotated 90° clockwise (20×40):
    // the stored left half becomes the displayed top half.
    const raw = Buffer.alloc(40 * 20 * 3);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) raw.set(x < 20 ? [255, 0, 0] : [0, 0, 255], (y * 40 + x) * 3);
    const png = new Uint8Array(await sharp(raw, { raw: { width: 40, height: 20, channels: 3 } }).withMetadata({ orientation: 6 }).png().toBuffer());
    const source = asSource(await validateUpload({ bytes: png, filename: "photo.png", declaredMimeType: null }));
    expect(source.image).toMatchObject({ orientedWidth: 20, orientedHeight: 40 });

    const resolved = await resolveSelection(source, png, { kind: "image_region", region: { x: 0, y: 0, width: 1, height: 0.5 }, userHint: null });
    if (resolved.kind !== "image_region") throw new Error("expected image");
    expect(resolved.transform.orientedPixelBox).toEqual({ left: 0, top: 0, width: 20, height: 20 });

    const input = await prepareExtractionInput(source, png, withIds(resolved));
    expect(input.disclosure).toBe("selected_image_region");
    expect(input.pixelSize).toEqual({ width: 20, height: 20 });
    const px = await pixels(input.bytes);
    expect(px.at(0, 0)).toEqual([255, 0, 0]);
    expect(px.at(19, 19)).toEqual([255, 0, 0]);

    const bottom = await resolveSelection(source, png, { kind: "image_region", region: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, userHint: "blue series" });
    const bottomInput = await prepareExtractionInput(source, png, withIds(bottom));
    expect(bottomInput.pixelSize).toEqual({ width: 10, height: 10 });
    expect((await pixels(bottomInput.bytes)).at(5, 5)).toEqual([0, 0, 255]);
    expect(bottomInput.regionLocator).toEqual({ type: "image_box", coordinateSystem: "oriented_source_pixels", box: { left: 5, top: 20, width: 10, height: 10 } });
    expect(bottomInput.mapSentBoxToSource({ x: 0.5, y: 0, width: 0.5, height: 1 })).toEqual({
      type: "image_box",
      coordinateSystem: "oriented_source_pixels",
      box: { left: 10, top: 20, width: 5, height: 10 },
    });
    expect(bottomInput.mapSentBoxToSource({ x: 0.9, y: 0, width: 0.5, height: 1 })).toBeNull();
  });

  it("converts normalized regions to integer pixel boxes inside bounds", () => {
    expect(normalizedToPixelBox({ x: 0, y: 0, width: 1, height: 1 }, 7, 3)).toEqual({ left: 0, top: 0, width: 7, height: 3 });
    expect(normalizedToPixelBox({ x: 0.999, y: 0.999, width: 0.001, height: 0.001 }, 10, 10)).toEqual({ left: 9, top: 9, width: 1, height: 1 });
  });
});

describe("PDF geometry", () => {
  beforeAll(async () => {
    (globalThis as Record<string, unknown>).pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  });

  it("matches pdf.js viewport conversion for every rotation and an offset media box", async () => {
    const rotations: PdfRotation[] = [0, 90, 180, 270];
    const pdf = makePdf(rotations.map((r) => ({ mediaBox: [10, 20, 310, 220], rotate: r, content: "" })));
    const task = getDocument({ data: pdf });
    const doc = await task.promise;
    try {
      for (let i = 0; i < rotations.length; i++) {
        const page = await doc.getPage(i + 1);
        const vp = page.getViewport({ scale: 1 });
        const frame: PageFrame = { view: [10, 20, 310, 220], rotation: rotations[i] };
        for (const [u, v] of [
          [0, 0],
          [1, 0],
          [0.25, 0.75],
          [1, 1],
        ]) {
          const ours = displayPointToPdf(frame, u, v);
          const [px, py] = vp.convertToPdfPoint(u * vp.width, v * vp.height);
          expect(ours.x).toBeCloseTo(px, 6);
          expect(ours.y).toBeCloseTo(py, 6);
        }
      }
    } finally {
      await task.destroy();
    }
  });
});

describe("PDF region selection and rendering", () => {
  // A 300×200 pt page with a black 50×30 rectangle whose lower-left corner is at (100, 120).
  const rect = { x0: 100, y0: 120, x1: 150, y1: 150 };
  const content = "0 0 0 rg 100 120 50 30 re f";

  for (const rotate of [0, 90, 180, 270] as const) {
    it(`renders only the selected region and maps boxes back to PDF space (rotation ${rotate})`, async () => {
      const pdf = makePdf([{ mediaBox: [0, 0, 300, 200], rotate, content }]);
      const source = asSource(await validateUpload({ bytes: pdf, filename: "doc.pdf", declaredMimeType: null }));
      const frame: PageFrame = { view: [0, 0, 300, 200], rotation: rotate };
      // Select the rectangle plus a margin, expressed on the displayed (rotated) page.
      const target = pdfBoxToDisplayRect(frame, { x0: 90, y0: 110, x1: 160, y1: 160 });
      const resolved = await resolveSelection(source, pdf, { kind: "pdf_region", pageNumber: 1, region: target, userHint: null });
      if (resolved.kind !== "pdf_region") throw new Error("expected pdf");
      expect(resolved.transform.page).toEqual({ widthPt: 300, heightPt: 200, rotation: rotate });
      const box = resolved.transform.pdfBox;
      expect(box.x0).toBeCloseTo(90, 0);
      expect(box.y0).toBeCloseTo(110, 0);
      expect(box.x1).toBeCloseTo(160, 0);
      expect(box.y1).toBeCloseTo(160, 0);
      const size = resolved.transform.renderedPixelSize!;
      expect(size.width * size.height).toBeLessThanOrEqual(LIMITS.pdfRenderMaxPixels);

      const input = await prepareExtractionInput(source, pdf, withIds(resolved));
      expect(input.disclosure).toBe("rendered_pdf_region");
      expect(input.mimeType).toBe("image/png");
      expect(input.pixelSize).toEqual(size);
      expect(input.regionLocator).toMatchObject({ type: "pdf_box", pageNumber: 1, coordinateSystem: "pdf_user_space_points" });

      // Locate the dark pixels in the rendered region and map their bounding box back.
      const px = await pixels(input.bytes);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < px.info.height; y++)
        for (let x = 0; x < px.info.width; x++)
          if (px.at(x, y)[0] < 64) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
      expect(maxX).toBeGreaterThan(0);
      // Corners of the region are page background (white): the margin was rendered, not the whole page.
      expect(px.at(0, 0)).toEqual([255, 255, 255]);
      const mapped = input.mapSentBoxToSource({
        x: minX / px.info.width,
        y: minY / px.info.height,
        width: (maxX + 1 - minX) / px.info.width,
        height: (maxY + 1 - minY) / px.info.height,
      });
      if (!mapped || mapped.type !== "pdf_box") throw new Error("expected pdf box");
      const tol = 1.5 / (resolved.transform.renderScale ?? 1);
      expect(mapped.box.x0).toBeCloseTo(rect.x0, 0);
      expect(Math.abs(mapped.box.x0 - rect.x0)).toBeLessThanOrEqual(tol);
      expect(Math.abs(mapped.box.y0 - rect.y0)).toBeLessThanOrEqual(tol);
      expect(Math.abs(mapped.box.x1 - rect.x1)).toBeLessThanOrEqual(tol);
      expect(Math.abs(mapped.box.y1 - rect.y1)).toBeLessThanOrEqual(tol);
    });
  }

  it("selects a whole page when region is null and rejects missing pages", async () => {
    const pdf = makePdf([{ mediaBox: [0, 0, 300, 200], content }]);
    const source = asSource(await validateUpload({ bytes: pdf, filename: "doc.pdf", declaredMimeType: null }));
    const whole = await resolveSelection(source, pdf, { kind: "pdf_region", pageNumber: 1, region: null, userHint: null });
    if (whole.kind !== "pdf_region") throw new Error("expected pdf");
    expect(whole.transform.pdfBox.x0).toBeCloseTo(0, 6);
    expect(whole.transform.pdfBox.y1).toBeCloseTo(200, 0);
    await expect(resolveSelection(source, pdf, { kind: "pdf_region", pageNumber: 2, region: null, userHint: null })).rejects.toMatchObject({ code: "invalid_selection" });
  });
});
