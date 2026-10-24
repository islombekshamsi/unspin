import { describe, expect, it } from "vitest";
import type { Source, SourceSelection } from "@/contracts";
import { coverageStatus, describeSentInput, errorView } from "./presentation";

const base = {
  id: "src_1",
  filename: "f",
  mimeType: "application/pdf",
  byteSize: 1,
  sha256: "a".repeat(64),
  createdAt: "2026-10-24T00:00:00.000Z",
  sheetNames: null,
  capabilities: { preview: true, crop: true, selectSheet: false, textCoordinates: false },
  image: null,
};

describe("describeSentInput", () => {
  it("states the crop size for an image region", () => {
    const source = { ...base, kind: "image", mimeType: "image/png", pageCount: null, processingDisclosure: "gemini_selected_region" } as Source;
    const sel = {
      id: "sel_1",
      sourceId: "src_1",
      createdAt: base.createdAt,
      kind: "image_region",
      region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      userHint: null,
      transform: { originalWidth: 2000, originalHeight: 1000, exifOrientation: 1, orientedWidth: 2000, orientedHeight: 1000, orientedPixelBox: { left: 200, top: 100, width: 1000, height: 500 } },
    } as SourceSelection;
    const d = describeSentInput(source, sel);
    expect(d.external).toBe(true);
    expect(d.what).toContain("1,000 × 500 px crop of the 2,000 × 1,000 px image");
    expect(d.notSent).toMatch(/rest of the image is not sent/);
  });

  it("discloses a whole-PDF fallback instead of claiming crop-only", () => {
    const source = { ...base, kind: "pdf", pageCount: 12, processingDisclosure: "gemini_whole_file" } as Source;
    const sel = {
      id: "sel_1",
      sourceId: "src_1",
      createdAt: base.createdAt,
      kind: "pdf_region",
      pageNumber: 3,
      region: { x: 0, y: 0, width: 1, height: 0.5 },
      userHint: null,
      transform: { page: { widthPt: 612, heightPt: 792, rotation: 0 }, pdfBox: { x0: 0, y0: 396, x1: 612, y1: 792 }, renderScale: null, renderedPixelSize: null },
    } as SourceSelection;
    const d = describeSentInput(source, sel);
    expect(d.wholeFile).toBe(true);
    expect(d.what).toMatch(/whole PDF file \(12 pages\).*page 3/);
  });

  it("says nothing leaves the server for structured selections", () => {
    const source = { ...base, kind: "csv", mimeType: "text/csv", pageCount: null, processingDisclosure: "local_parser" } as Source;
    const sel = { id: "s", sourceId: "src_1", createdAt: base.createdAt, kind: "csv_records", delimiter: ",", headerRecordCount: 1, selectedColumnIndexes: null, recordInterval: null } as SourceSelection;
    expect(describeSentInput(source, sel).external).toBe(false);
  });
});

describe("errorView", () => {
  it("never offers a retry for configuration problems and suggests adjusting for unreadable regions", () => {
    expect(errorView("not_configured", false).canRetry).toBe(false);
    expect(errorView("no_data_found", false)).toMatchObject({ canRetry: false, suggestAdjust: true });
    expect(errorView("rate_limited", true).canRetry).toBe(true);
  });
});

describe("coverageStatus", () => {
  it("requires acknowledgement only for unacknowledged partial/uncertain coverage", () => {
    const d = { coverage: "partial_selection", coverageAcknowledgedAt: null } as Parameters<typeof coverageStatus>[0];
    expect(coverageStatus(d).needsAck).toBe(true);
    expect(coverageStatus({ ...d, coverageAcknowledgedAt: "2026-10-24T00:00:00.000Z" }).needsAck).toBe(false);
    expect(coverageStatus({ ...d, coverage: "complete_selection" }).needsAck).toBe(false);
  });
});
