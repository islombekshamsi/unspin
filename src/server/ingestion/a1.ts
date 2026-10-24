/** A1 reference helpers (pure; shared with the browser). Rows and columns are one-based. */

export const MAX_XLSX_ROWS = 1_048_576;
export const MAX_XLSX_COLUMNS = 16_384;

export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function columnLetter(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function cellAddress(row: number, col: number): string {
  return `${columnLetter(col)}${row}`;
}

export function parseAddress(addr: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?([1-9]\d*)$/.exec(addr.trim());
  if (!m) return null;
  const col = columnNumber(m[1]);
  const row = Number(m[2]);
  if (col > MAX_XLSX_COLUMNS || row > MAX_XLSX_ROWS) return null;
  return { row, col };
}

/** Parses "B2:D10" (either corner order) or a single cell "B2". */
export function parseRange(s: string): CellRange | null {
  const parts = s.trim().split(":");
  if (parts.length > 2) return null;
  const a = parseAddress(parts[0]);
  const b = parseAddress(parts[1] ?? parts[0]);
  if (!a || !b) return null;
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

export function formatRange(r: CellRange): string {
  return `${cellAddress(r.top, r.left)}:${cellAddress(r.bottom, r.right)}`;
}

export function intersects(a: CellRange, b: CellRange): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}

export function contains(r: CellRange, row: number, col: number): boolean {
  return row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;
}
