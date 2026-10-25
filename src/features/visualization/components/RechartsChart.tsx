"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Bar,
  Line,
  Scatter,
  XAxis,
  YAxis,
  ReferenceDot,
  ReferenceLine,
  LabelList,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig as RechartsChartConfig,
} from "@/components/ui/chart";
import { Button, cx } from "@/components/ui";
import { downloadChartPng } from "../lib/export-chart";
import { axisDistribution, safeSeriesDomain } from "../lib/auto-fit";
import { axisNumber, hasNumericPlotPoint, numericAxisWidth } from "../lib/axis-layout";
import { zoomAt, zoomDomain } from "../lib/zoom";
import type { PointOrigin } from "../lib/presentation";
import { shortLabel } from "../lib/presentation";
import { isZeroY, strokeDasharray, type PlotModel, type PlotPoint } from "../lib/figure";

export interface RechartsChartProps {
  exportTitle?: string;
  exportNote?: string;
  exportBlocked?: boolean;
  model: PlotModel;
  /** Screen-reader summary; the navigator and data table are the accessible alternative. */
  label: string;
  className?: string;
  onPointClick?: (pointId: string) => void;
  onPointsSelected?: (pointIds: string[]) => void;
  onDeselect?: () => void;
  onHover?: (pointId: string | null) => void;
}

type Row = Record<string, unknown>;

function statNumber(value: number) {
  return Number.isFinite(value) ? String(Number(value.toPrecision(5))) : "outside display precision";
}

function cssId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function flattenAligned(model: PlotModel): Row[] {
  return model.aligned.map((row) => {
    const out: Row = { x: row.x, xLabel: row.xLabel };
    for (const [sid, y] of Object.entries(row.values)) {
      out[sid] = y;
      const meta = row.meta[sid];
      if (!meta) continue;
      out[`${sid}__id`] = meta.pointId;
      out[`${sid}__origin`] = meta.origin;
      out[`${sid}__desc`] = meta.description;
      out[`${sid}__zero`] = isZeroY(meta.yRaw);
    }
    return out;
  });
}

function independentRows(points: PlotPoint[], seriesId: string): Row[] {
  return points.map((p) => ({
    ...p,
    [seriesId]: p.y,
  }));
}

function pointIdFromRow(row: Row | undefined, dataKey: string): string | null {
  if (!row) return null;
  if (typeof row.pointId === "string") return row.pointId;
  const keyed = row[`${dataKey}__id`];
  return typeof keyed === "string" ? keyed : null;
}

function descriptionFromRow(row: Row | undefined, dataKey: string): string | null {
  if (!row) return null;
  if (typeof row.description === "string") return row.description;
  const keyed = row[`${dataKey}__desc`];
  return typeof keyed === "string" ? keyed : null;
}

function starPoints(cx: number, cy: number, outer: number, inner: number, spikes: number) {
  const pts: string[] = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return pts.join(" ");
}

function MarkerSymbol({
  cx,
  cy,
  symbol,
  color,
  origin,
}: {
  cx: number;
  cy: number;
  symbol: string;
  color: string;
  origin: PointOrigin;
}) {
  const open = origin === "estimated" || origin === "user_edit";
  const fill = open ? "var(--surface)" : color;
  const r = 5;
  const common = { fill, stroke: color, strokeWidth: 1.5 };
  let mark: ReactNode;
  switch (symbol) {
    case "square":
      mark = <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} {...common} />;
      break;
    case "diamond":
      mark = <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} {...common} />;
      break;
    case "triangle-up":
      mark = <polygon points={`${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`} {...common} />;
      break;
    case "triangle-down":
      mark = <polygon points={`${cx - r},${cy - r} ${cx + r},${cy - r} ${cx},${cy + r}`} {...common} />;
      break;
    case "star":
      mark = <polygon points={starPoints(cx, cy, r, r / 2.3, 5)} {...common} />;
      break;
    default:
      mark = <circle cx={cx} cy={cy} r={r} {...common} />;
  }
  return (
    <>
      {mark}
      {origin === "user_edit" ? <circle cx={cx} cy={cy} r={1.6} fill={color} /> : null}
    </>
  );
}

function collectPointIds(host: HTMLElement, rect: DOMRect): string[] {
  const ids: string[] = [];
  host.querySelectorAll("[data-point-id]").forEach((el) => {
    const box = el.getBoundingClientRect();
    if (box.right < rect.left || box.left > rect.right || box.bottom < rect.top || box.top > rect.bottom) return;
    const id = el.getAttribute("data-point-id");
    if (id) ids.push(id);
  });
  return [...new Set(ids)];
}

function PlotTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; payload?: Row }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload.find((p) => p.dataKey !== "rug") ?? payload[0];
  const desc = descriptionFromRow(item.payload, String(item.dataKey ?? ""));
  if (!desc) return null;
  return <div className="max-w-sm rounded-md border border-rule bg-surface px-2.5 py-1.5 text-[12px] leading-4 text-ink shadow-overlay">{desc}</div>;
}

/**
 * Recharts adapter for bar, line, and scatter. Values stay exact decimal strings
 * on the source points; this component only draws Numbers.
 */
export function RechartsChart({ model, label, exportTitle, exportNote, exportBlocked, className, onPointClick, onPointsSelected, onDeselect, onHover }: RechartsChartProps) {
  const uid = useId().replace(/:/g, "");
  const hostRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const config = useMemo<RechartsChartConfig>(
    () => Object.fromEntries(model.series.map((s) => [s.seriesId, { label: s.label, color: s.color }])),
    [model.series],
  );

  const alignedData = useMemo(() => flattenAligned(model), [model]);
  const axisTicks = useMemo(() => {
    if (model.dataMode === "aligned") return alignedData;
    const seen = new Set<string>();
    const rows: Row[] = [];
    for (const s of model.series) {
      for (const p of s.plotPoints) {
        const key = String(p.x);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ x: p.x, xLabel: p.xLabel });
      }
    }
    return rows;
  }, [model, alignedData]);

  const numericX = model.xKind !== "category";
  const [autoFit, setAutoFit] = useState(true);
  const distributions = useMemo(() => {
    const series = model.series.map((s) => s.plotPoints);
    const xs = series.map((points) => points.map((p) => p.x).filter((x): x is number => typeof x === "number" && Number.isFinite(x)));
    const ys = series.map((points) => points.map((p) => p.y).filter((y): y is number => y !== null && Number.isFinite(y)));
    const x = model.xKind === "numeric" ? axisDistribution([...new Set(xs.flat())]) : null;
    const y = axisDistribution(ys.flat(), model.yScale === "log");
    const xDomain = model.xKind === "numeric" ? safeSeriesDomain(x?.domain ?? null, xs) : null;
    let yDomain = model.clipToBounds ? null : safeSeriesDomain(y?.domain ?? null, ys);
    if (yDomain && model.kind === "bar" && model.yScale === "linear") {
      yDomain[0] = Math.min(0, yDomain[0]); yDomain[1] = Math.max(0, yDomain[1]);
    }
    if (xDomain && yDomain && series.some((points) => points.filter((p) =>
      (typeof p.x !== "number" || (p.x >= xDomain[0] && p.x <= xDomain[1])) &&
      (p.y === null || (p.y >= yDomain![0] && p.y <= yDomain![1]))).length < points.length * 0.9)) yDomain = null;
    return { x, y, xDomain, yDomain, bySeries: ys.map((values, i) => ({ label: model.series[i].label, stats: axisDistribution(values, model.yScale === "log") })) };
  }, [model]);
  const fittedX = autoFit && distributions.xDomain ? distributions.xDomain : model.xDomain;
  const fittedY = autoFit && distributions.yDomain ? distributions.yDomain : model.yDomain;
  const focused = autoFit && !!(distributions.xDomain || distributions.yDomain);
  const outside = focused ? model.series.flatMap((s) => s.plotPoints).filter((p) =>
    (typeof p.x === "number" && fittedX && (p.x < fittedX[0] || p.x > fittedX[1])) ||
    (p.y !== null && fittedY && (p.y < fittedY[0] || p.y > fittedY[1]))).length : 0;
  const zoomKey = JSON.stringify([fittedX, fittedY, model.xTitle, model.yTitle, model.yScale, model.categories]);
  const [viewport, setViewport] = useState({ key: zoomKey, x: 1, y: 1, offsetX: 0, offsetY: 0 });
  const zoom = viewport.key === zoomKey ? viewport : { key: zoomKey, x: 1, y: 1, offsetX: 0, offsetY: 0 };
  const magnify = (factor: number, x = 0.5, y = 0.5) => setViewport((previous) => {
    const current = previous.key === zoomKey ? previous : { key: zoomKey, x: 1, y: 1, offsetX: 0, offsetY: 0 };
    const nextX = zoomAt(current.x, current.offsetX, factor, x);
    const nextY = zoomAt(current.y, current.offsetY, factor, y);
    return { key: zoomKey, x: nextX.factor, y: nextY.factor, offsetX: nextX.offset, offsetY: nextY.offset };
  });
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const wheel = (event: WheelEvent) => {
      const bounds = host.querySelector(".recharts-cartesian-grid")?.getBoundingClientRect();
      if (!bounds || !bounds.width || !bounds.height || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      const factor = Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.006);
      setViewport((previous) => {
        const current = previous.key === zoomKey ? previous : { key: zoomKey, x: 1, y: 1, offsetX: 0, offsetY: 0 };
        const nextX = zoomAt(current.x, current.offsetX, factor, (event.clientX - bounds.left) / bounds.width);
        const nextY = zoomAt(current.y, current.offsetY, factor, 1 - (event.clientY - bounds.top) / bounds.height);
        return { key: zoomKey, x: nextX.factor, y: nextY.factor, offsetX: nextX.offset, offsetY: nextY.offset };
      });
    };
    host.addEventListener("wheel", wheel, { passive: false });
    return () => host.removeEventListener("wheel", wheel);
  }, [zoomKey]);
  const xDomain = useMemo(() => fittedX ? zoomDomain(fittedX, zoom.x, zoom.offsetX) : null, [fittedX, zoom.x, zoom.offsetX]);
  const yDomain = useMemo(() => fittedY ? zoomDomain(fittedY, zoom.y, zoom.offsetY, model.yScale === "log") : null, [fittedY, zoom.y, zoom.offsetY, model.yScale]);
  const categoryCount = Math.max(1, Math.ceil(alignedData.length / zoom.x));
  const categoryStart = Math.max(0, Math.min(alignedData.length - categoryCount, Math.round((alignedData.length - categoryCount) / 2 + zoom.offsetX * alignedData.length)));
  const visibleData = useMemo(() => numericX ? axisTicks : alignedData.slice(categoryStart, categoryStart + categoryCount), [numericX, axisTicks, alignedData, categoryStart, categoryCount]);
  const seriesRenderers = useMemo(() => model.series.filter((series) => hasNumericPlotPoint(series.plotPoints)).map((series) => ({
    ...series,
    data: model.dataMode === "independent" ? independentRows(model.kind === "scatter" ? series.plotPoints.filter((p) => p.y !== null) : series.plotPoints, series.seriesId) : undefined,
    marker: originDot(series.seriesId, series.symbol, series.color, model.highlighted),
    barShape: originBar(series.seriesId, series.color, model.highlighted, uid),
  })), [model.series, model.dataMode, model.kind, model.highlighted, uid]);
  const rugData = useMemo(() => model.missing.map((p) => ({ ...p, rug: 0.03 })), [model.missing]);
  const xLabel = useMemo(() => ({ value: model.xTitle, position: "insideBottom" as const, offset: -18, fill: "var(--ink-muted)", fontSize: 12 }), [model.xTitle]);
  const yLabel = useMemo(() => ({ value: model.yTitle, angle: -90, position: "insideLeft" as const, fill: "var(--ink-muted)", fontSize: 12 }), [model.yTitle]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY };
    setBox(null);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start) {
      const width = Math.abs(e.clientX - start.x);
      const height = Math.abs(e.clientY - start.y);
      if (width > 4 || height > 4) {
        const host = hostRef.current?.getBoundingClientRect();
        if (host) {
          setBox({
            left: Math.min(start.x, e.clientX) - host.left,
            top: Math.min(start.y, e.clientY) - host.top,
            width,
            height,
          });
        }
      }
    }
    const id = (e.target as Element | null)?.closest?.("[data-point-id]")?.getAttribute("data-point-id") ?? null;
    onHover?.(id);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    drag.current = null;
    setBox(null);
    if (!start) return;
    const host = hostRef.current;
    const moved = Math.abs(e.clientX - start.x) > 4 || Math.abs(e.clientY - start.y) > 4;
    if (moved && host) {
      const rect = new DOMRect(Math.min(start.x, e.clientX), Math.min(start.y, e.clientY), Math.abs(e.clientX - start.x), Math.abs(e.clientY - start.y));
      const ids = collectPointIds(host, rect);
      if (ids.length) onPointsSelected?.(ids);
      else onDeselect?.();
      return;
    }
    const id = (e.target as Element | null)?.closest?.("[data-point-id]")?.getAttribute("data-point-id");
    if (id) onPointClick?.(id);
    else onDeselect?.();
  };

  const tickFormatter = useCallback((value: unknown) => {
    if (model.xKind === "category") return shortLabel(String(value));
    if (model.xKind === "date") {
      const n = typeof value === "number" ? value : Date.parse(String(value));
      if (Number.isFinite(n)) return new Date(n).toISOString().slice(0, 10);
    }
    return typeof value === "number" ? axisNumber(value) : String(value);
  }, [model.xKind]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <label className="flex items-center gap-2"><input type="checkbox" checked={autoFit} onChange={(e) => setAutoFit(e.target.checked)} />Auto fit data</label>
        <span role="status">{focused ? `Focused on the main distribution · ${outside} plotted points outside the initial range. Turn off Auto fit to see the full range.` : "Full range shown."}</span>
        <details className="relative"><summary className="cursor-pointer">Range statistics</summary>
          <div className="absolute top-full left-0 z-40 w-72 rounded-lg border border-rule bg-surface p-3 shadow-overlay">
            <p>Approximate statistics of plotted values; variance and SD use the sample formula. No values are changed or removed.</p>
            {[{ label: 'X (distinct numeric positions)', stats: distributions.x }, ...distributions.bySeries].map(({ label, stats }) => stats && <p key={label} className="mt-2">{label}: n={stats.count}, range {statNumber(stats.min)}–{statNumber(stats.max)}, median {statNumber(stats.median)}, mean {statNumber(stats.mean)}, SD {stats.count > 1 ? statNumber(stats.sd) : "not defined for one value"}, variance {stats.count > 1 ? statNumber(stats.variance) : "not defined for one value"} (axis units squared).</p>)}
            <p className="mt-2">Focus uses a 3× interquartile-range fence only when isolated extremes compress at least 90% of each series. Dates keep their full range; bars keep zero. Counts reflect plotted data, including any query sampling.</p>
          </div>
        </details>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">Scroll over the plot to zoom toward your pointer · Double-click to reset.</p>
        {exportTitle && <Button size="sm" disabled={exporting || exportBlocked} title={exportBlocked ? "Acknowledge partial coverage before exporting." : "Download the current chart as a PNG image"} onClick={async () => {
          const svg = hostRef.current?.querySelector<SVGSVGElement>("svg.recharts-surface");
          if (!svg) return;
          setExporting(true); setExportError(null);
          try {
            await downloadChartPng(svg, { title: exportTitle, subtitle: label.split(". Use the point navigator")[0], note: `${exportNote ?? ""}${focused ? ` Automatic distribution fit: ${outside} plotted points outside the initial view; observations are retained in the data.` : ""}${zoom.x > 1 || zoom.y > 1 ? " Zoomed viewport; some observations are outside the visible range." : ""}`, legend: seriesRenderers.map((s) => ({ label: s.label, color: s.color })) });
          } catch (e) { setExportError(e instanceof Error ? e.message : "The graph could not be exported."); }
          finally { setExporting(false); }
        }}>{exporting ? "Exporting…" : "Export graph"}</Button>}
      </div>
      {exportError && <p role="alert" className="text-xs text-danger">{exportError}</p>}
      {exportBlocked && <p className="text-xs text-ink-muted">Acknowledge the dataset’s partial coverage before exporting.</p>}
    <div
      ref={hostRef}
      tabIndex={0}
      role="group"
      aria-label="Interactive chart. Scroll to zoom, double-click to reset. Keyboard: plus or minus to zoom, zero to reset."
      onDoubleClick={() => setViewport({ key: zoomKey, x: 1, y: 1, offsetX: 0, offsetY: 0 })}
      onKeyDown={(event) => {
        if (event.key === "+" || event.key === "=") { event.preventDefault(); magnify(2); }
        if (event.key === "-") { event.preventDefault(); magnify(0.5); }
        if (event.key === "0") setViewport({ key: zoomKey, x: 1, y: 1, offsetX: 0, offsetY: 0 });
      }}
      className={cx("relative min-h-0 flex-1 select-none", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => onHover?.(null)}
    >
      <p className="sr-only">{label}</p>
      <ChartContainer config={config} className="h-full min-h-0 w-full aspect-auto">
        <ComposedChart
          accessibilityLayer
          data={visibleData}
          margin={{ top: 12, right: 16, bottom: 28, left: 8 }}
          desc={label}
        >
          <defs>
            {model.series.map((s) => {
              const id = cssId(s.seriesId);
              return (
                <g key={s.seriesId}>
                  <pattern id={`${uid}-est-${id}`} patternUnits="userSpaceOnUse" width="7" height="7">
                    <rect width="7" height="7" fill="var(--surface)" />
                    <path d="M0 7 L7 0" stroke={s.color} strokeWidth="1.2" />
                  </pattern>
                  <pattern id={`${uid}-edit-${id}`} patternUnits="userSpaceOnUse" width="7" height="7">
                    <rect width="7" height="7" fill="var(--surface)" />
                    <path d="M0 7 L7 0 M0 0 L7 7" stroke={s.color} strokeWidth="1.2" />
                  </pattern>
                </g>
              );
            })}
          </defs>
          <CartesianGrid vertical={numericX} stroke="var(--rule)" />
          <XAxis
            dataKey="x"
            type={numericX ? "number" : "category"}
            domain={numericX ? (xDomain ?? ["dataMin", "dataMax"]) : undefined}
            allowDataOverflow={numericX}
            tickFormatter={tickFormatter}
            tickLine={false}
            axisLine={{ stroke: "var(--rule-strong)" }}
            interval="preserveStartEnd"
            label={xLabel}
          />
          <YAxis
            yAxisId="y"
            type="number"
            scale={model.yScale === "log" ? "log" : "linear"}
            domain={yDomain ?? ["auto", "auto"]}
            allowDataOverflow={model.clipToBounds || focused || zoom.y > 1 || zoom.offsetY !== 0}
            width={numericAxisWidth(yDomain)}
            tickFormatter={axisNumber}
            tickLine={false}
            axisLine={{ stroke: "var(--rule-strong)" }}
            label={yLabel}
          />
          <YAxis yAxisId="rug" orientation="right" hide domain={[0, 1]} width={0} />
          {model.yScale === "linear" ? <ReferenceLine yAxisId="y" y={0} stroke="var(--ink-muted)" strokeWidth={1.5} ifOverflow="hidden" /> : null}
          <ChartTooltip content={<PlotTooltip />} />
          <ChartLegend verticalAlign="top" content={<ChartLegendContent verticalAlign="top" />} />
          {model.kind === "bar"
            ? seriesRenderers.map((s) => (
                <Bar
                  key={s.seriesId}
                  yAxisId="y"
                  name={s.label}
                  dataKey={s.seriesId}
                  fill={`var(--color-${s.seriesId})`}
                  isAnimationActive="auto"
                  maxBarSize={48}
                  shape={s.barShape}
                >
                  <LabelList
                    dataKey={s.seriesId}
                    content={ZeroLabel}
                  />
                </Bar>
              ))
            : null}
          {model.kind === "line"
            ? seriesRenderers.map((s) => (
                <Line
                  key={s.seriesId}
                  yAxisId="y"
                  type="linear"
                  name={s.label}
                  dataKey={s.seriesId}
                  data={s.data}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={strokeDasharray(s.dash)}
                  connectNulls={false}
                  isAnimationActive="auto"
                  dot={s.marker}
                  activeDot={s.marker}
                />
              ))
            : null}
          {model.kind === "scatter"
            ? seriesRenderers.map((s) => (
                <Scatter
                  key={s.seriesId}
                  yAxisId="y"
                  name={s.label}
                  dataKey={s.seriesId}
                  data={s.data}
                  fill={s.color}
                  isAnimationActive="auto"
                  shape={s.marker}
                />
              ))
            : null}
          {model.missing.length > 0 ? (
            <Scatter
              yAxisId="rug"
              name="Missing value (no y)"
              legendType="none"
              data={rugData}
              dataKey="rug"
              isAnimationActive={false}
              shape={(props) => {
                const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: PlotPoint };
                if (cx == null || cy == null || !payload) return null;
                const selected = model.highlighted.size === 0 || model.highlighted.has(payload.pointId);
                return (
                  <g data-point-id={payload.pointId} opacity={selected ? 1 : 0.3} style={{ cursor: "pointer" }}>
                    <line x1={cx} y1={cy - 7} x2={cx} y2={cy + 7} stroke="var(--ink-faint)" strokeWidth={2} />
                  </g>
                );
              }}
            />
          ) : null}
          {model.focus && model.focus.y !== null ? (
            <ReferenceDot yAxisId="y" x={model.focus.x} y={model.focus.y} r={11} fill="none" stroke="var(--ink)" strokeWidth={2} ifOverflow="hidden" />
          ) : null}
          {model.focus && model.focus.y === null ? (
            <ReferenceDot yAxisId="rug" x={model.focus.x} y={0.03} r={11} fill="none" stroke="var(--ink)" strokeWidth={2} ifOverflow="visible" />
          ) : null}
        </ComposedChart>
      </ChartContainer>
      {box ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute border border-accent bg-accent-soft/40"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      ) : null}
    </div>
    </div>
  );
}

function ZeroLabel(props: unknown) {
  const { x, y, width, payload } = props as { x?: number; y?: number; width?: number; payload?: Row };
  if (!payload || (props as { value?: unknown }).value == null || !isZeroY(String((props as { value?: unknown }).value)) || x == null || y == null || width == null) return null;
  return <text x={x + width / 2} y={y - 4} textAnchor="middle" fill="var(--ink-muted)" fontSize={11}>0</text>;
}

function originBar(seriesId: string, color: string, highlighted: Set<string>, uid: string) {
  return function OriginBar(props: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) {
    const { x = 0, y = 0, width = 0, height = 0, payload } = props;
    if (payload?.[seriesId] == null) return null;
    const pointId = pointIdFromRow(payload, seriesId) ?? "";
    const origin = payload[`${seriesId}__origin`];
    const selected = highlighted.size === 0 || highlighted.has(pointId);
    const id = cssId(seriesId);
    const fill = origin === "estimated" ? `url(#${uid}-est-${id})` : origin === "user_edit" ? `url(#${uid}-edit-${id})` : color;
    return (
      <g data-point-id={pointId} opacity={selected ? 1 : 0.3} style={{ cursor: "pointer" }}>
        <rect x={x} y={y} width={Math.max(width, 0)} height={Math.max(height, 0)} fill={fill} stroke={color} strokeWidth={1.2} />
      </g>
    );
  };
}

function originDot(seriesId: string, symbol: string, color: string, highlighted: Set<string>) {
  return function OriginDot(props: { cx?: number; cy?: number; payload?: Row }) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return null;
    const y = payload[seriesId] ?? payload.y;
    if (y == null) return null;
    const pointId = pointIdFromRow(payload, seriesId) ?? "";
    const origin = (payload.origin ?? payload[`${seriesId}__origin`]) as PointOrigin | undefined;
    const selected = highlighted.size === 0 || highlighted.has(pointId);
    return (
      <g data-point-id={pointId} opacity={selected ? 1 : 0.3} style={{ cursor: "pointer" }}>
        <MarkerSymbol cx={cx} cy={cy} symbol={symbol} color={color} origin={origin ?? "parsed"} />
      </g>
    );
  };
}
