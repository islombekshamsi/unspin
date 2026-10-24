"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type * as PlotlyTypes from "plotly.js";
import { Button, ErrorState, cx } from "@/components/ui";

type PlotlyModule = typeof PlotlyTypes;

let plotlyPromise: Promise<PlotlyModule> | null = null;

/** Loads the basic Plotly bundle once, in the browser only. */
function loadPlotly(): Promise<PlotlyModule> {
  plotlyPromise ??= import("plotly.js-basic-dist-min")
    .then((m) => (m as { default?: PlotlyModule }).default ?? (m as unknown as PlotlyModule))
    .catch((e: unknown) => {
      plotlyPromise = null;
      throw e;
    });
  return plotlyPromise;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface PlotlyChartProps {
  data: PlotlyTypes.Data[];
  layout: Partial<PlotlyTypes.Layout>;
  config: Partial<PlotlyTypes.Config>;
  /** Screen-reader summary of the drawing; the navigator and data table are the accessible alternative. */
  label: string;
  className?: string;
  onPointClick?: (customdata: string) => void;
  onPointsSelected?: (customdata: string[]) => void;
  onDeselect?: () => void;
  onHover?: (customdata: string | null) => void;
}

type HostElement = HTMLDivElement & PlotlyTypes.PlotlyHTMLElement;

function ids(points: PlotlyTypes.PlotDatum[] | undefined): string[] {
  return (points ?? []).map((p) => p.customdata).filter((c): c is string => typeof c === "string");
}

/**
 * Adapter around Plotly: owns lazy loading, responsive sizing, and event wiring.
 * When only the y-axis range changes while the data array is the same object, the
 * axis is animated (values untouched); otherwise the figure is re-rendered at once.
 */
export function PlotlyChart({ data, layout, config, label, className, onPointClick, onPointsSelected, onDeselect, onHover }: PlotlyChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [plotly, setPlotly] = useState<PlotlyModule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const prev = useRef<{ data: PlotlyTypes.Data[]; layout: Partial<PlotlyTypes.Layout> } | null>(null);
  const wired = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadPlotly().then(
      (mod) => {
        if (!cancelled) setPlotly(() => mod);
      },
      () => {
        if (!cancelled) setLoadError("The chart library could not be loaded. Check your connection and retry.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const emitClick = useEffectEvent((e: PlotlyTypes.PlotMouseEvent) => {
    const id = ids(e.points)[0];
    if (id) onPointClick?.(id);
  });
  const emitSelected = useEffectEvent((e: PlotlyTypes.PlotSelectionEvent | undefined) => {
    if (!e) onDeselect?.();
    else onPointsSelected?.(ids(e.points));
  });
  const emitDeselect = useEffectEvent(() => onDeselect?.());
  const emitHover = useEffectEvent((id: string | null) => onHover?.(id));

  // Sizing and teardown for the lifetime of the loaded library.
  useEffect(() => {
    const host = hostRef.current;
    if (!plotly || !host) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (host.isConnected && wired.current) plotly.Plots.resize(host);
      });
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      prev.current = null;
      wired.current = false;
      plotly.purge(host);
    };
  }, [plotly]);

  useEffect(() => {
    const host = hostRef.current as HostElement | null;
    if (!plotly || !host) return;
    const before = prev.current;
    prev.current = { data, layout };
    const oldY = before?.layout.yaxis;
    const newY = layout.yaxis;
    const axisOnly =
      before !== null &&
      before.data === data &&
      oldY?.type === newY?.type &&
      Array.isArray(newY?.range) &&
      JSON.stringify(oldY?.range) !== JSON.stringify(newY?.range);

    const render = () =>
      plotly.react(host, data, layout, config).then(() => {
        // The drawing is aria-hidden; its toolbar must not take keyboard focus either.
        host.querySelectorAll(".modebar-btn").forEach((b) => b.setAttribute("tabindex", "-1"));
        if (wired.current) return;
        wired.current = true;
        host.on("plotly_click", (e) => emitClick(e));
        host.on("plotly_selected", (e) => emitSelected(e));
        host.on("plotly_deselect", () => emitDeselect());
        host.on("plotly_hover", (e) => emitHover(ids(e.points)[0] ?? null));
        host.on("plotly_unhover", () => emitHover(null));
      });

    if (axisOnly && !prefersReducedMotion()) {
      plotly
        .animate(
          host,
          { layout: { yaxis: { range: newY!.range } } },
          { transition: { duration: 400, easing: "cubic-in-out" }, frame: { duration: 400, redraw: false }, mode: "immediate" },
        )
        .then(render, render);
    } else {
      void render();
    }
  }, [plotly, data, layout, config]);

  if (loadError) {
    return (
      <ErrorState
        className="m-3"
        title="Chart unavailable"
        message={loadError}
        action={
          <Button
            size="sm"
            onClick={() => {
              setLoadError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className={cx("relative min-h-0", className)}>
      <p className="sr-only">{label}</p>
      <div ref={hostRef} aria-hidden="true" className="absolute inset-0" />
      {!plotly && (
        <p role="status" className="absolute inset-0 flex items-center justify-center text-[13px] text-ink-muted">
          Loading chart…
        </p>
      )}
    </div>
  );
}
