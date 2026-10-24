import Decimal from "decimal.js";
import type { BaselinePolicy, ChartPoint, ChartQueryResult, Column, ExtractionMethod, SelectionEvent } from "@/contracts";

/** Mirrors --chart-1..6 / --series-1..6 in globals.css. */
export const SERIES_COLORS = ["#0f6e66", "#b45309", "#4338ca", "#be185d", "#4d7c0f", "#0369a1"] as const;
/** Each series also differs by marker symbol and dash so color is never the only signal. */
export const SERIES_SYMBOLS = ["circle", "square", "diamond", "triangle-up", "triangle-down", "star"] as const;
export const SERIES_DASHES = ["solid", "dash", "dot", "dashdot", "longdash", "longdashdot"] as const;
export const MAX_SERIES = 12;

export type YScale = "linear" | "log";
export type XKind = ChartQueryResult["xKind"];
export type PointOrigin = ChartPoint["yOrigin"];

export const ORIGIN_LABEL: Record<PointOrigin, string> = {
  parsed: "parsed from the file",
  transcribed: "transcribed from the source",
  estimated: "estimated from chart",
  derived: "derived by an operation",
  user_edit: "edited by you",
};

export function seriesStyle(index: number) {
  const n = (index % SERIES_COLORS.length) + 1;
  return {
    color: `var(--chart-${n})`,
    symbol: SERIES_SYMBOLS[index % SERIES_SYMBOLS.length],
    dash: SERIES_DASHES[index % SERIES_DASHES.length],
  };
}

/** Marker symbol for one point: open for estimates, open-with-dot for user edits. */
export function markerSymbol(base: string, origin: PointOrigin): string {
  if (origin === "estimated") return `${base}-open`;
  if (origin === "user_edit") return `${base}-open-dot`;
  return base;
}

export function caption(method: ExtractionMethod): string {
  return method === "deterministic_parser"
    ? "Plotted from the imported data"
    : "Reconstructed from the extracted values — not the original figure";
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/** Units shown on an axis, e.g. "USD million", "%", "fraction, 1 = 100%". Null when none recorded. */
export function unitText(column: Column): string | null {
  const parts: string[] = [];
  const money = [column.currency, column.unit].filter(Boolean).join(" ");
  if (money) parts.push(money);
  if (column.percentRepresentation === "percent_number") parts.push("%");
  if (column.percentRepresentation === "fraction") parts.push("fraction, 1 = 100%");
  if (column.dataType === "datetime" && column.datePolicy?.timezone === "utc") parts.push("UTC");
  return parts.length ? parts.join(", ") : null;
}

export function axisTitle(column: Column): string {
  const u = unitText(column);
  return u ? `${column.label} (${u})` : column.label;
}

/** Y-axis title for several series: shared units when they agree, an explicit warning otherwise. */
export function yAxisTitle(columns: Column[]): { title: string; mixedUnits: boolean } {
  if (columns.length === 1) return { title: axisTitle(columns[0]), mixedUnits: false };
  const units = [...new Set(columns.map((c) => unitText(c) ?? "no unit recorded"))];
  if (units.length === 1) return { title: units[0] === "no unit recorded" ? "Value (no unit recorded)" : `Value (${units[0]})`, mixedUnits: false };
  return { title: `Value (mixed units: ${units.join("; ")})`, mixedUnits: true };
}

/** Human value with its units, keeping the stored decimal string exactly. */
export function formatValue(value: string | null, column: Column | undefined): string {
  if (value === null) return "missing";
  if (!column || column.dataType !== "decimal") return value;
  if (column.percentRepresentation === "percent_number") return `${value}%`;
  if (column.percentRepresentation === "fraction") {
    const pct = safeDecimal(value)?.times(100).toString();
    return pct ? `${value} (= ${pct}%)` : value;
  }
  const suffix = [column.currency, column.unit].filter(Boolean).join(" ");
  return suffix ? `${value} ${suffix}` : value;
}

export function describePoint(point: ChartPoint, seriesLabel: string, xColumn: Column | undefined, yColumn: Column | undefined): string {
  const y = point.y === null ? "y missing (shown as a gap)" : `y = ${formatValue(point.y, yColumn)}`;
  return `Series “${seriesLabel}”, source row ${point.sourceOrder + 1}, x = ${formatValue(point.x, xColumn)}, ${y}, ${ORIGIN_LABEL[point.yOrigin]}`;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Disclosure lines for exclusions and sampling. Empty when nothing was left out. */
export function exclusionSummary(result: Pick<ChartQueryResult, "excluded" | "sampling">): string[] {
  const { missingY, nonNumericY, missingX } = result.excluded;
  const parts: string[] = [];
  if (missingY) parts.push(missingY === 1 ? "1 missing value shown as a gap" : `${missingY} missing values shown as gaps`);
  if (nonNumericY) parts.push(`${plural(nonNumericY, "non-numeric value", "non-numeric values")} not plotted`);
  if (missingX) parts.push(`${plural(missingX, "value", "values")} not plotted because x is missing`);
  const lines = parts.length ? [`${parts.join("; ")}.`] : [];
  if (result.sampling) {
    lines.push(
      `Showing ${result.sampling.keptCount.toLocaleString()} of ${result.sampling.totalCount.toLocaleString()} points: every n-th row is kept to stay within the chart limit. Exports still include every row.`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Numeric domain and axis bounds
// ---------------------------------------------------------------------------

export function safeDecimal(s: string): Decimal | null {
  try {
    const d = new Decimal(s.trim());
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export type LogDomainCheck = { ok: true } | { ok: false; nonPositive: number; message: string };

/** A log axis cannot show zero or negative values; refuse instead of dropping them. */
export function checkLogDomain(ys: Array<string | null>): LogDomainCheck {
  let nonPositive = 0;
  for (const y of ys) {
    if (y === null) continue;
    const d = safeDecimal(y);
    if (d && d.lte(0)) nonPositive += 1;
  }
  if (nonPositive === 0) return { ok: true };
  return {
    ok: false,
    nonPositive,
    message: `Log scale is unavailable: ${plural(nonPositive, "plotted value is", "plotted values are")} zero or negative, and a log axis cannot show them. The chart stays linear so no value is dropped.`,
  };
}

export type BoundParse = { ok: true; value: Decimal } | { ok: false; message: string };

export function parseBound(text: string): BoundParse {
  const t = text.trim();
  if (!t) return { ok: false, message: "Enter a number." };
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return { ok: false, message: `“${text}” is not a number.` };
  const d = safeDecimal(t);
  return d ? { ok: true, value: d } : { ok: false, message: `“${text}” is not a number.` };
}

export interface YRange {
  /** Axis range: data units for linear, log10 units for log. Null means let the library fit. */
  range: [number, number] | null;
  /** Human bounds in data units, shown next to the axis title. */
  label: string | null;
  notes: string[];
  error: string | null;
  /** Plotted values outside explicit bounds (they are clipped from view, not removed). */
  outside: number;
}

const PAD = new Decimal("0.05");

/**
 * Computes the y-axis range for a baseline policy. Explicit bounds keep the user's
 * strings for display; the plotting range is the only place values become Numbers.
 */
export function computeYRange(
  policy: BaselinePolicy["mode"],
  ys: Array<string | null>,
  scale: YScale,
  explicit: { min: string; max: string } | null,
): YRange {
  const values = ys.flatMap((y) => {
    const d = y === null ? null : safeDecimal(y);
    return d ? [d] : [];
  });
  const result: YRange = { range: null, label: null, notes: [], error: null, outside: 0 };

  if (policy === "explicit_bounds") {
    const lo = parseBound(explicit?.min ?? "");
    const hi = parseBound(explicit?.max ?? "");
    if (!lo.ok) return { ...result, error: `Minimum: ${lo.message}` };
    if (!hi.ok) return { ...result, error: `Maximum: ${hi.message}` };
    if (!lo.value.lt(hi.value)) return { ...result, error: "The minimum must be less than the maximum." };
    if (scale === "log" && lo.value.lte(0)) return { ...result, error: "On a log scale both bounds must be greater than zero." };
    result.outside = values.filter((v) => v.lt(lo.value) || v.gt(hi.value)).length;
    if (result.outside) {
      result.notes.push(`${plural(result.outside, "value lies", "values lie")} outside the chosen bounds and ${result.outside === 1 ? "is" : "are"} cut off from view (not removed).`);
    }
    result.label = `axis fixed to ${explicit!.min.trim()} – ${explicit!.max.trim()}`;
    result.range = scale === "log" ? [log10(lo.value), log10(hi.value)] : [lo.value.toNumber(), hi.value.toNumber()];
    return result;
  }

  if (values.length === 0) return result;
  let min = Decimal.min(...values);
  let max = Decimal.max(...values);

  if (scale === "log") {
    if (policy === "include_zero") result.notes.push("A log axis cannot include zero, so it shows the data range.");
    const a = log10(min);
    const b = log10(max);
    const pad = a === b ? 0.1 : (b - a) * 0.05;
    result.range = [a - pad, b + pad];
    return result;
  }

  if (policy === "include_zero") {
    min = Decimal.min(min, 0);
    max = Decimal.max(max, 0);
    result.label = "includes zero";
  }
  const span = max.minus(min);
  const pad = span.isZero() ? (max.isZero() ? new Decimal(1) : max.abs().times("0.1")) : span.times(PAD);
  const lo = policy === "include_zero" && min.isZero() && !span.isZero() ? min : min.minus(pad);
  const hi = policy === "include_zero" && max.isZero() && !span.isZero() ? max : max.plus(pad);
  result.range = [lo.toNumber(), hi.toNumber()];
  return result;
}

function log10(d: Decimal): number {
  return Decimal.log10(d).toNumber();
}

// ---------------------------------------------------------------------------
// Ordering, linking, initial choices
// ---------------------------------------------------------------------------

/** Comparator for x strings of one kind. Category order is first appearance in the result. */
export function xComparator(kind: XKind, points: ChartPoint[]): (a: ChartPoint, b: ChartPoint) => number {
  if (kind === "numeric") {
    return (a, b) => {
      const da = a.x === null ? null : safeDecimal(a.x);
      const db = b.x === null ? null : safeDecimal(b.x);
      if (!da || !db) return da ? -1 : db ? 1 : 0;
      return da.comparedTo(db);
    };
  }
  if (kind === "date") {
    return (a, b) => Date.parse(a.x ?? "") - Date.parse(b.x ?? "");
  }
  const order = categoryOrder(points);
  return (a, b) => (order.get(a.x ?? "") ?? 0) - (order.get(b.x ?? "") ?? 0);
}

export function categoryOrder(points: ChartPoint[]): Map<string, number> {
  const order = new Map<string, number>();
  for (const p of points) if (p.x !== null && !order.has(p.x)) order.set(p.x, order.size);
  return order;
}

/** Stable sort by x; ties keep result (source) order. Identities never change. */
export function sortByX(points: ChartPoint[], kind: XKind, all: ChartPoint[] = points): ChartPoint[] {
  const cmp = xComparator(kind, all);
  return points
    .map((p, i) => [p, i] as const)
    .sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1])
    .map(([p]) => p);
}

/** Sorts bare x strings of one kind (category order = given order). */
export function sortXValues(xs: string[], kind: XKind): string[] {
  if (kind === "category") return [...xs];
  const pts = xs.map((x, i) => ({ pointId: String(i), x }) as ChartPoint);
  return sortByX(pts, kind).map((p) => p.x as string);
}

/**
 * Points to highlight for an incoming linked selection. Exact y-cell matches win;
 * otherwise x-cell or row matches; otherwise shared provenance (source selections).
 */
export function highlightedPointIds(points: ChartPoint[], linked: SelectionEvent | null, versionId: string): Set<string> {
  if (!linked || linked.datasetVersionId !== versionId) return new Set();
  const cells = new Set(linked.cellIds);
  const byY = points.filter((p) => cells.has(p.yCellId));
  if (byY.length) return new Set(byY.map((p) => p.pointId));
  const rows = new Set(linked.rowIds);
  const byRow = points.filter((p) => cells.has(p.xCellId) || rows.has(p.rowId));
  if (byRow.length) return new Set(byRow.map((p) => p.pointId));
  if (linked.origin === "source" && linked.provenanceIds.length) {
    const prov = new Set(linked.provenanceIds);
    return new Set(points.filter((p) => p.provenanceIds.some((id) => prov.has(id))).map((p) => p.pointId));
  }
  return new Set();
}

export function selectionEventFor(points: ChartPoint[], versionId: string): SelectionEvent {
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    origin: "chart",
    datasetVersionId: versionId,
    rowIds: uniq(points.map((p) => p.rowId)),
    cellIds: uniq([...points.map((p) => p.yCellId), ...points.map((p) => p.xCellId)]),
    provenanceIds: uniq(points.flatMap((p) => p.provenanceIds)),
  };
}

export interface InitialChoice {
  xColumnId: string | null;
  yColumnIds: string[];
}

/** Sensible starting columns from semantic roles; falls back to decimal columns. */
export function initialChoice(columns: Column[]): InitialChoice {
  const x =
    columns.find((c) => c.semanticRole === "x") ??
    columns.find((c) => c.dataType === "date" || c.dataType === "datetime") ??
    columns.find((c) => c.semanticRole === "category") ??
    columns[0];
  const others = columns.filter((c) => c.id !== x?.id);
  let ys = others.filter((c) => c.semanticRole === "y");
  if (ys.length === 0) ys = others.filter((c) => c.dataType === "decimal");
  return { xColumnId: x?.id ?? null, yColumnIds: ys.slice(0, SERIES_COLORS.length).map((c) => c.id) };
}

/** Truncates long category labels for ticks; the full text stays in hover and the table. */
export function shortLabel(text: string, max = 24): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
