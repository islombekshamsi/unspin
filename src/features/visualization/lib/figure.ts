import Decimal from "decimal.js";
import type { ChartKind, ChartPoint } from "@/contracts";
import { categoryOrder, shortLabel, sortByX, type PointOrigin, type XKind, type YScale } from "./presentation";

export interface FigureSeries {
  seriesId: string;
  yColumnId: string;
  label: string;
  color: string;
  symbol: string;
  dash: string;
  /** Points of this series in result order. */
  points: ChartPoint[];
}

export interface FigureInput {
  kind: ChartKind;
  xKind: XKind;
  series: FigureSeries[];
  /** Every point in the result (for category order). */
  allPoints: ChartPoint[];
  highlighted: Set<string>;
  focusPointId: string | null;
  describe: (p: ChartPoint) => string;
}

export interface PlotModelInput extends FigureInput {
  xTitle: string;
  yTitle: string;
  yScale: YScale;
  /** Plotly-style range: data units for linear, log10 units for log. */
  yRange: [number, number] | null;
  /** True when the user set explicit bounds (values outside are clipped from view). */
  clipToBounds: boolean;
}

/** One plotted mark. Decimal strings stay on the ChartPoint; y is for drawing only. */
export interface PlotPoint {
  pointId: string;
  seriesId: string;
  x: string | number;
  xLabel: string;
  /** Number for drawing. Null is a gap, never a substituted zero. */
  y: number | null;
  yRaw: string | null;
  origin: PointOrigin;
  description: string;
}

export interface AlignedRow {
  x: string | number;
  xLabel: string;
  values: Record<string, number | null>;
  meta: Record<string, { pointId: string; origin: PointOrigin; description: string; yRaw: string | null }>;
}

export type PlotDataMode = "aligned" | "independent";

export interface PlotModel {
  kind: ChartKind;
  xKind: XKind;
  xTitle: string;
  yTitle: string;
  yScale: YScale;
  /** Domain in data units for Recharts (not log10). */
  yDomain: [number, number] | null;
  /** Numeric/date x domain from the plotted values. Null for categories. */
  xDomain: [number, number] | null;
  clipToBounds: boolean;
  dataMode: PlotDataMode;
  categories: string[];
  series: Array<FigureSeries & { plotPoints: PlotPoint[] }>;
  aligned: AlignedRow[];
  missing: PlotPoint[];
  focus: PlotPoint | null;
  highlighted: Set<string>;
  connectGaps: false;
}

/** Plot coordinates. The only place decimal strings become Numbers, and only for drawing. */
export function plotX(x: string | null, kind: XKind): string | number | null {
  if (x === null) return null;
  if (kind === "numeric") return Number(x);
  if (kind === "date") {
    const t = Date.parse(x);
    return Number.isFinite(t) ? t : x;
  }
  return x;
}

export function plotY(y: string | null): number | null {
  return y === null ? null : Number(y);
}

/** Converts the Plotly-style y range into a Recharts domain in data units. */
export function rechartsYDomain(range: [number, number] | null, scale: YScale): [number, number] | null {
  if (!range) return null;
  if (scale === "log") return [10 ** range[0], 10 ** range[1]];
  return range;
}

/**
 * Fit numeric/date x to the plotted values. Recharts' number axis otherwise
 * includes 0, which crushes a decimal-date series (1974–2026) to one edge.
 */
export function numericXDomain(points: Array<{ x: string | number }>): [number, number] | null {
  const xs = points.map((p) => p.x).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (!xs.length) return null;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return min === max ? [min - 1, max + 1] : [min, max];
}

export function strokeDasharray(dash: string): string | undefined {
  switch (dash) {
    case "dash":
      return "6 4";
    case "dot":
      return "2 3";
    case "dashdot":
      return "6 3 2 3";
    case "longdash":
      return "12 4";
    case "longdashdot":
      return "12 4 2 4";
    default:
      return undefined;
  }
}

export function isZeroY(y: string | null): boolean {
  if (y === null) return false;
  try {
    return new Decimal(y).isZero();
  } catch {
    return false;
  }
}

function toPlotPoint(p: ChartPoint, series: FigureSeries, xKind: XKind, describe: (p: ChartPoint) => string): PlotPoint | null {
  const x = plotX(p.x, xKind);
  if (x === null) return null;
  return {
    pointId: p.pointId,
    seriesId: series.seriesId,
    x,
    xLabel: p.x === null ? "" : xKind === "category" ? shortLabel(p.x) : p.x,
    y: plotY(p.y),
    yRaw: p.y,
    origin: p.yOrigin,
    description: describe(p),
  };
}

function xKeys(xKind: XKind, allPoints: ChartPoint[]): Array<{ key: string; x: string | number; xLabel: string }> {
  if (xKind === "category") {
    return [...categoryOrder(allPoints).keys()].map((label) => ({ key: label, x: label, xLabel: shortLabel(label) }));
  }
  const seen = new Set<string>();
  const keys: Array<{ key: string; x: string | number; xLabel: string }> = [];
  const ordered = sortByX(
    allPoints.filter((p) => p.x !== null),
    xKind,
    allPoints,
  );
  for (const p of ordered) {
    const x = plotX(p.x, xKind);
    if (x === null || seen.has(p.x!)) continue;
    seen.add(p.x!);
    keys.push({ key: p.x!, x, xLabel: p.x! });
  }
  return keys;
}

/**
 * Presentation-only plot model. Underlying values stay the exact decimal strings
 * from buildChartQuery; missing y is null (a gap), never zero.
 */
export function buildPlotModel(input: PlotModelInput): PlotModel {
  const { kind, xKind } = input;
  const series = input.series.map((s) => {
    const pts = kind === "line" && xKind !== "category" ? sortByX(s.points, xKind, input.allPoints) : s.points;
    const plotPoints = pts.flatMap((p) => {
      const plotted = toPlotPoint(p, s, xKind, input.describe);
      return plotted ? [plotted] : [];
    });
    return { ...s, points: pts, plotPoints };
  });

  const keys = xKeys(xKind, input.allPoints);
  const aligned: AlignedRow[] = keys.map((k) => {
    const values: AlignedRow["values"] = {};
    const meta: AlignedRow["meta"] = {};
    for (const s of series) {
      const hit = s.plotPoints.find((p) => (typeof k.x === "number" ? p.x === k.x : p.x === k.x || p.xLabel === k.xLabel));
      if (!hit) continue;
      values[s.seriesId] = hit.y;
      meta[s.seriesId] = { pointId: hit.pointId, origin: hit.origin, description: hit.description, yRaw: hit.yRaw };
    }
    return { x: k.x, xLabel: k.xLabel, values, meta };
  });

  const missing = series.flatMap((s) => s.plotPoints.filter((p) => p.y === null));
  const allPlot = series.flatMap((s) => s.plotPoints);
  const focus = input.focusPointId ? (allPlot.find((p) => p.pointId === input.focusPointId) ?? null) : null;
  const dataMode: PlotDataMode = kind === "bar" || xKind === "category" ? "aligned" : "independent";

  return {
    kind,
    xKind,
    xTitle: input.xTitle,
    yTitle: input.yTitle,
    yScale: input.yScale,
    yDomain: rechartsYDomain(input.yRange, input.yScale),
    xDomain: xKind === "category" ? null : numericXDomain(allPlot),
    clipToBounds: input.clipToBounds,
    dataMode,
    categories: keys.map((k) => k.xLabel),
    series,
    aligned,
    missing,
    focus,
    highlighted: input.highlighted,
    connectGaps: false,
  };
}

/** @deprecated Test helper name: line series sorted by x, gaps kept as null, missing listed separately. */
export function buildTraces(input: FigureInput) {
  const model = buildPlotModel({
    ...input,
    xTitle: "x",
    yTitle: "y",
    yScale: "linear",
    yRange: null,
    clipToBounds: false,
  });
  const series = model.series.map((s) => ({
    name: s.label,
    x: s.plotPoints.map((p) => p.x),
    y: s.plotPoints.map((p) => p.y),
    customdata: s.plotPoints.map((p) => p.pointId),
    selectedpoints: model.highlighted.size ? s.plotPoints.flatMap((p, i) => (model.highlighted.has(p.pointId) ? [i] : [])) : undefined,
    connectgaps: model.connectGaps,
  }));
  return [
    ...series,
    ...(model.missing.length
      ? [
          {
            name: "Missing value (no y)",
            customdata: model.missing.map((p) => p.pointId),
          },
        ]
      : []),
  ];
}
