import { cx } from "./cx";

/**
 * Real status only. Pass `measured` when progress is countable (e.g. pages done);
 * otherwise the bar is indeterminate. Never simulate percentages on a timer.
 */
export function ProgressStatus({
  label,
  detail,
  measured,
  className,
}: {
  label: string;
  detail?: string;
  measured?: { done: number; total: number; unit: string } | null;
  className?: string;
}) {
  const pct = measured && measured.total > 0 ? Math.min(100, Math.round((measured.done / measured.total) * 100)) : null;
  return (
    <div className={cx("w-full", className)} role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="font-medium text-ink">{label}</span>
        {measured && (
          <span className="tabular text-ink-muted">
            {measured.done} / {measured.total} {measured.unit}
          </span>
        )}
      </div>
      {detail && <p className="mt-0.5 text-[12px] text-ink-muted">{detail}</p>}
      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-label={label}
        {...(pct !== null ? { "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100 } : {})}
      >
        {pct !== null ? (
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        ) : (
          <div className="indeterminate-bar h-full w-2/5 rounded-full bg-accent/70" />
        )}
      </div>
    </div>
  );
}
