"use client";

import { useEffect, useRef, useState } from "react";
import type { Cell, Column, DatasetDetail, Row, TransformOperation } from "@/contracts";
import { api } from "@/lib/api/client";

/** Uses the same preview/hash/version transaction as cleaning; column type is fixed. */
export function InlineCellEditor({ cell, column, row, detail, onDetailChange, onClose }: {
  cell: Cell; column: Column; row: Row; detail: DatasetDetail;
  onDetailChange: (detail: DatasetDetail) => void; onClose: () => void;
}) {
  const type = column.dataType === "unknown" ? "text" : column.dataType;
  const [value, setValue] = useState(cell.currentValue === null ? "" : String(cell.currentValue));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const saving = useRef(false);
  useEffect(() => { input.current?.focus(); if (input.current instanceof HTMLInputElement) input.current.select(); }, []);
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true); setError(null);
    const missing = type !== "text" && value.trim() === "";
    const operation: TransformOperation = {
      type: "edit_cell", rowId: row.id, columnId: column.id, cellId: cell.id,
      newValue: missing ? null : type === "boolean" ? value === "true" : type === "decimal" ? value.trim() : value,
      explicitType: type, missingReason: missing ? "not_reported" : null, note: null,
    };
    try {
      const preview = await api.previewTransform(detail.dataset.id, { expectedVersionId: detail.version.id, operation, cursor: null, limit: 1 });
      if (preview.affectedCount === 0) { onClose(); return; }
      const next = await api.applyTransform(detail.dataset.id, { expectedVersionId: preview.baseVersionId, operation: preview.operation, operationHash: preview.operationHash });
      onDetailChange(next); onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The value could not be saved.");
    } finally { saving.current = false; setBusy(false); }
  };
  const label = `Edit ${column.label}, source row ${row.sourceOrder + 1} (${type})`;
  const style = "h-7 min-w-0 flex-1 rounded border border-accent bg-surface px-1 text-[13px] text-ink outline-none";
  return <form className="relative flex w-full items-center gap-1" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
    onSubmit={(e) => { e.preventDefault(); void save(); }}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); } }}>
    {type === "boolean" ? <select ref={(el) => { input.current = el; }} className={style} aria-label={label} value={value} disabled={busy} onChange={(e) => setValue(e.target.value)}>
      <option value="">Missing</option><option value="true">true</option><option value="false">false</option>
    </select> : <input ref={(el) => { input.current = el; }} className={style} aria-label={label} aria-invalid={!!error}
      type={type === "date" ? "date" : "text"} inputMode={type === "decimal" ? "decimal" : undefined}
      title={error ?? (type === "datetime" ? "ISO UTC timestamp, e.g. 2026-01-31T12:00:00.000Z" : "Enter saves. Escape cancels. Clearing a non-text value marks it missing.")}
      value={value} disabled={busy} onChange={(e) => { setValue(e.target.value); setError(null); }} />}
    <button type="submit" disabled={busy} aria-label="Save cell" className="shrink-0 text-accent">{busy ? "…" : "✓"}</button>
    {error && <span role="alert" className="absolute top-full left-0 z-50 w-64 rounded border border-rule bg-surface p-2 text-xs text-ink shadow-lg">{error}</span>}
  </form>;
}
