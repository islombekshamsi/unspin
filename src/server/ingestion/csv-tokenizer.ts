/**
 * Deterministic RFC 4180 tokenizer with physical line tracking. Pure TypeScript:
 * used by the server importer and by the browser source viewer, so record and
 * line locators agree exactly.
 *
 * - Quoted fields may contain delimiters, doubled quotes ("") and line breaks.
 * - CRLF, LF, and lone CR all end a record (mixed endings are tolerated).
 * - Field text is kept exactly: no trimming, no type coercion, embedded line breaks kept as written.
 * - Lines with no characters at all are skipped and reported, never turned into records silently.
 * - Text after a closing quote is kept literally and reported as malformed quoting.
 * - An unterminated quote is a hard error naming the line where it opened.
 */

export interface CsvRecord {
  fields: string[];
  /** One-based physical line where the record starts. */
  lineStart: number;
  /** One-based physical line where the record ends (differs for multiline quoted fields). */
  lineEnd: number;
}

export interface CsvTokens {
  records: CsvRecord[];
  /** One-based line numbers of empty lines that were skipped. */
  emptyLines: number[];
  /** Zero-based indexes (into records) of records with text after a closing quote. */
  malformedQuoteRecords: number[];
  /** True when tokenizing stopped early because maxRecords was reached. */
  truncated: boolean;
}

export class CsvSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "CsvSyntaxError";
  }
}

const QUOTE = 34;
const CR = 13;
const LF = 10;

export function tokenizeCsv(text: string, delimiter: string, options: { maxRecords?: number } = {}): CsvTokens {
  if (delimiter.length !== 1) throw new Error("Delimiter must be a single character.");
  const delim = delimiter.charCodeAt(0);
  const max = options.maxRecords ?? Infinity;
  const records: CsvRecord[] = [];
  const emptyLines: number[] = [];
  const malformed: number[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;

  while (i < n) {
    if (records.length >= max) return { records, emptyLines, malformedQuoteRecords: malformed, truncated: true };
    const c0 = text.charCodeAt(i);
    if (c0 === CR || c0 === LF) {
      emptyLines.push(line);
      i += c0 === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
      line++;
      continue;
    }
    const lineStart = line;
    const fields: string[] = [];
    let recordMalformed = false;
    for (;;) {
      let value: string;
      if (text.charCodeAt(i) === QUOTE) {
        const openLine = line;
        let buf = "";
        let segStart = i + 1;
        let j = i + 1;
        for (;;) {
          if (j >= n) throw new CsvSyntaxError(`A quoted field opened on line ${openLine} is never closed.`, openLine);
          const c = text.charCodeAt(j);
          if (c === QUOTE) {
            if (text.charCodeAt(j + 1) === QUOTE) {
              buf += text.slice(segStart, j + 1);
              j += 2;
              segStart = j;
              continue;
            }
            buf += text.slice(segStart, j);
            j++;
            break;
          }
          if (c === CR) {
            if (text.charCodeAt(j + 1) === LF) j++;
            line++;
          } else if (c === LF) {
            line++;
          }
          j++;
        }
        // Anything between the closing quote and the next delimiter/line end is kept literally.
        let k = j;
        while (k < n) {
          const c = text.charCodeAt(k);
          if (c === delim || c === CR || c === LF) break;
          k++;
        }
        if (k > j) {
          recordMalformed = true;
          buf += text.slice(j, k);
        }
        value = buf;
        i = k;
      } else {
        let k = i;
        while (k < n) {
          const c = text.charCodeAt(k);
          if (c === delim || c === CR || c === LF) break;
          k++;
        }
        value = text.slice(i, k);
        i = k;
      }
      fields.push(value);
      if (i >= n) break;
      const c = text.charCodeAt(i);
      if (c === delim) {
        i++;
        if (i >= n) {
          fields.push("");
          break;
        }
        continue;
      }
      // Line break ends the record.
      i += c === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
      break;
    }
    if (recordMalformed) malformed.push(records.length);
    records.push({ fields, lineStart, lineEnd: line });
    line++;
  }
  return { records, emptyLines, malformedQuoteRecords: malformed, truncated: false };
}

export const CSV_DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Suggests a delimiter from the first records: the candidate producing more than one
 * field with the most consistent field count. Falls back to comma (single-column data).
 */
export function suggestDelimiter(text: string, sampleRecords = 50): { delimiter: (typeof CSV_DELIMITERS)[number]; reason: string } {
  let best: { delimiter: (typeof CSV_DELIMITERS)[number]; mode: number; consistency: number } | null = null;
  for (const d of CSV_DELIMITERS) {
    let tokens: CsvTokens;
    try {
      tokens = tokenizeCsv(text, d, { maxRecords: sampleRecords });
    } catch {
      continue;
    }
    if (tokens.records.length === 0) continue;
    const counts = new Map<number, number>();
    for (const r of tokens.records) counts.set(r.fields.length, (counts.get(r.fields.length) ?? 0) + 1);
    let mode = 1;
    let modeCount = 0;
    for (const [len, cnt] of counts) if (cnt > modeCount || (cnt === modeCount && len > mode)) [mode, modeCount] = [len, cnt];
    if (mode < 2) continue;
    const consistency = modeCount / tokens.records.length;
    if (!best || consistency > best.consistency + 1e-9 || (Math.abs(consistency - best.consistency) < 1e-9 && mode > best.mode)) {
      best = { delimiter: d, mode, consistency };
    }
  }
  if (!best) return { delimiter: ",", reason: "No candidate delimiter split the records into several fields; treating the data as one column." };
  const name = DELIMITER_NAMES[best.delimiter];
  return {
    delimiter: best.delimiter,
    reason: `${name} gives ${best.mode} fields in ${Math.round(best.consistency * 100)}% of the first records.`,
  };
}

export const DELIMITER_NAMES: Record<(typeof CSV_DELIMITERS)[number], string> = {
  ",": "Comma",
  ";": "Semicolon",
  "\t": "Tab",
  "|": "Pipe",
};

const NUMERIC_LIKE = /^[\s(+-]*[$€£¥]?\s*\d[\d,.\s]*%?\)?\s*$/;

/** Suggests whether the first record is a header: text labels above columns that are mostly numeric. */
export function suggestHeader(records: CsvRecord[]): { headerRecordCount: 0 | 1; reason: string } {
  if (records.length < 2) return { headerRecordCount: 0, reason: "There is only one record, so it is treated as data." };
  const first = records[0].fields;
  const rest = records.slice(1, 51);
  if (first.some((f) => f.trim() === "")) return { headerRecordCount: 0, reason: "The first record has empty fields, so it does not look like a header." };
  if (first.some((f) => NUMERIC_LIKE.test(f))) return { headerRecordCount: 0, reason: "The first record contains numbers, so it looks like data." };
  for (let c = 0; c < first.length; c++) {
    const vals = rest.map((r) => r.fields[c]).filter((v): v is string => v !== undefined && v.trim() !== "");
    if (vals.length > 0 && vals.filter((v) => NUMERIC_LIKE.test(v)).length / vals.length >= 0.5) {
      return { headerRecordCount: 1, reason: `The first record is text above a mostly numeric column ("${truncate(first[c], 40)}").` };
    }
  }
  return { headerRecordCount: 1, reason: "The first record is all non-empty text; review whether it is a header." };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Decodes CSV bytes as strict UTF-8. Returns null when the bytes are not UTF-8 text. */
export function decodeUtf8Text(bytes: Uint8Array): { text: string; hasBom: boolean } | { error: "not_utf8" | "nul_bytes" } {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (bytes.includes(0)) return { error: "nul_bytes" };
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return { text, hasBom };
  } catch {
    return { error: "not_utf8" };
  }
}
