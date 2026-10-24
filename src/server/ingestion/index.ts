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
import { inspectCsv, parseCsvSelection, resolveCsvSelection } from "./csv";
import { prepareUnstructuredInput, resolveImageSelection, resolvePdfSelection } from "./unstructured";
import { validateUploadBytes } from "./validate";
import { inspectXlsx, parseXlsxSelection, resolveXlsxSelection } from "./xlsx";

/**
 * Ingestion service seam (owner: Ingestion specialist).
 * Signatures are frozen by the coordinator.
 */

/** Validates signature, size, decoded dimensions/pages, and parser readability. Throws AppError (413/415/400/422). */
export async function validateUpload(input: {
  bytes: Uint8Array;
  filename: string;
  declaredMimeType: string | null;
}): Promise<ValidatedUpload> {
  return validateUploadBytes(input);
}

/** CSV/XLSX preview for delimiter/header/sheet decisions before a selection is committed. */
export async function inspectStructured(
  source: Source,
  bytes: Uint8Array,
  options: { delimiter?: CsvDelimiter; sheetName?: string },
): Promise<StructuredInspection> {
  if (source.kind === "csv") return inspectCsv(bytes, options.delimiter);
  if (source.kind === "xlsx") return inspectXlsx(bytes, options.sheetName);
  throw new AppError("bad_request", "Only CSV and XLSX sources have a structured preview.");
}

/** Validates a client selection against the actual source and resolves reproducible transforms. */
export async function resolveSelection(
  source: Source,
  bytes: Uint8Array,
  input: SelectionInput,
): Promise<ResolvedSelection> {
  switch (input.kind) {
    case "image_region":
      return resolveImageSelection(source, input);
    case "pdf_region":
      return resolvePdfSelection(source, bytes, input);
    case "csv_records":
      if (source.kind !== "csv") throw new AppError("invalid_selection", "This source is not a CSV file.");
      return resolveCsvSelection(source, bytes, input);
    case "xlsx_range":
      if (source.kind !== "xlsx") throw new AppError("invalid_selection", "This source is not an XLSX workbook.");
      return resolveXlsxSelection(source, bytes, input);
  }
}

/** Deterministic CSV/XLSX import of a structured selection. No model involved. */
export async function parseStructuredSelection(
  source: Source,
  bytes: Uint8Array,
  selection: SourceSelection,
): Promise<ParsedDatasetDraft> {
  if (selection.kind === "csv_records" && source.kind === "csv") return parseCsvSelection(source, bytes, selection);
  if (selection.kind === "xlsx_range" && source.kind === "xlsx") return parseXlsxSelection(source, bytes, selection);
  throw new AppError("invalid_selection", "Only CSV and XLSX selections are parsed locally.");
}

/** Produces exactly the bytes to send for an unstructured (image/PDF) selection. */
export async function prepareExtractionInput(
  source: Source,
  bytes: Uint8Array,
  selection: SourceSelection,
): Promise<ExtractionInput> {
  return prepareUnstructuredInput(source, bytes, selection);
}
