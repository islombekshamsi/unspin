"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Column, Provenance, Row, SavedView, SelectionEvent } from "@/contracts";
import { Badge, Button, ErrorState, Select, Spinner, TextInput, cx } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { DataGridProps } from "@/features/workspace/seams";
import { TYPE_LABELS, columnUnitTag } from "../lib/format";
import { useRowWindow } from "../lib/rows";
import { InlineCellEditor } from "./InlineCellEditor";
import { CellValue } from "./CellValue";
import { RecordPanel } from "./RecordPanel";

const ROW_H = 34;
const COL_W = 176;
const ROWHEADER_W = 88;

interface Active {
  rowId: string;
  columnId: string;
}

/**
 * Server-paginated, virtualized review grid. Row/column/cell ids are the only references;
 * array positions are used only for on-screen layout. Sorting and filtering are view
 * parameters sent to the server and never change the stored version.
 */
export function DataGrid({ detail, isCurrentVersion, linked, onLinkedSelect, onDetailChange, onViewChange, onShowSource, onOpenCleaning, visible = true }: DataGridProps) {
  const { dataset, version } = detail;
  const columns = version.columns;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  // --- View (sort/filter/columns) ------------------------------------------
  const [sort, setSort] = useState<{ columnId: string | null; direction: "asc" | "desc" }>({ columnId: null, direction: "asc" });
  const [filterColumnId, setFilterColumnId] = useState<string | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [filterText, setFilterText] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const [preset, setPreset] = useState<"all" | "needs_review" | "estimated" | "edited">("all");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [presetCounts, setPresetCounts] = useState<{ preset: string; rowCount: number }[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savedViewId, setSavedViewId] = useState<string>("");
  const [saveName, setSaveName] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [recordRowId, setRecordRowId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ cellId: string; versionId: string } | null>(null);
  const lastTouch = useRef<{ cellId: string; time: number } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setFilterText(filterInput.trim()), 250);
    return () => clearTimeout(t);
  }, [filterInput]);
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim() || null), 250);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => {
    let cancelled = false;
    api.getOverview(dataset.id, version.id).then(
      (o) => {
        if (!cancelled) setPresetCounts(o.presetCounts);
      },
      () => undefined,
    );
    api.listViews(dataset.id).then(
      (views) => {
        if (!cancelled) setSavedViews(views);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [dataset.id, version.id]);

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
      search,
      preset,
      columnIds: visibleKey ? visibleKey.split(",") : [],
    });
  }, [onViewChange, sortColumnId, sort.direction, effectiveFilterColumn, filterText, visibleKey, search, preset]);

  const win = useRowWindow({
    datasetId: dataset.id,
    versionId: version.id,
    sortColumnId,
    sortDirection: sort.direction,
    filterColumnId: effectiveFilterColumn,
    filterText: effectiveFilterColumn ? filterText : null,
    search,
    preset,
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
  const [hiddenLinked, setHiddenLinked] = useState<{ eventKey: string; count: number } | null>(null);
  const [ownEvent, setOwnEvent] = useState<SelectionEvent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef({ top: 0, left: 0 });

  // A hidden tab loses its scroll offsets; put the table back where the user left it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!visible || !el) return;
    el.scrollTop = savedScroll.current.top;
    el.scrollLeft = savedScroll.current.left;
  }, [visible]);

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
      setRecordRowId(null);
      const cell = rows[activeRowIndex]?.cells[active.columnId];
      if (isCurrentVersion && cell) setEditing({ cellId: cell.id, versionId: version.id });
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
  const target: { row: Row; column: Column; cell: Row["cells"][string] | undefined } | null = useMemo(() => {
    if (!active || activeRowIndex === undefined) return null;
    const row = rows[activeRowIndex];
    const column = columns.find((c) => c.id === active.columnId);
    return row && column ? { row, column, cell: row.cells[column.id] } : null;
  }, [active, activeRowIndex, rows, columns]);

  const activeDomId = target?.cell ? `${uid}-c-${target.cell.id}` : target ? `${uid}-r-${target.row.id}-${target.column.id}` : undefined;
  const totalWidth = ROWHEADER_W + visibleColumns.length * COL_W;
  const shownHidden = hiddenLinked && hiddenLinked.eventKey === linkedKey ? hiddenLinked.count : 0;
  const sortedLabel = sortColumnId ? columns.find((c) => c.id === sortColumnId)?.label : null;
  const recordRow = recordRowId ? (rows.find((r) => r.id === recordRowId) ?? null) : null;

  const applySavedSpec = (v: SavedView) => {
    const spec = v.spec;
    setPreset(spec.preset);
    setSearch(spec.search);
    setSearchInput(spec.search ?? "");
    setFilterColumnId(spec.filterColumnId);
    setFilterInput(spec.filterText ?? "");
    setFilterText(spec.filterText ?? "");
    setSort(spec.sort);
    if (spec.columnIds && spec.columnIds.length > 0) {
      const vis = new Set(spec.columnIds);
      setHidden(new Set(columns.filter((c) => !vis.has(c.id)).map((c) => c.id)));
    } else {
      setHidden(new Set());
    }
  };

  const viewFiltered = Boolean(effectiveFilterColumn || search || preset !== "all");
  const resetView = () => {
    setFilterInput("");
    setFilterText("");
    setSearchInput("");
    setSearch(null);
    setPreset("all");
    setSort({ columnId: null, direction: "asc" });
    setSavedViewId("");
  };
  const sourceSelection = linkedHere && linkedHere.rowIds.length > 0 ? linkedHere : null;
  const inspectorShown = recordRowId !== null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b border-rule px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Data views">
            {(["all", "needs_review", "estimated", "edited"] as const).map((p) => {
              const count = presetCounts.find((c) => c.preset === p)?.rowCount ?? 0;
              if (p !== "all" && count === 0) return null;
              const labels = { all: "All data", needs_review: "Needs review", estimated: "Estimated", edited: "Edited" };
              return (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={preset === p}
                  onClick={() => setPreset(p)}
                  className={cx(
                    "rounded-full border px-3 py-1 text-[13px] font-medium transition-[background,border] motion-safe:duration-200",
                    preset === p ? "border-accent bg-accent text-accent-ink" : "border-rule bg-surface text-ink-muted hover:border-rule-strong",
                  )}
                >
                  {labels[p]}
                  <span className="tabular ml-1.5 opacity-80">{count.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
          <span className="ml-auto flex items-center gap-2 text-[13px] text-ink-muted" role="status" aria-live="polite">
            {(win.loading || win.loadingMore) && <Spinner />}
            <span className="tabular">
              {win.loading ? "Loading rows…" : `${win.total.toLocaleString()} of ${version.rowCount.toLocaleString()} rows`}
              {viewFiltered ? " in this view" : ""}
              {sortedLabel ? ` · sorted by ${sortedLabel} ${sort.direction === "asc" ? "↑" : "↓"}` : ""}
              {selectedRows.size > 0 ? ` · ${selectedRows.size.toLocaleString()} selected` : ""}
            </span>
            {!isCurrentVersion && <Badge tone="estimate">Read-only</Badge>}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {savedViews.length > 0 && (
            <>
              <label className="sr-only" htmlFor={`${uid}-saved-view`}>
                Saved view
              </label>
              <Select
                id={`${uid}-saved-view`}
                className="h-9 w-auto max-w-48"
                value={savedViewId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSavedViewId(id);
                  const v = savedViews.find((x) => x.id === id);
                  if (v) applySavedSpec(v);
                }}
              >
                <option value="">Saved views</option>
                {savedViews.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </>
          )}
          <label className="sr-only" htmlFor={`${uid}-search`}>
            Search all columns
          </label>
          <TextInput
            id={`${uid}-search`}
            className="w-full sm:w-52"
            type="search"
            placeholder="Search all columns"
            value={searchInput}
            maxLength={200}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <label className="sr-only" htmlFor={`${uid}-filter-col`}>
            Filter column
          </label>
          <Select id={`${uid}-filter-col`} className="w-auto max-w-48" value={filterColumnId ?? ""} onChange={(e) => setFilterColumnId(e.target.value || null)}>
            <option value="">Filter by column…</option>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          {filterColumnId && (
            <>
              <label className="sr-only" htmlFor={`${uid}-filter-text`}>
                Filter text
              </label>
              <TextInput
                id={`${uid}-filter-text`}
                className="w-40"
                placeholder="Contains…"
                value={filterInput}
                maxLength={200}
                onChange={(e) => setFilterInput(e.target.value)}
              />
            </>
          )}
          <ColumnPicker columns={columns} hidden={hidden} onChange={setHidden} />
          <details className="relative max-lg:open:basis-full" onToggle={(e) => (e.currentTarget.open ? requestAnimationFrame(() => document.getElementById(`${uid}-save-name`)?.focus()) : undefined)}>
            <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border border-rule-strong px-3 text-sm font-medium select-none hover:bg-sunken">Save view</summary>
            <div className="z-20 mt-1 flex flex-col gap-2 rounded-lg border border-rule bg-surface p-3 shadow-overlay max-lg:w-full max-lg:max-w-sm lg:absolute lg:w-72">
              <label htmlFor={`${uid}-save-name`} className="text-[12px] font-medium text-ink-muted">
                Name this view (filters, sort and columns)
              </label>
              <TextInput id={`${uid}-save-name`} value={saveName} maxLength={80} onChange={(e) => setSaveName(e.target.value)} />
              <Button
                size="sm"
                variant="primary"
                className="self-start"
                disabled={saveBusy || !saveName.trim()}
                onClick={() => {
                  void (async () => {
                    setSaveBusy(true);
                    try {
                      const created = await api.createView(dataset.id, {
                        name: saveName.trim(),
                        spec: {
                          preset,
                          search,
                          filterColumnId: effectiveFilterColumn,
                          filterText: effectiveFilterColumn ? filterText : null,
                          sort: { columnId: sortColumnId, direction: sort.direction },
                          columnIds: visibleColumns.map((c) => c.id),
                        },
                      });
                      setSavedViews((prev) => [...prev, created]);
                      setSavedViewId(created.id);
                      setSaveName("");
                    } finally {
                      setSaveBusy(false);
                    }
                  })();
                }}
              >
                Save view
              </Button>
            </div>
          </details>
          {(filterInput || sortColumnId || searchInput || preset !== "all") && (
            <Button size="sm" variant="ghost" className="h-9" onClick={resetView}>
              Reset view
            </Button>
          )}
          <span className="hidden flex-1 lg:block" />
          {sourceSelection && onShowSource && (
            <Button className="h-9" size="sm" onClick={() => onShowSource(sourceSelection)}>
              Show source
            </Button>
          )}
          {onOpenCleaning && (
            <Button className="h-9" size="sm" onClick={onOpenCleaning}>
              Clean data
            </Button>
          )}
        </div>
      </div>
      {(sortColumnId || effectiveFilterColumn) && (
        <p className="border-b border-rule bg-sunken px-4 py-1.5 text-[12px] text-ink-muted sm:px-5">Sorting and filtering change only this view. The saved data and its source order are unchanged.</p>
      )}
      {shownHidden > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-estimate-rule bg-estimate-soft px-4 py-2 text-[13px] text-ink sm:px-5" role="status">
          <span>
            {shownHidden} selected row{shownHidden === 1 ? " is" : "s are"} hidden by the current view.
          </span>
          <Button size="sm" onClick={resetView}>
            Show all data
          </Button>
        </div>
      )}
      {win.error && (
        <ErrorState
          className="m-4"
          title="Could not load rows"
          message={win.error.message}
          code={win.error.code}
          requestId={win.error.requestId ?? undefined}
          action={<Button size="sm" onClick={win.reload}>Try again</Button>}
        />
      )}

      <div className="flex flex-col lg:h-[clamp(24rem,calc(100dvh-13rem),62rem)] lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col max-lg:h-[68dvh] max-lg:min-h-[20rem] max-lg:flex-none">
          <div
            ref={scrollRef}
            className="relative min-h-0 flex-1 overflow-auto"
            onScroll={(e) => {
              if (visible) savedScroll.current = { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft };
            }}
          >
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
                  <div role="columnheader" className="flex shrink-0 items-end px-2 py-2 text-[12px] text-ink-muted" style={{ width: ROWHEADER_W }}>
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
                      style={{ top: 0, transform: `translateY(${vi.start}px)`, height: ROW_H, width: totalWidth, zIndex: editing?.versionId === version.id && Object.values(row.cells).some((cell) => cell.id === editing.cellId) ? 30 : undefined }}
                    >
                      <div
                        role="rowheader"
                        className="tabular flex shrink-0 cursor-pointer items-center justify-end gap-1 px-1 text-[12px] text-ink-muted select-none"
                        style={{ width: ROWHEADER_W }}
                        onClick={(e) => {
                          setActive((a) => ({ rowId: row.id, columnId: a?.columnId ?? visibleColumns[0]?.id ?? "" }));
                          select(row, null, e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : "single");
                          gridRef.current?.focus({ preventScroll: true });
                        }}
                      >
                        <button
                          type="button"
                          className="rounded-sm px-1 text-[12px] font-medium text-accent hover:underline"
                          aria-label={`Open record ${row.sourceOrder + 1}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRecordRowId(row.id);
                            setActive((a) => ({ rowId: row.id, columnId: a?.columnId ?? visibleColumns[0]?.id ?? "" }));
                            select(row, null, "single");
                          }}
                        >
                          Open
                        </button>
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
                            onPointerUp={(e) => {
                              if (e.pointerType !== "touch" || !cell || !isCurrentVersion) return;
                              const previous = lastTouch.current;
                              if (previous?.cellId === cell.id && Date.now() - previous.time < 400) {
                                setEditing({ cellId: cell.id, versionId: version.id }); lastTouch.current = null;
                              } else lastTouch.current = { cellId: cell.id, time: Date.now() };
                            }}
                            onDoubleClick={() => {
                              setRecordRowId(null);
                              if (isCurrentVersion && cell) setEditing({ cellId: cell.id, versionId: version.id });
                            }}
                            className={cx(
                              "relative flex shrink-0 cursor-default items-center border-l border-rule px-2.5",
                              editing?.cellId === cell?.id ? "z-20 overflow-visible" : "overflow-hidden",
                              cell && selectedCells.has(cell.id) && "bg-accent-soft",
                              isActive && "outline-2 -outline-offset-2 outline-accent",
                            )}
                            style={{ width: COL_W }}
                          >
                            {cell && editing?.cellId === cell.id && editing.versionId === version.id && isCurrentVersion ? (
                              <InlineCellEditor key={`${version.id}:${cell.id}`} cell={cell} column={c} row={row} detail={detail} onDetailChange={onDetailChange}
                                onClose={() => { setEditing(null); focusGrid(); }} />
                            ) : <CellValue cell={cell} column={c} />}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              {!win.loading && !win.error && rows.length === 0 && (
                <div className="px-3 py-10 text-center text-ink-muted">
                  <p>{viewFiltered ? "No rows match this view." : "This version has no rows."}</p>
                  {viewFiltered && (
                    <Button size="sm" className="mt-2" onClick={resetView}>
                      Show all data
                    </Button>
                  )}
                </div>
              )}
            </div>
            <p id={`${uid}-help`} className="sr-only">
              Arrow keys move between cells. Home and End go to the first or last column; with Control, to the first or last loaded row. Enter or F2 edits the current cell inline. Double-click or double-tap a cell to edit. Enter saves and Escape cancels. Shift+Space adds the row to the selection. Control-click or Command-click selects several rows. Enter on the
              source-row number opens the record.
            </p>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-rule bg-sunken px-4 py-2 text-[12px] text-ink-muted sm:px-5">
            <span className="tabular">
              {win.loading ? "…" : `${rows.length.toLocaleString()} of ${win.total.toLocaleString()} loaded`}
              {win.nextCursor ? " · scroll for more" : ""}
            </span>
            <span>Count only. Sums are omitted unless a compatible quantity is confirmed.</span>
          </footer>
        </div>
        <aside
          aria-label="Record details"
          className={cx(
            inspectorShown ? "flex" : "hidden",
            "shrink-0 flex-col border-rule max-lg:max-h-[70dvh] max-lg:border-t lg:w-[22rem] lg:border-l",
          )}
        >
          <div className="min-h-0 flex-1 overflow-auto">
            {recordRowId && !recordRow ? (
              <div className="p-4 text-[13px] text-ink-muted">
                <p className="font-medium text-ink">This record is hidden by the current view.</p>
                <p className="mt-1">The view was not changed.</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={resetView}>
                    Show all data
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRecordRowId(null)}>
                    Close
                  </Button>
                </div>
              </div>
            ) : recordRow ? (
              <RecordPanel row={recordRow} detail={detail} provenanceById={provenanceById} onClose={() => setRecordRowId(null)} onShowSource={onShowSource ?? onLinkedSelect} />
            ) : null}
          </div>
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
    <details className="relative max-lg:open:basis-full">
      <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border border-rule-strong px-3 text-sm font-medium select-none hover:bg-sunken">
        Columns{hidden.size ? ` (${columns.length - hidden.size}/${columns.length})` : ""}
      </summary>
      <div className="z-20 mt-1 max-h-72 overflow-auto rounded-md border border-rule bg-surface p-2 shadow-overlay max-lg:w-full max-lg:max-w-sm lg:absolute lg:w-60">
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
