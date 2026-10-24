"use client";

import { useState, type KeyboardEvent } from "react";
import type { ChartPoint } from "@/contracts";

export interface NavigatorSeries {
  seriesId: string;
  label: string;
  /** Points in x order. */
  points: ChartPoint[];
}

/**
 * Keyboard access to chart points: Left/Right (Home/End) move along the active series in
 * x order, Up/Down switch series, Enter or Space selects (same event as a click).
 */
export function PointNavigator({
  series,
  describe,
  onFocusPoint,
  onSelect,
}: {
  series: NavigatorSeries[];
  describe: (p: ChartPoint) => string;
  onFocusPoint: (pointId: string | null) => void;
  onSelect: (p: ChartPoint) => void;
}) {
  const [pos, setPos] = useState<{ seriesId: string | null; pointId: string | null }>({ seriesId: null, pointId: null });

  const sIndex = Math.max(0, series.findIndex((s) => s.seriesId === pos.seriesId));
  const active = series[sIndex];
  const pIndex = active ? Math.max(0, active.points.findIndex((p) => p.pointId === pos.pointId)) : 0;
  const point = active?.points[pIndex] ?? null;

  const go = (si: number, pi: number) => {
    const s = series[(si + series.length) % series.length];
    if (!s || s.points.length === 0) return;
    const p = s.points[Math.min(Math.max(pi, 0), s.points.length - 1)];
    setPos({ seriesId: s.seriesId, pointId: p.pointId });
    onFocusPoint(p.pointId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!active) return;
    const handled = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter", " "];
    if (!handled.includes(e.key)) return;
    e.preventDefault();
    if (e.key === "ArrowRight") go(sIndex, pIndex + 1);
    else if (e.key === "ArrowLeft") go(sIndex, pIndex - 1);
    else if (e.key === "Home") go(sIndex, 0);
    else if (e.key === "End") go(sIndex, active.points.length - 1);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next = series[(sIndex + (e.key === "ArrowDown" ? 1 : -1) + series.length) % series.length];
      const target = point ? next.points.findIndex((p) => p.x === point.x) : 0;
      go(series.indexOf(next), target >= 0 ? target : 0);
    } else if (point) onSelect(point);
  };

  if (series.every((s) => s.points.length === 0)) return null;

  return (
    <div
      tabIndex={0}
      role="group"
      aria-roledescription="point navigator"
      aria-label="Chart points. Use Left and Right to move, Up and Down to change series, Enter to select."
      onKeyDown={onKeyDown}
      onFocus={() => point && onFocusPoint(point.pointId)}
      onBlur={() => onFocusPoint(null)}
      className="rounded-md border border-rule bg-sunken px-3 py-2 text-[13px]"
    >
      <p className="text-[12px] text-ink-muted">
        Keyboard: focus here, then ←/→ move, ↑/↓ change series, Enter selects.
      </p>
      <p aria-live="polite" className="mt-1 text-ink">
        {point ? `${describe(point)} (${pIndex + 1} of ${active.points.length})` : "No point focused."}
      </p>
    </div>
  );
}
