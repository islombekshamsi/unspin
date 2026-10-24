import { inflateRawSync } from "node:zlib";

/**
 * Minimal read-only ZIP inspection for OOXML validation. Reads the central
 * directory and, on request, inflates individual entries with an output cap so
 * a forged size field cannot become a decompression bomb.
 */

export interface ZipEntry {
  name: string;
  method: number;
  encrypted: boolean;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipFormatError";
  }
}

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
}

export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  // End of central directory: last 22 bytes + up to 64 KiB comment.
  const minEocd = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError("The archive has no central directory.");
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipFormatError("ZIP64 archives are not supported.");
  if (cdOffset + cdSize > bytes.length) throw new ZipFormatError("The archive directory is truncated.");

  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder("utf-8");
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new ZipFormatError("The archive directory is malformed.");
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const uncompressedSize = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localHeaderOffset = u32(bytes, p + 42);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, encrypted: (flags & 1) === 1, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflates one entry. Fails if the data expands beyond `maxBytes` or disagrees with its declared size. */
export function readZipEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Uint8Array {
  if (entry.encrypted) throw new ZipFormatError("The archive entry is encrypted.");
  if (entry.uncompressedSize > maxBytes) throw new ZipFormatError("An archive entry is larger than allowed.");
  const h = entry.localHeaderOffset;
  if (h + 30 > bytes.length || u32(bytes, h) !== 0x04034b50) throw new ZipFormatError("An archive entry header is malformed.");
  const start = h + 30 + u16(bytes, h + 26) + u16(bytes, h + 28);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new ZipFormatError("An archive entry is truncated.");
  const data = bytes.subarray(start, end);
  let out: Uint8Array;
  if (entry.method === 0) out = data;
  else if (entry.method === 8) {
    try {
      out = inflateRawSync(data, { maxOutputLength: Math.max(1, entry.uncompressedSize + 1) });
    } catch {
      throw new ZipFormatError("An archive entry could not be decompressed within its declared size.");
    }
  } else throw new ZipFormatError(`Unsupported ZIP compression method ${entry.method}.`);
  if (out.length !== entry.uncompressedSize) throw new ZipFormatError("An archive entry does not match its declared size.");
  return out;
}
