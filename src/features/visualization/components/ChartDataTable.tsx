"use client";

import { useState } from "react";
import type { ChartPoint, Column } from "@/contracts";
import { Badge, Button, cx } from "@/components/ui";
import { ORIGIN_LABEL, formatValue } from "../lib/presentation";

export interface TableSeries {
  seriesId: string;
  label: string;
  yColumn: Column | undefined;
  points: ChartPoint[];
}

const PAGE = 100;

/** Accessible alternative: exactly the plotted points, including gaps, in series then x order. */
export function ChartDataTable({
  series,
  xColumn,
  highlighted,
  onSelect,
}: {
  series: TableSeries[];
  xColumn: Column | undefined;
  highlighted: Set<string>;
  onSelect: (point: ChartPoint) => void;
}) {
  const rows = series.flatMap((s) => s.points.map((p) => ({ s, p })));
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * PAGE, (current + 1) * PAGE);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-rule">
        <table className="w-full border-collapse text-left text-[13px]">
          <caption className="sr-only">Plotted points, one row per point. Missing values are listed as gaps.</caption>
          <thead className="bg-sunken text-[12px] text-ink-muted">
            <tr>
              <th scope="col" className="px-2 py-1.5 font-medium">Series</th>
              <th scope="col" className="px-2 py-1.5 font-medium">{xColumn?.label ?? "x"}</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Value</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Origin</th>
              <th scope="col" className="px-2 py-1.5 font-medium"><span className="sr-only">Select</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ s, p }) => {
              const on = highlighted.has(p.pointId);
              return (
                <tr key={p.pointId} aria-selected={on} className={cx("border-t border-rule", on && "bg-accent-soft")}>
                  <td className="px-2 py-1">{s.label}</td>
                  <td className="tabular px-2 py-1">{formatValue(p.x, xColumn)}</td>
                  <td className={cx("tabular px-2 py-1", p.yOrigin === "estimated" && "estimate-mark")}>
                    {p.y === null ? <span className="text-ink-muted italic">missing (gap)</span> : formatValue(p.y, s.yColumn)}
                  </td>
                  <td className="px-2 py-1">
                    {p.yOrigin === "estimated" ? <Badge tone="estimate">{ORIGIN_LABEL[p.yOrigin]}</Badge> : <span className="text-ink-muted">{ORIGIN_LABEL[p.yOrigin]}</span>}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <Button size="sm" variant="ghost" onClick={() => onSelect(p)} aria-pressed={on}>
                      {on ? "Selected" : "Select"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav aria-label="Table pages" className="flex items-center gap-2 text-[12px] text-ink-muted">
          <Button size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </Button>
          <span className="tabular">
            Rows {current * PAGE + 1}–{Math.min(rows.length, (current + 1) * PAGE)} of {rows.length}
          </span>
          <Button size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}
