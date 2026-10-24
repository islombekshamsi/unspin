"use client";

import { useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
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
import { cx } from "@/components/ui";
import type { PointOrigin } from "../lib/presentation";
import { shortLabel } from "../lib/presentation";
import { isZeroY, strokeDasharray, type PlotModel, type PlotPoint } from "../lib/figure";

export interface RechartsChartProps {
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
export function RechartsChart({ model, label, className, onPointClick, onPointsSelected, onDeselect, onHover }: RechartsChartProps) {
  const uid = useId().replace(/:/g, "");
  const hostRef = useRef<HTMLDivElement>(null);
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

  const tickFormatter = (value: unknown) => {
    if (model.xKind === "category") return shortLabel(String(value));
    if (model.xKind === "date") {
      const n = typeof value === "number" ? value : Date.parse(String(value));
      if (Number.isFinite(n)) return new Date(n).toISOString().slice(0, 10);
    }
    return String(value);
  };

  return (
    <div
      ref={hostRef}
      className={cx("relative min-h-0 select-none", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => onHover?.(null)}
    >
      <p className="sr-only">{label}</p>
      <ChartContainer config={config} className="h-full min-h-[200px] w-full" style={{ aspectRatio: "auto" }}>
        <ComposedChart
          accessibilityLayer
          data={axisTicks}
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
            domain={numericX ? (model.xDomain ?? ["dataMin", "dataMax"]) : undefined}
            tickFormatter={tickFormatter}
            tickLine={false}
            axisLine={{ stroke: "var(--rule-strong)" }}
            interval="preserveStartEnd"
            label={{ value: model.xTitle, position: "insideBottom", offset: -18, fill: "var(--ink-muted)", fontSize: 12 }}
          />
          <YAxis
            yAxisId="y"
            type="number"
            scale={model.yScale === "log" ? "log" : "linear"}
            domain={model.yDomain ?? ["auto", "auto"]}
            allowDataOverflow={model.clipToBounds}
            width="auto"
            tickLine={false}
            axisLine={{ stroke: "var(--rule-strong)" }}
            label={{ value: model.yTitle, angle: -90, position: "insideLeft", fill: "var(--ink-muted)", fontSize: 12 }}
          />
          <YAxis yAxisId="rug" orientation="right" hide domain={[0, 1]} width={0} />
          {model.yScale === "linear" ? <ReferenceLine yAxisId="y" y={0} stroke="var(--ink-muted)" strokeWidth={1.5} ifOverflow="hidden" /> : null}
          <ChartTooltip content={<PlotTooltip />} />
          <ChartLegend content={<ChartLegendContent />} />
          {model.kind === "bar"
            ? model.series.map((s) => (
                <Bar
                  key={s.seriesId}
                  yAxisId="y"
                  name={s.label}
                  dataKey={s.seriesId}
                  fill={`var(--color-${s.seriesId})`}
                  isAnimationActive="auto"
                  maxBarSize={48}
                  shape={originBar(s.seriesId, s.color, model.highlighted, uid)}
                >
                  <LabelList
                    dataKey={s.seriesId}
                    content={(props) => {
                      const { x, y, width, payload } = props as { x?: number; y?: number; width?: number; payload?: Row };
                      if (!payload?.[`${s.seriesId}__zero`] || x == null || y == null || width == null) return null;
                      return (
                        <text x={x + width / 2} y={y - 4} textAnchor="middle" fill="var(--ink-muted)" fontSize={11}>
                          0
                        </text>
                      );
                    }}
                  />
                </Bar>
              ))
            : null}
          {model.kind === "line"
            ? model.series.map((s) => (
                <Line
                  key={s.seriesId}
                  yAxisId="y"
                  type="linear"
                  name={s.label}
                  dataKey={s.seriesId}
                  data={model.dataMode === "independent" ? independentRows(s.plotPoints, s.seriesId) : undefined}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={strokeDasharray(s.dash)}
                  connectNulls={false}
                  isAnimationActive="auto"
                  dot={originDot(s.seriesId, s.symbol, s.color, model.highlighted)}
                  activeDot={originDot(s.seriesId, s.symbol, s.color, model.highlighted)}
                />
              ))
            : null}
          {model.kind === "scatter"
            ? model.series.map((s) => (
                <Scatter
                  key={s.seriesId}
                  yAxisId="y"
                  name={s.label}
                  dataKey={s.seriesId}
                  data={
                    model.dataMode === "independent"
                      ? independentRows(
                          s.plotPoints.filter((p) => p.y !== null),
                          s.seriesId,
                        )
                      : undefined
                  }
                  fill={s.color}
                  isAnimationActive="auto"
                  shape={originDot(s.seriesId, s.symbol, s.color, model.highlighted)}
                />
              ))
            : null}
          {model.missing.length > 0 ? (
            <Scatter
              yAxisId="rug"
              name="Missing value (no y)"
              legendType="none"
              data={model.missing.map((p) => ({ ...p, rug: 0.03 }))}
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
            <ReferenceDot yAxisId="y" x={model.focus.x} y={model.focus.y} r={11} fill="none" stroke="var(--ink)" strokeWidth={2} ifOverflow="visible" />
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
  );
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
