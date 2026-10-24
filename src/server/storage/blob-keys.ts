import { AppError } from "@/contracts";

/**
 * Blob keys are server-generated: a lowercase namespace followed by 1–3 id segments,
 * e.g. "sources/guest_ab12…/src_9f…". No dots, no empty segments, no leading slash, so a
 * key can never express "..", an absolute path, or a hidden file. Uploaded filenames are
 * never part of a key.
 */
export const BLOB_KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}(?:\/[A-Za-z0-9_-]{1,128}){1,3}$/;

export function assertBlobKey(key: string): string {
  if (typeof key !== "string" || !BLOB_KEY_PATTERN.test(key)) {
    throw new AppError("internal", "Invalid storage key.");
  }
  return key;
}

/** Server-generated private key; never derived from the uploaded filename. */
export function newBlobKey(ownerId: string, sourceId: string): string {
  const ownerSegment = ownerId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const sourceSegment = sourceId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
  return assertBlobKey(`sources/${ownerSegment}/${sourceSegment}`);
}
