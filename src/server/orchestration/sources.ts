import { createHash } from "node:crypto";
import {
  AppError,
  newId,
  SourceSchema,
  SourceSelectionSchema,
  type CsvDelimiter,
  type Owner,
  type SelectionInput,
  type Source,
  type SourceRecord,
  type SourceSelection,
  type StructuredInspection,
} from "@/contracts";
import { LIMITS } from "@/server/config/limits";
import { inspectStructured, resolveSelection, validateUpload } from "@/server/ingestion";
import { getRepositories, newBlobKey } from "@/server/storage";

export async function createSource(owner: Owner, file: File): Promise<Source> {
  if (file.size > LIMITS.maxUploadBytes) {
    throw new AppError("payload_too_large", `Files are limited to ${formatBytes(LIMITS.maxUploadBytes)}.`, {
      details: { limitBytes: LIMITS.maxUploadBytes, byteSize: file.size },
    });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = await validateUpload({
    bytes,
    filename: file.name || "upload",
    declaredMimeType: file.type || null,
  });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (validated.sha256 !== sha256) {
    throw new AppError("internal", "Upload integrity check failed.");
  }
  const source = SourceSchema.parse({ ...validated, id: newId("src"), createdAt: new Date().toISOString() });
  const repos = getRepositories();
  const blobKey = newBlobKey(owner.ownerId, source.id);
  await repos.blobs.put(blobKey, bytes);
  try {
    await repos.sources.create(owner, { source, blobKey });
  } catch (e) {
    await repos.blobs.delete(blobKey).catch(() => undefined);
    throw e;
  }
  return source;
}

export async function getSourceRecord(owner: Owner, sourceId: string): Promise<SourceRecord> {
  const rec = await getRepositories().sources.get(owner, sourceId);
  if (!rec) throw new AppError("not_found", "Source not found.");
  return rec;
}

export async function getSourceBytes(owner: Owner, sourceId: string): Promise<{ source: Source; bytes: Uint8Array }> {
  const rec = await getSourceRecord(owner, sourceId);
  const bytes = await getRepositories().blobs.get(rec.blobKey);
  if (!bytes) throw new AppError("not_found", "The stored source file is no longer available.");
  return { source: rec.source, bytes };
}

export async function inspectSource(
  owner: Owner,
  sourceId: string,
  options: { delimiter?: CsvDelimiter; sheetName?: string },
): Promise<StructuredInspection> {
  const { source, bytes } = await getSourceBytes(owner, sourceId);
  if (source.kind !== "csv" && source.kind !== "xlsx") {
    throw new AppError("bad_request", "Only CSV and XLSX sources have a structured preview.");
  }
  return inspectStructured(source, bytes, options);
}

export async function createSelection(owner: Owner, sourceId: string, input: SelectionInput): Promise<SourceSelection> {
  const { source, bytes } = await getSourceBytes(owner, sourceId);
  const expected: Record<Source["kind"], SelectionInput["kind"]> = {
    image: "image_region",
    pdf: "pdf_region",
    csv: "csv_records",
    xlsx: "xlsx_range",
  };
  if (expected[source.kind] !== input.kind) {
    throw new AppError("invalid_selection", `A ${source.kind.toUpperCase()} source needs a ${expected[source.kind]} selection.`);
  }
  const resolved = await resolveSelection(source, bytes, input);
  const selection = SourceSelectionSchema.parse({ ...resolved, id: newId("sel"), createdAt: new Date().toISOString() });
  await getRepositories().selections.create(owner, selection);
  return selection;
}

export async function getSelection(owner: Owner, selectionId: string): Promise<SourceSelection> {
  const sel = await getRepositories().selections.get(owner, selectionId);
  if (!sel) throw new AppError("not_found", "Selection not found.");
  return sel;
}

export async function deleteSource(owner: Owner, sourceId: string): Promise<{ deletedDatasets: number }> {
  const repos = getRepositories();
  const rec = await repos.sources.get(owner, sourceId);
  if (!rec) throw new AppError("not_found", "Source not found.");
  const deletedDatasets = await repos.datasets.deleteBySource(owner, sourceId);
  await repos.sources.delete(owner, sourceId);
  await repos.blobs.delete(rec.blobKey);
  return { deletedDatasets };
}

function formatBytes(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(0)} MiB`;
}
