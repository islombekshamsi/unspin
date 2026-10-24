import { AppError } from "@/contracts";
import { LIMITS } from "@/server/config/limits";
import { readZipDirectory, readZipEntry, ZipFormatError, type ZipEntry } from "@/server/sources/zip";

/**
 * Package-level OOXML checks and the few XML parts read directly (workbook sheet
 * list and the literal text of numeric cells). Nothing here evaluates formulas.
 */

/** Ceiling on the expanded size of an uploaded workbook; guards decompression bombs. */
export const MAX_XLSX_EXPANDED_BYTES = LIMITS.maxUploadBytes * 20;
const MAX_XML_PART_BYTES = MAX_XLSX_EXPANDED_BYTES;

const XLSX_MAIN_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
];

export interface WorkbookSheetPart {
  name: string;
  state: "visible" | "hidden" | "veryHidden";
  /** Zip path of the worksheet XML, e.g. "xl/worksheets/sheet1.xml". */
  path: string | null;
  isChartsheet: boolean;
}

export interface XlsxPackage {
  entries: Map<string, ZipEntry>;
  sheets: WorkbookSheetPart[];
  date1904: boolean;
}

function readText(bytes: Uint8Array, entry: ZipEntry): string {
  return new TextDecoder("utf-8").decode(readZipEntry(bytes, entry, MAX_XML_PART_BYTES));
}

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = decodeXmlEntities(m[2] ?? m[3] ?? "");
  return out;
}

/**
 * Verifies the ZIP is an XLSX workbook (not XLSM/XLSB/another OOXML/archive), that no
 * entry is encrypted, and that every entry inflates to its declared size within the cap.
 */
export function inspectXlsxPackage(bytes: Uint8Array): XlsxPackage {
  let list: ZipEntry[];
  try {
    list = readZipDirectory(bytes);
  } catch (e) {
    if (e instanceof ZipFormatError) throw new AppError("unsupported_media_type", "This ZIP-based file could not be read as a spreadsheet.");
    throw e;
  }
  const entries = new Map(list.map((e) => [e.name, e]));
  if (list.some((e) => e.encrypted)) throw new AppError("encrypted_file", "This file is encrypted. Remove the password and upload it again.");

  const has = (n: string) => entries.has(n);
  if (!has("[Content_Types].xml") || !has("xl/workbook.xml")) {
    if (has("xl/workbook.bin")) throw new AppError("unsupported_media_type", "Binary Excel workbooks (.xlsb) are not supported. Save the workbook as .xlsx and upload it again.");
    if (has("word/document.xml")) throw new AppError("unsupported_media_type", "Word documents are not supported. Upload a PNG, JPEG, WebP, PDF, CSV, or XLSX file.");
    if (has("ppt/presentation.xml")) throw new AppError("unsupported_media_type", "PowerPoint files are not supported. Upload a PNG, JPEG, WebP, PDF, CSV, or XLSX file.");
    throw new AppError("unsupported_media_type", "ZIP archives are not supported. Upload a PNG, JPEG, WebP, PDF, CSV, or XLSX file.");
  }
  if (has("xl/vbaProject.bin") || list.some((e) => /vbaProject\.bin$/i.test(e.name))) {
    throw new AppError("unsupported_media_type", "Macro-enabled workbooks (.xlsm) are not supported. Save a copy as .xlsx (without macros) and upload that.");
  }
  let total = 0;
  for (const e of list) {
    total += e.uncompressedSize;
    if (total > MAX_XLSX_EXPANDED_BYTES) {
      throw new AppError("payload_too_large", "This workbook expands to more data than the server accepts. Split it into smaller workbooks.");
    }
  }
  // Prove the declared sizes: inflate every entry with an output cap.
  try {
    for (const e of list) if (!e.name.endsWith("/")) readZipEntry(bytes, e, MAX_XLSX_EXPANDED_BYTES);
  } catch (e) {
    if (e instanceof ZipFormatError) throw new AppError("unreadable_source", "The workbook archive is damaged or inconsistent.");
    throw e;
  }

  const contentTypes = readText(bytes, entries.get("[Content_Types].xml")!);
  if (/macroEnabled/i.test(contentTypes)) {
    throw new AppError("unsupported_media_type", "Macro-enabled workbooks (.xlsm) are not supported. Save a copy as .xlsx (without macros) and upload that.");
  }
  if (!XLSX_MAIN_TYPES.some((t) => contentTypes.includes(t))) {
    throw new AppError("unsupported_media_type", "This Office file is not an Excel workbook (.xlsx).");
  }

  const workbookXml = readText(bytes, entries.get("xl/workbook.xml")!);
  const relsEntry = entries.get("xl/_rels/workbook.xml.rels");
  const rels = new Map<string, { target: string; type: string }>();
  if (relsEntry) {
    for (const m of readText(bytes, relsEntry).matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
      const a = attrs(m[0]);
      if (a.Id && a.Target) rels.set(a.Id, { target: a.Target, type: a.Type ?? "" });
    }
  }
  const sheets: WorkbookSheetPart[] = [];
  for (const m of workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (!a.name) continue;
    const ridKey = Object.keys(a).find((k) => /(^|:)id$/.test(k) && k !== "sheetId");
    const rel = ridKey ? rels.get(a[ridKey]) : undefined;
    let p: string | null = null;
    if (rel) p = rel.target.startsWith("/") ? rel.target.slice(1) : normalizePath(`xl/${rel.target}`);
    const state = a.state === "hidden" || a.state === "veryHidden" ? a.state : "visible";
    sheets.push({ name: a.name, state, path: p, isChartsheet: /chartsheet/i.test(rel?.type ?? "") });
  }
  const pr = /<(?:\w+:)?workbookPr\b[^>]*>/.exec(workbookXml);
  const date1904 = pr ? ["1", "true"].includes(attrs(pr[0]).date1904 ?? "") : false;
  return { entries, sheets, date1904 };
}

function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== "." && seg !== "") out.push(seg);
  }
  return out.join("/");
}

/**
 * Literal `<v>` text of numeric and boolean cells, keyed by address. Used only as
 * rawText so the source digits are shown exactly as stored.
 */
export function readLiteralValues(bytes: Uint8Array, pkg: XlsxPackage, sheetName: string): Map<string, string> {
  const out = new Map<string, string>();
  const part = pkg.sheets.find((s) => s.name === sheetName);
  const entry = part?.path ? pkg.entries.get(part.path) : undefined;
  if (!entry) return out;
  const xml = readText(bytes, entry);
  for (const m of xml.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
    const body = m[2];
    if (!body) continue;
    const a = attrs(m[1]);
    if (!a.r) continue;
    const t = a.t ?? "n";
    if (t !== "n" && t !== "b") continue;
    const v = /<(?:\w+:)?v>([^<]*)<\/(?:\w+:)?v>/.exec(body);
    if (v) out.set(a.r.replace(/\$/g, ""), decodeXmlEntities(v[1]));
  }
  return out;
}
