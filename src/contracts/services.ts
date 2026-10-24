import type { Column, Coverage, ExtractionInfo, ImportIssue, Row } from "./dataset";
import type { ExtractionMethod, Locator, Provenance } from "./provenance";

/**
 * Seams between specialist services and coordinator orchestration.
 * Services produce drafts; orchestration assigns dataset/version ids and persists.
 */

export type DraftIssue = ImportIssue;

/**
 * Candidate dataset content produced by deterministic parsing or model extraction.
 * Row/column/cell/provenance ids are already generated (newId) and stable.
 */
export interface ParsedDatasetDraft {
  title: string;
  description: string;
  extractionMethod: ExtractionMethod;
  coverage: Coverage;
  /** Required unless coverage is complete_selection. */
  coverageNote: string | null;
  extraction: ExtractionInfo | null;
  columns: Column[];
  rows: Row[];
  provenance: Provenance[];
  /** Observations made while producing the draft; orchestration persists them as findings. */
  issues: DraftIssue[];
}

/** Exactly the bytes that will be sent to the model for an unstructured selection. */
export interface ExtractionInput {
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  bytes: Uint8Array;
  disclosure: ExtractionInfo["inputDisclosure"];
  /** One-based page hint when a whole PDF is sent. */
  pageHint: number | null;
  /** Pixel size of the image sent, when an image is sent. */
  pixelSize: { width: number; height: number } | null;
  /** Locator describing the whole selected region in source coordinates (region-level provenance). */
  regionLocator: Locator;
  /**
   * Maps a box expressed in normalized [0,1] coordinates of the sent image back to
   * a source locator. Returns null when no geometric mapping exists.
   */
  mapSentBoxToSource(box: { x: number; y: number; width: number; height: number }): Locator | null;
}
