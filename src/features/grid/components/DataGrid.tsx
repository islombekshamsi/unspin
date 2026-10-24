"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Column, Provenance, Row, SelectionEvent } from "@/contracts";
import { Badge, Button, ErrorState, Select, Spinner, TextInput, cx } from "@/components/ui";
import type { DataGridProps } from "@/features/workspace/seams";
import { TYPE_LABELS, columnUnitTag } from "../lib/format";
import { useRowWindow } from "../lib/rows";
import { CellInspector, type InspectorTarget } from "./CellInspector";
import { CellValue } from "./CellValue";

const ROW_H = 34;
const COL_W = 176;
const ROWHEADER_W = 64;

interface Active {
  rowId: string;
  columnId: string;
}

/**
 * Server-paginated, virtualized review grid. Row/column/cell ids are the only references;
 * array positions are used only for on-screen layout. Sorting and filtering are view
 * parameters sent to the server and never change the stored version.
 */
export function DataGrid({ detail, isCurrentVersion, linked, onLinkedSelect, onDetailChange, onViewChange }: DataGridProps) {
  const { dataset, version } = detail;
  const columns = version.columns;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  // --- View (sort/filter/columns) ------------------------------------------
  const [sort, setSort] = useState<{ columnId: string | null; direction: "asc" | "desc" }>({ columnId: null, direction: "asc" });
  const [filterColumnId, setFilterColumnId] = useState<string | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [filterText, setFilterText] = useState("");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setFilterText(filterInput.trim()), 250);
    return () => clearTimeout(t);
  }, [filterInput]);

  const knownIds = useMemo(() => new Set(columns.map((c) => c.id)), [columns]);
  const sortColumnId = sort.columnId && knownIds.has(sort.columnId) ? sort.columnId : null;
  const effectiveFilterColumn = filterColumnId && knownIds.has(filterColumnId) && filterText ? filterColumnId : null;
  const visibleColumns = useMemo(() => {
    const v = columns.filter((c) => !hidden.has(c.id));
    return v.length > 0 ? v : columns;
  }, [columns, hidden]);
  const visibleKey = visibleColumns.map((c) => c.id).join(",");

  useEffect(() => {
    onViewChange?.({
      sortColumnId,
      sortDirection: sort.direction,
      filterColumnId: effectiveFilterColumn,
      filterText: effectiveFilterColumn ? filterText : null,
      columnIds: visibleKey ? visibleKey.split(",") : [],
    });
  }, [onViewChange, sortColumnId, sort.direction, effectiveFilterColumn, filterText, visibleKey]);

  const win = useRowWindow({
    datasetId: dataset.id,
    versionId: version.id,
    sortColumnId,
    sortDirection: sort.direction,
    filterColumnId: effectiveFilterColumn,
    filterText: effectiveFilterColumn ? filterText : null,
  });
  const rows = win.rows;
  const rowIndexById = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const provenanceById = useMemo(() => new Map<string, Provenance>(detail.provenance.map((p) => [p.id, p])), [detail.provenance]);

  // --- Linked selection (single source of truth for highlighted rows/cells) -
  const linkedHere = linked && linked.datasetVersionId === version.id ? linked : null;
  const selectedRows = useMemo(() => new Set(linkedHere?.rowIds ?? []), [linkedHere]);
  const selectedCells = useMemo(() => new Set(linkedHere?.cellIds ?? []), [linkedHere]);

  // --- Active cell (local focus state) -------------------------------------
  const [active, setActive] = useState<Active | null>(null);
  const [anchorRowId, setAnchorRowId] = useState<string | null>(null);
  const [editRequest, setEditRequest] = useState(0);
  const [hiddenLinked, setHiddenLinked] = useState<{ eventKey: string; count: number } | null>(null);
  const [ownEvent, setOwnEvent] = useState<SelectionEvent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length + (win.nextCursor ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length ? items[items.length - 1].index : -1;

  const { nextCursor, loadingMore, loadMore } = win;
  useEffect(() => {
    if (nextCursor && !loadingMore && lastIndex >= rows.length - 20) void loadMore();
  }, [lastIndex, rows.length, nextCursor, loadingMore, loadMore]);

  const scrollToRow = useCallback(
    (rowId: string) => {
      const i = rowIndexById.get(rowId);
      if (i !== undefined) virtualizer.scrollToIndex(i, { align: "auto" });
    },
    [rowIndexById, virtualizer],
  );

  // Selection arriving from the chart or source: highlight, fetch the containing page, scroll. No echo.
  // Anything this grid did not emit itself (chart, source, review panel) is external.
  const linkedKey = linkedHere && linkedHere !== ownEvent ? JSON.stringify([linkedHere.origin, linkedHere.rowIds, linkedHere.cellIds]) : null;
  useEffect(() => {
    if (!linkedHere || !linkedKey || win.loading || linkedHere.rowIds.length === 0) return;
    let cancelled = false;
    const event = linkedHere;
    void win.ensureRows(event.rowIds).then((missing) => {
      if (cancelled) return;
      setHiddenLinked({ eventKey: linkedKey, count: missing.length });
      const target = event.rowIds.find((id) => !missing.includes(id));
      if (!target) return;
      const row = win.currentRows().find((r) => r.id === target);
      const columnId = row ? (Object.entries(row.cells).find(([, c]) => event.cellIds.includes(c.id))?.[0] ?? null) : null;
      setActive((a) => ({ rowId: target, columnId: columnId ?? a?.columnId ?? visibleColumns[0]?.id ?? "" }));
      requestAnimationFrame(() => {
        const i = win.currentRows().findIndex((r) => r.id === target);
        if (i >= 0) virtualizer.scrollToIndex(i, { align: "center" });
      });
    });
    return () => {
      cancelled = true;
    };
    // linkedKey captures the event content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedKey, win.loading, version.id]);

  const emit = useCallback(
    (rowIds: string[], cellIds: string[]) => {
      const prov = new Set<string>();
      const cellSet = new Set(cellIds);
      for (const id of rowIds) {
        const i = rowIndexById.get(id);
        if (i === undefined) continue;
        for (const c of Object.values(rows[i].cells)) if (cellSet.has(c.id)) c.provenanceIds.forEach((p) => prov.add(p));
      }
      const event: SelectionEvent = { origin: "grid", datasetVersionId: version.id, rowIds, cellIds, provenanceIds: [...prov] };
      setOwnEvent(event);
      onLinkedSelect(event);
    },
    [rowIndexById, rows, version.id, onLinkedSelect],
  );

  const select = useCallback(
    (row: Row, column: Column | null, mode: "single" | "toggle" | "range") => {
      const cellId = column ? row.cells[column.id]?.id : undefined;
      const own = linkedHere;
      if (mode === "single" || !own) {
        setAnchorRowId(row.id);
        emit([row.id], cellId ? [cellId] : []);
        return;
      }
      if (mode === "toggle") {
        setAnchorRowId(row.id);
        const has = own.rowIds.includes(row.id);
        const rowIds = has ? own.rowIds.filter((id) => id !== row.id) : [...own.rowIds, row.id];
        const rowCellIds = new Set(Object.values(row.cells).map((c) => c.id));
        const cellIds = has ? own.cellIds.filter((id) => !rowCellIds.has(id)) : cellId ? [...own.cellIds, cellId] : own.cellIds;
        emit(rowIds, cellIds);
        return;
      }
      const a = rowIndexById.get(anchorRowId ?? row.id) ?? rowIndexById.get(row.id)!;
      const b = rowIndexById.get(row.id)!;
      const range = rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id);
      emit(range, cellId ? [cellId] : []);
    },
    [linkedHere, emit, rowIndexById, anchorRowId, rows],
  );

  const activate = (row: Row, column: Column, e?: MouseEvent) => {
    setActive({ rowId: row.id, columnId: column.id });
    select(row, column, e && (e.metaKey || e.ctrlKey) ? "toggle" : e?.shiftKey ? "range" : "single");
    gridRef.current?.focus({ preventScroll: true });
  };

  // --- Keyboard ---------------------------------------------------------------
  const activeRowIndex = active ? rowIndexById.get(active.rowId) : undefined;
  const activeColIndex = active ? visibleColumns.findIndex((c) => c.id === active.columnId) : -1;

  const moveTo = (ri: number, ci: number) => {
    if (rows.length === 0 || visibleColumns.length === 0) return;
    if (ri >= rows.length && win.nextCursor) void win.loadMore();
    const r = Math.max(0, Math.min(rows.length - 1, ri));
    const c = Math.max(0, Math.min(visibleColumns.length - 1, ci));
    const row = rows[r];
    const column = visibleColumns[c];
    setActive({ rowId: row.id, columnId: column.id });
    select(row, column, "single");
    virtualizer.scrollToIndex(r, { align: "auto" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const ri = activeRowIndex ?? -1;
    const ci = Math.max(0, activeColIndex);
    const pageRows = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? ROW_H * 10) / ROW_H) - 2);
    const keys: Record<string, () => void> = {
      ArrowDown: () => moveTo(ri + 1, ci),
      ArrowUp: () => moveTo(Math.max(0, ri - 1), ci),
      ArrowRight: () => moveTo(Math.max(0, ri), ci + 1),
      ArrowLeft: () => moveTo(Math.max(0, ri), ci - 1),
      Home: () => (e.ctrlKey || e.metaKey ? moveTo(0, 0) : moveTo(Math.max(0, ri), 0)),
      End: () => (e.ctrlKey || e.metaKey ? moveTo(rows.length - 1, visibleColumns.length - 1) : moveTo(Math.max(0, ri), visibleColumns.length - 1)),
      PageDown: () => moveTo(ri + pageRows, ci),
      PageUp: () => moveTo(Math.max(0, ri - pageRows), ci),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
      return;
    }
    if ((e.key === "Enter" || e.key === "F2") && active && activeRowIndex !== undefined) {
      e.preventDefault();
      if (isCurrentVersion) setEditRequest((n) => n + 1);
      return;
    }
    if (e.key === " " && e.shiftKey && activeRowIndex !== undefined) {
      e.preventDefault();
      select(rows[activeRowIndex], visibleColumns[ci] ?? null, "toggle");
    }
  };

  const focusGrid = useCallback(() => {
    gridRef.current?.focus({ preventScroll: true });
    if (active) scrollToRow(active.rowId);
  }, [active, scrollToRow]);

  // --- Inspector target -------------------------------------------------------
  const target: InspectorTarget | null = useMemo(() => {
    if (!active || activeRowIndex === undefined) return null;
    const row = rows[activeRowIndex];
    const column = columns.find((c) => c.id === active.columnId);
    return row && column ? { row, column, cell: row.cells[column.id] } : null;
  }, [active, activeRowIndex, rows, columns]);

  const activeDomId = target?.cell ? `${uid}-c-${target.cell.id}` : target ? `${uid}-r-${target.row.id}-${target.column.id}` : undefined;
  const readOnlyReason = isCurrentVersion
    ? null
    : "You are viewing an older stored version. It is read-only; go back to the current version, or make this version current from History, to edit.";

  const totalWidth = ROWHEADER_W + visibleColumns.length * COL_W;
  const shownHidden = hiddenLinked && hiddenLinked.eventKey === linkedKey ? hiddenLinked.count : 0;
  const sortedLabel = sortColumnId ? columns.find((c) => c.id === sortColumnId)?.label : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2">
        <label className="sr-only" htmlFor={`${uid}-filter-col`}>
          Filter column
        </label>
        <div className="w-40">
          <Select
            id={`${uid}-filter-col`}
            className="h-8 text-[13px]"
            value={filterColumnId ?? ""}
            onChange={(e) => setFilterColumnId(e.target.value || null)}
          >
            <option value="">Filter: choose column</option>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <label className="sr-only" htmlFor={`${uid}-filter-text`}>
          Filter text
        </label>
        <div className="w-44">
          <TextInput
            id={`${uid}-filter-text`}
            className="h-8 text-[13px]"
            placeholder="Contains…"
            value={filterInput}
            maxLength={200}
            disabled={!filterColumnId}
            onChange={(e) => setFilterInput(e.target.value)}
          />
        </div>
        {(filterInput || sortColumnId) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFilterInput("");
              setFilterText("");
              setSort({ columnId: null, direction: "asc" });
            }}
          >
            Clear view
          </Button>
        )}
        <ColumnPicker columns={columns} hidden={hidden} onChange={setHidden} />
        <span className="ml-auto flex items-center gap-2 text-[12px] text-ink-muted" role="status" aria-live="polite">
          {(win.loading || win.loadingMore) && <Spinner />}
          <span className="tabular">
            {win.loading ? "Loading rows…" : `${rows.length.toLocaleString()} of ${win.total.toLocaleString()} rows loaded`}
            {effectiveFilterColumn ? " (filtered)" : ""}
            {sortedLabel ? ` · sorted by ${sortedLabel} ${sort.direction === "asc" ? "↑" : "↓"}` : ""}
          </span>
          {!isCurrentVersion && <Badge tone="estimate">Read-only</Badge>}
        </span>
      </div>
      {(sortColumnId || effectiveFilterColumn) && (
        <p className="border-b border-rule bg-sunken px-3 py-1 text-[12px] text-ink-muted">Sorting and filtering change only this view. The saved data and its source order are unchanged.</p>
      )}
      {shownHidden > 0 && (
        <p className="border-b border-rule bg-estimate-soft px-3 py-1 text-[12px] text-ink" role="status">
          {shownHidden} selected row{shownHidden === 1 ? " is" : "s are"} hidden by the current filter.
        </p>
      )}
      {win.error && (
        <ErrorState
          className="m-3"
          title="Could not load rows"
          message={win.error.message}
          code={win.error.code}
          requestId={win.error.requestId ?? undefined}
          action={<Button size="sm" onClick={win.reload}>Try again</Button>}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div ref={scrollRef} className="relative max-h-[70vh] min-h-[240px] min-w-0 flex-1 overflow-auto">
          <div
            ref={gridRef}
            role="grid"
            aria-label={`${dataset.title}: rows`}
            aria-rowcount={win.total + 1}
            aria-colcount={visibleColumns.length + 1}
            aria-busy={win.loading || undefined}
            aria-activedescendant={activeDomId}
            aria-readonly={!isCurrentVersion || undefined}
            aria-describedby={`${uid}-help`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onFocus={(e) => {
              if (e.target === e.currentTarget && !active && rows.length > 0 && visibleColumns.length > 0) setActive({ rowId: rows[0].id, columnId: visibleColumns[0].id });
            }}
            className={cx("text-[13px] outline-offset-[-2px]", win.loading && "opacity-60")}
            style={{ width: totalWidth, minWidth: "100%" }}
          >
            <div role="rowgroup" className="sticky top-0 z-10 bg-sunken">
              <div role="row" aria-rowindex={1} className="flex border-b border-rule-strong">
                <div role="columnheader" className="flex shrink-0 items-end px-2 py-1.5 text-[11px] text-ink-muted" style={{ width: ROWHEADER_W }}>
                  Source row
                </div>
                {visibleColumns.map((c, i) => (
                  <HeaderCell
                    key={c.id}
                    column={c}
                    colIndex={i + 2}
                    sort={sortColumnId === c.id ? sort.direction : null}
                    onSort={() =>
                      setSort((s) =>
                        s.columnId !== c.id ? { columnId: c.id, direction: "asc" } : s.direction === "asc" ? { columnId: c.id, direction: "desc" } : { columnId: null, direction: "asc" },
                      )
                    }
                  />
                ))}
              </div>
            </div>
            <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {items.map((vi) => {
                if (vi.index >= rows.length) {
                  return (
                    <div key="more" role="row" aria-rowindex={vi.index + 2} className="absolute left-0 flex items-center gap-2 px-3 text-[12px] text-ink-muted" style={{ top: 0, transform: `translateY(${vi.start}px)`, height: ROW_H }}>
                      <div role="gridcell">
                        <Spinner /> Loading more rows…
                      </div>
                    </div>
                  );
                }
                const row = rows[vi.index];
                const rowSelected = selectedRows.has(row.id);
                return (
                  <div
                    key={row.id}
                    role="row"
                    aria-rowindex={vi.index + 2}
                    aria-selected={rowSelected}
                    className={cx("absolute left-0 flex border-b border-rule", rowSelected ? "bg-accent-soft" : vi.index % 2 ? "bg-surface" : "bg-canvas/40")}
                    style={{ top: 0, transform: `translateY(${vi.start}px)`, height: ROW_H, width: totalWidth }}
                  >
                    <div
                      role="rowheader"
                      className="tabular flex shrink-0 cursor-pointer items-center justify-end gap-1 px-2 text-[12px] text-ink-muted select-none"
                      style={{ width: ROWHEADER_W }}
                      onClick={(e) => {
                        setActive((a) => ({ rowId: row.id, columnId: a?.columnId ?? visibleColumns[0]?.id ?? "" }));
                        select(row, null, e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : "single");
                        gridRef.current?.focus({ preventScroll: true });
                      }}
                    >
                      {rowSelected && <span aria-hidden="true">●</span>}
                      {row.sourceOrder + 1}
                    </div>
                    {visibleColumns.map((c, ci) => {
                      const cell = row.cells[c.id];
                      const isActive = active?.rowId === row.id && active.columnId === c.id;
                      const domId = cell ? `${uid}-c-${cell.id}` : `${uid}-r-${row.id}-${c.id}`;
                      return (
                        <div
                          key={c.id}
                          id={domId}
                          role="gridcell"
                          aria-colindex={ci + 2}
                          aria-selected={cell ? selectedCells.has(cell.id) : false}
                          title={cell?.currentValue != null ? String(cell.currentValue) : undefined}
                          onClick={(e) => activate(row, c, e)}
                          onDoubleClick={() => isCurrentVersion && setEditRequest((n) => n + 1)}
                          className={cx(
                            "flex shrink-0 cursor-default items-center overflow-hidden border-l border-rule px-2",
                            cell && selectedCells.has(cell.id) && "bg-accent-soft",
                            isActive && "outline-2 -outline-offset-2 outline-accent",
                          )}
                          style={{ width: COL_W }}
                        >
                          <CellValue cell={cell} />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            {!win.loading && !win.error && rows.length === 0 && (
              <p className="px-3 py-6 text-center text-ink-muted">{effectiveFilterColumn ? "No rows match this filter." : "This version has no rows."}</p>
            )}
          </div>
          <p id={`${uid}-help`} className="sr-only">
            Arrow keys move between cells. Home and End go to the first or last column; with Control, to the first or last loaded row. Enter or F2 edits the
            current cell. Shift+Space adds the row to the selection. Control-click or Command-click selects several rows.
          </p>
        </div>
        <aside aria-label="Cell details" className="max-h-[70vh] shrink-0 overflow-auto border-t border-rule lg:w-80 lg:border-t-0 lg:border-l">
          <CellInspector
            target={target}
            detail={detail}
            provenanceById={provenanceById}
            editable={isCurrentVersion && !win.loading}
            readOnlyReason={readOnlyReason}
            editRequest={editRequest}
            onDetailChange={onDetailChange}
            onEditorClosed={focusGrid}
          />
        </aside>
      </div>
    </div>
  );
}

function HeaderCell({ column, colIndex, sort, onSort }: { column: Column; colIndex: number; sort: "asc" | "desc" | null; onSort: () => void }) {
  const unit = columnUnitTag(column);
  return (
    <div
      role="columnheader"
      aria-colindex={colIndex}
      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : "none"}
      className="flex shrink-0 flex-col justify-end border-l border-rule px-2 py-1.5"
      style={{ width: COL_W }}
    >
      <button
        type="button"
        onClick={onSort}
        title={`Sort this view by ${column.label}`}
        className="flex min-w-0 items-center gap-1 rounded-sm text-left font-semibold text-ink"
      >
        <span className="truncate">{column.label || <em className="font-normal text-ink-faint">unnamed</em>}</span>
        <span aria-hidden="true" className="text-[11px] text-ink-muted">
          {sort === "asc" ? "↑" : sort === "desc" ? "↓" : ""}
        </span>
      </button>
      <span className="truncate text-[11px] text-ink-muted">
        {TYPE_LABELS[column.dataType]}
        {unit ? ` · ${unit}` : ""}
      </span>
    </div>
  );
}

function ColumnPicker({ columns, hidden, onChange }: { columns: Column[]; hidden: ReadonlySet<string>; onChange: (s: ReadonlySet<string>) => void }) {
  return (
    <details className="relative">
      <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border border-rule-strong px-2.5 text-[13px] font-medium select-none hover:bg-sunken">
        Columns{hidden.size ? ` (${columns.length - hidden.size}/${columns.length})` : ""}
      </summary>
      <div className="absolute z-20 mt-1 max-h-72 w-60 overflow-auto rounded-md border border-rule bg-surface p-2 shadow-overlay">
        <p className="mb-1 text-[11px] text-ink-muted">Hiding a column changes this view only.</p>
        {columns.map((c) => (
          <label key={c.id} className="flex items-center gap-2 py-0.5 text-[13px]">
            <input
              type="checkbox"
              checked={!hidden.has(c.id)}
              disabled={!hidden.has(c.id) && columns.length - hidden.size <= 1}
              onChange={(e) => {
                const next = new Set(hidden);
                if (e.target.checked) next.delete(c.id);
                else next.add(c.id);
                onChange(next);
              }}
            />
            <span className="truncate">{c.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
