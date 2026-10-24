import {
  AppError,
  type CsvDelimiter,
  type ExtractionInput,
  type ParsedDatasetDraft,
  type ResolvedSelection,
  type SelectionInput,
  type Source,
  type SourceSelection,
  type StructuredInspection,
  type ValidatedUpload,
} from "@/contracts";

/**
 * Ingestion service seam (owner: Ingestion specialist).
 * Signatures are frozen by the coordinator; implementations replace these bodies.
 */

/** Validates signature, size, decoded dimensions/pages, and parser readability. Throws AppError (413/415/400/422). */
export async function validateUpload(input: {
  bytes: Uint8Array;
  filename: string;
  declaredMimeType: string | null;
}): Promise<ValidatedUpload> {
  void input;
  throw new AppError("not_configured", "Upload validation is not implemented yet.");
}

/** CSV/XLSX preview for delimiter/header/sheet decisions before a selection is committed. */
export async function inspectStructured(
  source: Source,
  bytes: Uint8Array,
  options: { delimiter?: CsvDelimiter; sheetName?: string },
): Promise<StructuredInspection> {
  void source;
  void bytes;
  void options;
  throw new AppError("not_configured", "Structured inspection is not implemented yet.");
}

/** Validates a client selection against the actual source and resolves reproducible transforms. */
export async function resolveSelection(
  source: Source,
  bytes: Uint8Array,
  input: SelectionInput,
): Promise<ResolvedSelection> {
  void source;
  void bytes;
  void input;
  throw new AppError("not_configured", "Source selection is not implemented yet.");
}

/** Deterministic CSV/XLSX import of a structured selection. No model involved. */
export async function parseStructuredSelection(
  source: Source,
  bytes: Uint8Array,
  selection: SourceSelection,
): Promise<ParsedDatasetDraft> {
  void source;
  void bytes;
  void selection;
  throw new AppError("not_configured", "Structured parsing is not implemented yet.");
}

/** Produces exactly the bytes to send for an unstructured (image/PDF) selection. */
export async function prepareExtractionInput(
  source: Source,
  bytes: Uint8Array,
  selection: SourceSelection,
): Promise<ExtractionInput> {
  void source;
  void bytes;
  void selection;
  throw new AppError("not_configured", "Region preparation is not implemented yet.");
}
