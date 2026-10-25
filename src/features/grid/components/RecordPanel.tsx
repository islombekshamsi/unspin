"use client";

import { useEffect, useState } from "react";
import type { Cell, Column, DatasetDetail, Locator, Provenance, QualityFinding, Row, SelectionEvent } from "@/contracts";
import { Badge, Button } from "@/components/ui";
import { api } from "@/lib/api/client";
import { MISSING_LABELS, ORIGIN_LABELS, REVIEW_LABELS, TYPE_LABELS, columnUnitTag, valueText } from "../lib/format";
import { CellValue } from "./CellValue";

const AVAILABILITY_LABELS: Record<Provenance["locatorAvailability"], string> = {
  precise: "Precise location",
  region_only: "Region only",
  page_only: "Page only",
  unavailable: "No source location",
};

function describeLocator(l: Locator): string {
  switch (l.type) {
    case "csv_record":
      return `CSV record ${l.recordIndex + 1}, line${l.lineStart === l.lineEnd ? ` ${l.lineStart}` : `s ${l.lineStart}–${l.lineEnd}`}${l.fieldIndex !== null ? `, field ${l.fieldIndex + 1}` : ""}`;
    case "xlsx_cell":
      return `Sheet “${l.sheetName}”, cell ${l.address}`;
    case "pdf_page":
      return `PDF page ${l.pageNumber}`;
    case "pdf_box":
      return `PDF page ${l.pageNumber}, box in page points`;
    case "image_box":
      return `Image box at ${l.box.left},${l.box.top} (${l.box.width}×${l.box.height} px)`;
    case "figure_label":
      return `Figure “${l.label}”${l.pageNumber ? ` on page ${l.pageNumber}` : ""}`;
    case "user_edit":
      return "Your edit";
    case "derived_operation":
      return "Result of a cleaning operation";
  }
}

export function RecordPanel({
  row,
  detail,
  provenanceById,
  onClose,
  onShowSource,
}: {
  row: Row;
  detail: DatasetDetail;
  provenanceById: Map<string, Provenance>;
  onClose: () => void;
  onShowSource: (event: SelectionEvent) => void;
}) {
  const columns = detail.version.columns;
  const [findings, setFindings] = useState<QualityFinding[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getFindings(detail.dataset.id, detail.version.id).then(
      (all) => {
        if (!cancelled) setFindings(all.filter((f) => f.affectedRowIds.includes(row.id)));
      },
      () => {
        if (!cancelled) setFindings([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [detail.dataset.id, detail.version.id, row.id]);

  const provenanceIds = [...new Set(Object.values(row.cells).flatMap((c) => c.provenanceIds))];
  const cellIds = Object.values(row.cells).map((c) => c.id);
  const hasSource = provenanceIds.some((id) => {
    const p = provenanceById.get(id);
    return p && p.locatorAvailability !== "unavailable";
  });

  return (
    <div className="flex flex-col gap-4 p-4 text-[13px]">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] tracking-wide text-ink-muted uppercase">Record</p>
          <h3 className="text-base font-semibold text-ink">Source row {row.sourceOrder + 1}</h3>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            onShowSource({
              origin: "grid",
              datasetVersionId: detail.version.id,
              rowIds: [row.id],
              cellIds,
              provenanceIds,
            })
          }
        >
          Show source
        </Button>
        {!hasSource && <p className="self-center text-[12px] text-ink-muted">No precise source location is recorded for this row.</p>}
      </div>

      <ul className="flex flex-col gap-2">
        {columns.map((column) => (
          <PropertyRow key={column.id} column={column} cell={row.cells[column.id]} provenanceById={provenanceById} />
        ))}
      </ul>

      {findings && findings.length > 0 && (
        <section>
          <h4 className="text-[12px] font-semibold tracking-wide text-ink-muted uppercase">Review findings</h4>
          <ul className="mt-1 space-y-1">
            {findings.map((f) => (
              <li key={f.id} className="rounded-md border border-rule px-2 py-1.5 text-[12px] text-ink-muted">
                {f.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PropertyRow({
  column,
  cell,
  provenanceById,
}: {
  column: Column;
  cell: Cell | undefined;
  provenanceById: Map<string, Provenance>;
}) {
  const unit = columnUnitTag(column);
  const changed = cell && cell.rawText !== null && cell.currentValue !== null && String(cell.currentValue) !== cell.rawText;
  return (
    <li className="rounded-md border border-rule px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium text-ink">{column.label || <em className="font-normal text-ink-faint">unnamed</em>}</p>
        <p className="text-[11px] text-ink-muted">
          {TYPE_LABELS[column.dataType]}
          {unit ? ` · ${unit}` : ""}
        </p>
      </div>
      <div className="mt-1">
        <CellValue cell={cell} column={column} />
      </div>
      {cell && (
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px] text-ink-muted">
          <dt>Original</dt>
          <dd className="font-mono break-words">{cell.rawText === null ? "none in source" : cell.rawText}</dd>
          {changed && (
            <>
              <dt>Current</dt>
              <dd className="font-mono break-words">{cell.currentValue === null ? `missing — ${MISSING_LABELS[cell.missingReason!]}` : valueText(cell.currentValue)}</dd>
            </>
          )}
          <dt>Origin</dt>
          <dd>
            {ORIGIN_LABELS[cell.origin]}
            {cell.origin === "estimated" && (
              <Badge className="ml-1" tone="estimate">
                Estimate
              </Badge>
            )}
          </dd>
          <dt>Review</dt>
          <dd>{REVIEW_LABELS[cell.reviewStatus]}</dd>
        </dl>
      )}
      {cell?.provenanceIds.map((id) => {
        const p = provenanceById.get(id);
        if (!p) return null;
        return (
          <p key={id} className="mt-1 text-[12px] text-ink-muted">
            {describeLocator(p.locator)} · {AVAILABILITY_LABELS[p.locatorAvailability]}
            {p.locatorOrigin === "model_hint" ? " · unverified hint" : ""}
          </p>
        );
      })}
    </li>
  );
}
