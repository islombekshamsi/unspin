/**
 * Content sniffing by magic bytes. The filename and declared MIME type are never
 * trusted to decide the kind of a file.
 */

export type Sniffed =
  | { kind: "png" | "jpeg" | "webp" | "pdf" | "zip" | "ole" }
  | { kind: "rejected"; what: string }
  | { kind: "text_candidate" };

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

/** Offset of "%PDF-" within the first 1024 bytes (the PDF spec tolerates a short preamble), or -1. */
export function pdfHeaderOffset(bytes: Uint8Array): number {
  const sig = ascii("%PDF-");
  const end = Math.min(bytes.length - sig.length, 1024);
  for (let i = 0; i <= end; i++) if (startsWith(bytes, sig, i)) return i;
  return -1;
}

/*
 * Signatures made only of printable characters are extended with the binary bytes
 * that follow them in real files, so a CSV that happens to begin with "BM" or "MZ"
 * is not mistaken for an image or executable.
 */
const REJECTED: Array<{ sig: number[]; offset?: number; what: string }> = [
  { sig: [...ascii("MZ"), 0x90, 0x00], what: "a Windows executable" },
  { sig: [...ascii("MZ"), 0x50, 0x00], what: "a Windows executable" },
  { sig: [0x7f, 0x45, 0x4c, 0x46], what: "an executable (ELF)" },
  { sig: [0xfe, 0xed, 0xfa, 0xce], what: "an executable (Mach-O)" },
  { sig: [0xfe, 0xed, 0xfa, 0xcf], what: "an executable (Mach-O)" },
  { sig: [0xce, 0xfa, 0xed, 0xfe], what: "an executable (Mach-O)" },
  { sig: [0xcf, 0xfa, 0xed, 0xfe], what: "an executable (Mach-O)" },
  { sig: [0xca, 0xfe, 0xba, 0xbe], what: "an executable or Java class file" },
  { sig: [0x00, 0x61, 0x73, 0x6d], what: "a WebAssembly module" },
  { sig: ascii("#!"), what: "a script" },
  { sig: [0x1f, 0x8b], what: "a gzip archive" },
  { sig: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], what: "a 7-Zip archive" },
  { sig: [...ascii("Rar!"), 0x1a, 0x07], what: "a RAR archive" },
  { sig: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], what: "an xz archive" },
  { sig: [0x28, 0xb5, 0x2f, 0xfd], what: "a Zstandard archive" },
  { sig: ascii("ustar"), offset: 257, what: "a tar archive" },
  { sig: ascii("GIF87a"), what: "a GIF image (use PNG, JPEG, or WebP)" },
  { sig: ascii("GIF89a"), what: "a GIF image (use PNG, JPEG, or WebP)" },
  { sig: [0x49, 0x49, 0x2a, 0x00], what: "a TIFF image (use PNG, JPEG, or WebP)" },
  { sig: [0x4d, 0x4d, 0x00, 0x2a], what: "a TIFF image (use PNG, JPEG, or WebP)" },
  { sig: ascii("ftypheic"), offset: 4, what: "a HEIC image (use PNG, JPEG, or WebP)" },
  { sig: ascii("ftypheix"), offset: 4, what: "a HEIC image (use PNG, JPEG, or WebP)" },
  { sig: ascii("ftypmif1"), offset: 4, what: "a HEIF image (use PNG, JPEG, or WebP)" },
  { sig: ascii("ftypavif"), offset: 4, what: "an AVIF image (use PNG, JPEG, or WebP)" },
  { sig: ascii("{\\rtf"), what: "an RTF document" },
];

export function sniff(bytes: Uint8Array): Sniffed {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "jpeg" };
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return { kind: "webp" };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return { kind: "zip" };
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { kind: "ole" };
  for (const r of REJECTED) if (startsWith(bytes, r.sig, r.offset ?? 0)) return { kind: "rejected", what: r.what };
  // BMP: "BM", 4-byte size, then 4 reserved zero bytes. bzip2: "BZh" + level + block magic.
  if (startsWith(bytes, ascii("BM")) && startsWith(bytes, [0, 0, 0, 0], 6)) return { kind: "rejected", what: "a BMP image (use PNG, JPEG, or WebP)" };
  if (startsWith(bytes, ascii("BZh")) && startsWith(bytes, [0x31, 0x41, 0x59, 0x26, 0x53, 0x59], 4)) return { kind: "rejected", what: "a bzip2 archive" };
  if (pdfHeaderOffset(bytes) >= 0) return { kind: "pdf" };
  return { kind: "text_candidate" };
}

/** True when an OLE compound file carries an encrypted OOXML package (password-protected .xlsx/.docx). */
export function oleLooksEncryptedOoxml(bytes: Uint8Array): boolean {
  return containsUtf16le(bytes, "EncryptedPackage") || containsUtf16le(bytes, "EncryptionInfo");
}

function containsUtf16le(bytes: Uint8Array, s: string): boolean {
  const pat: number[] = [];
  for (const ch of s) pat.push(ch.charCodeAt(0), 0);
  const first = pat[0];
  outer: for (let i = 0; i + pat.length <= bytes.length; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < pat.length; j++) if (bytes[i + j] !== pat[j]) continue outer;
    return true;
  }
  return false;
}
