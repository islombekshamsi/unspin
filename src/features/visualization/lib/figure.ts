import Decimal from "decimal.js";
import type { Config, Data, Layout } from "plotly.js";
import type { ChartKind, ChartPoint } from "@/contracts";
import { categoryOrder, markerSymbol, shortLabel, sortByX, type XKind, type YScale } from "./presentation";

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

const INK_FAINT = "#8a857b";
const INK = "#1b1a17";
const MISSING_LABEL = "Missing value (no y)";

/** Plot coordinates. The only place decimal strings become Numbers, and only for drawing. */
export function plotX(x: string | null, kind: XKind): string | number | null {
  if (x === null) return null;
  return kind === "numeric" ? Number(x) : x;
}

export function plotY(y: string | null): number | null {
  return y === null ? null : Number(y);
}

function isZero(y: string | null): boolean {
  if (y === null) return false;
  try {
    return new Decimal(y).isZero();
  } catch {
    return false;
  }
}

/** Traces for the series plus a "missing" rug on a hidden overlay axis and a keyboard-focus ring. */
export function buildTraces(input: FigureInput): Data[] {
  const { kind, xKind, highlighted } = input;
  const traces: Data[] = [];
  const missing: Array<{ p: ChartPoint; s: FigureSeries }> = [];

  for (const s of input.series) {
    const pts = kind === "line" && xKind !== "category" ? sortByX(s.points, xKind, input.allPoints) : s.points;
    for (const p of pts) if (p.y === null) missing.push({ p, s });
    const selected = highlighted.size ? pts.flatMap((p, i) => (highlighted.has(p.pointId) ? [i] : [])) : undefined;
    const common = {
      name: s.label,
      x: pts.map((p) => plotX(p.x, xKind)),
      y: pts.map((p) => plotY(p.y)),
      customdata: pts.map((p) => p.pointId),
      hovertext: pts.map((p) => input.describe(p)),
      hovertemplate: "%{hovertext}<extra></extra>",
      ...(selected ? { selectedpoints: selected } : {}),
    };
    if (kind === "bar") {
      traces.push({
        ...common,
        type: "bar",
        text: pts.map((p) => (isZero(p.y) ? "0" : "")),
        textposition: "outside",
        cliponaxis: false,
        marker: {
          color: s.color,
          line: { color: s.color, width: 1.5 },
          pattern: {
            shape: pts.map((p) => (p.yOrigin === "estimated" ? "/" : p.yOrigin === "user_edit" ? "x" : "")),
            fgcolor: s.color,
            bgcolor: "#ffffff",
            fgopacity: 1,
            solidity: 0.35,
            size: 7,
          },
        },
        selected: { marker: { opacity: 1 } },
        unselected: { marker: { opacity: 0.3 } },
      } as Data);
    } else {
      traces.push({
        ...common,
        type: "scatter",
        mode: kind === "line" ? "lines+markers" : "markers",
        connectgaps: false,
        line: { color: s.color, dash: s.dash, width: 2 },
        marker: {
          color: s.color,
          size: 9,
          symbol: pts.map((p) => markerSymbol(s.symbol, p.yOrigin)),
          line: { color: s.color, width: 1.5 },
        },
        selected: { marker: { opacity: 1, size: 13 } },
        unselected: { marker: { opacity: 0.3 } },
      } as Data);
    }
  }

  if (missing.length) {
    const selected = highlighted.size ? missing.flatMap(({ p }, i) => (highlighted.has(p.pointId) ? [i] : [])) : undefined;
    traces.push({
      type: "scatter",
      mode: "markers",
      name: MISSING_LABEL,
      yaxis: "y2",
      x: missing.map(({ p }) => plotX(p.x, xKind)),
      y: missing.map(() => 0.03),
      customdata: missing.map(({ p }) => p.pointId),
      hovertext: missing.map(({ p }) => input.describe(p)),
      hovertemplate: "%{hovertext}<extra></extra>",
      marker: { symbol: "line-ns-open", size: 14, color: INK_FAINT, line: { width: 2, color: INK_FAINT } },
      ...(selected ? { selectedpoints: selected } : {}),
      selected: { marker: { opacity: 1 } },
      unselected: { marker: { opacity: 0.3 } },
    } as Data);
  }

  const focus = input.focusPointId ? input.allPoints.find((p) => p.pointId === input.focusPointId) : undefined;
  if (focus) {
    traces.push({
      type: "scatter",
      mode: "markers",
      name: "Keyboard focus",
      showlegend: false,
      hoverinfo: "skip",
      yaxis: focus.y === null ? "y2" : "y",
      x: [plotX(focus.x, xKind)],
      y: [focus.y === null ? 0.03 : plotY(focus.y)],
      marker: { symbol: "circle-open", size: 22, color: INK, line: { width: 2, color: INK } },
    } as Data);
  }
  return traces;
}

export interface LayoutInput {
  kind: ChartKind;
  xKind: XKind;
  xTitle: string;
  yTitle: string;
  yScale: YScale;
  yRange: [number, number] | null;
  allPoints: ChartPoint[];
  /** Changes when the underlying data changes; keeps user zoom across presentation edits. */
  uirevision: string;
}

export function buildLayout(input: LayoutInput): Partial<Layout> {
  const categories = input.xKind === "category" ? [...categoryOrder(input.allPoints).keys()] : [];
  return {
    autosize: true,
    margin: { l: 8, r: 16, t: 8, b: 8, pad: 4 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif", size: 12, color: INK },
    dragmode: "select",
    hovermode: "closest",
    barmode: "group",
    showlegend: true,
    legend: { orientation: "h", x: 0, xanchor: "left", y: 1.02, yanchor: "bottom" },
    uirevision: input.uirevision,
    xaxis: {
      title: { text: input.xTitle },
      type: input.xKind === "numeric" ? "linear" : input.xKind === "date" ? "date" : "category",
      automargin: true,
      tickangle: "auto",
      gridcolor: "#e3ded4",
      linecolor: "#cfc8bb",
      zeroline: false,
      ...(input.xKind === "category"
        ? { categoryorder: "array", categoryarray: categories, tickmode: "array", tickvals: categories, ticktext: categories.map((c) => shortLabel(c)) }
        : {}),
    } as Partial<Layout["xaxis"]>,
    yaxis: {
      title: { text: input.yTitle },
      type: input.yScale,
      automargin: true,
      gridcolor: "#e3ded4",
      linecolor: "#cfc8bb",
      zeroline: input.yScale === "linear",
      zerolinecolor: "#5c5850",
      zerolinewidth: 1.5,
      ...(input.yRange ? { range: input.yRange, autorange: false } : { autorange: true }),
    },
    yaxis2: { overlaying: "y", range: [0, 1], visible: false, fixedrange: true, showgrid: false, zeroline: false },
  };
}

export const PLOT_CONFIG: Partial<Config> = {
  displaylogo: false,
  responsive: false,
  scrollZoom: false,
  showSendToCloud: false,
  showEditInChartStudio: false,
  // "sendChartToCloud" uploads the figure to Plotly's service; user data must never leave this app that way.
  // Exported images would lose the reconstruction caption, so "toImage" is removed too.
  modeBarButtonsToRemove: ["toImage", "sendDataToCloud", "sendChartToCloud"] as unknown as NonNullable<Config["modeBarButtonsToRemove"]>,
};
