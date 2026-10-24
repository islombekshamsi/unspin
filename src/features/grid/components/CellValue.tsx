import type { Cell } from "@/contracts";
import { cx } from "@/components/ui";
import { MISSING_LABELS, valueText } from "../lib/format";

/**
 * One cell's current value with non-color markers:
 * missing -> "— reason" token; estimate -> dashed underline + "≈"; edited -> "✎"; reviewed -> "✓".
 */
export function CellValue({ cell }: { cell: Cell | undefined }) {
  if (!cell) return <span className="text-ink-faint italic">no cell</span>;
  const missing = cell.currentValue === null;
  const estimated = cell.origin === "estimated";
  const edited = cell.origin === "user_edit";
  const text = valueText(cell.currentValue);
  return (
    <span className="flex min-w-0 items-center gap-1">
      {missing ? (
        <span className="truncate rounded-sm border border-dashed border-rule-strong px-1 text-[12px] text-ink-muted italic">
          — {cell.missingReason ? MISSING_LABELS[cell.missingReason] : "missing"}
        </span>
      ) : (
        <span className={cx("truncate", estimated && "estimate-mark", cell.valueType === "decimal" && "tabular ml-auto", text === "" && "text-ink-faint")}>
          {estimated && <span aria-hidden="true">≈</span>}
          {text === "" ? "(empty text)" : text}
        </span>
      )}
      <span className="sr-only">
        {missing ? ", missing" : ""}
        {estimated ? ", estimate" : ""}
        {edited ? ", edited" : ""}
        {cell.reviewStatus === "accepted" ? ", reviewed" : cell.reviewStatus === "unavailable" ? ", review unavailable" : ""}
        {cell.notes.length ? `, ${cell.notes.length} note${cell.notes.length === 1 ? "" : "s"}` : ""}
      </span>
      <span aria-hidden="true" className="flex shrink-0 items-center gap-0.5 text-[11px] leading-none">
        {edited && (
          <span className="text-accent" title="Edited">
            ✎
          </span>
        )}
        {cell.reviewStatus === "accepted" && (
          <span className="text-success" title="Reviewed">
            ✓
          </span>
        )}
        {cell.reviewStatus === "unavailable" && (
          <span className="text-ink-faint" title="Review unavailable">
            ⊘
          </span>
        )}
        {cell.notes.length > 0 && (
          <span className="text-estimate" title={`${cell.notes.length} note${cell.notes.length === 1 ? "" : "s"}`}>
            ●
          </span>
        )}
      </span>
    </span>
  );
}
