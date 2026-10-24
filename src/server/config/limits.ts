import type { Limits } from "@/contracts";

/**
 * Initial guardrails. These are design targets from docs/PRODUCT_SPEC.md,
 * not measured performance. Overflow is an explicit error, never a silent truncation.
 */
export const LIMITS = {
  maxUploadBytes: 10 * 1024 * 1024,
  maxStructuredRows: 20_000,
  maxColumns: 64,
  /** Decoded pixel cap for images (guards decompression bombs). */
  maxImagePixels: 40_000_000,
  maxPdfPages: 200,
  maxPdfRegionsPerExtraction: 1,
  maxExtractedRowsPerRegion: 250,
  maxRowsPageSize: 1000,
  maxChartPoints: 20_000,
  /** Longest text the extraction service may forward as a user hint. */
  maxUserHintChars: 300,
  /** Bounded provider behaviour. */
  providerTimeoutMs: 120_000,
  providerMaxAttempts: 2,
  providerMaxOutputTokens: 32_768,
  /** Raster scale used when rendering a PDF region for extraction. */
  pdfRenderMaxPixels: 16_000_000,
} as const;

export const ACCEPTED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export function publicLimits(): Limits {
  return {
    maxUploadBytes: LIMITS.maxUploadBytes,
    maxStructuredRows: LIMITS.maxStructuredRows,
    maxColumns: LIMITS.maxColumns,
    maxImagePixels: LIMITS.maxImagePixels,
    maxPdfPages: LIMITS.maxPdfPages,
    maxPdfRegionsPerExtraction: LIMITS.maxPdfRegionsPerExtraction,
    maxExtractedRowsPerRegion: LIMITS.maxExtractedRowsPerRegion,
    maxRowsPageSize: LIMITS.maxRowsPageSize,
    maxChartPoints: LIMITS.maxChartPoints,
    acceptedKinds: ["PNG", "JPEG", "WebP", "PDF", "CSV", "XLSX"],
    acceptedMimeTypes: [...ACCEPTED_MIME_TYPES],
  };
}
