"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ROW_IDS_PER_QUERY, type Row } from "@/contracts";
import { ApiClientError, api } from "@/lib/api/client";

export const PAGE_SIZE = 200;
const SCAN_PAGE_SIZE = 1000;

export interface RowQuery {
  datasetId: string;
  versionId: string;
  sortColumnId: string | null;
  sortDirection: "asc" | "desc";
  filterColumnId: string | null;
  filterText: string | null;
  search: string | null;
  preset: "all" | "needs_review" | "estimated" | "edited";
}

interface WindowState {
  key: string;
  rows: Row[];
  total: number;
  nextCursor: string | null;
  error: ApiClientError | null;
  loadingMore: boolean;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const queryKey = (q: RowQuery) =>
  JSON.stringify([q.datasetId, q.versionId, q.sortColumnId, q.sortDirection, q.filterColumnId, q.filterText, q.search, q.preset]);
const viewKey = (q: RowQuery) =>
  JSON.stringify([q.datasetId, q.sortColumnId, q.sortDirection, q.filterColumnId, q.filterText, q.search, q.preset]);

/**
 * Server-paginated rows in the current view order (sort/filter are view parameters only).
 * Rows load page by page as the user scrolls; nothing loads the whole dataset at once.
 * When only the version changes (after an edit), the same number of rows is reloaded so the
 * scroll position and active cell survive.
 */
export function useRowWindow(q: RowQuery) {
  const key = queryKey(q);
  const [state, setState] = useState<WindowState>({ key: "", rows: [], total: 0, nextCursor: null, error: null, loadingMore: false });
  const [reloadToken, setReloadToken] = useState(0);
  const stateRef = useRef(state);
  const lastView = useRef<{ view: string; count: number } | null>(null);

  useEffect(() => {
    stateRef.current = state;
    if (state.key === key) lastView.current = { view: viewKey(q), count: state.rows.length };
  });

  useEffect(() => {
    const ac = new AbortController();
    const prev = lastView.current;
    const keep = prev && prev.view === viewKey(q) ? prev.count : 0;
    const limit = Math.min(SCAN_PAGE_SIZE, Math.max(PAGE_SIZE, keep));
    api
      .getRows(q.datasetId, { versionId: q.versionId, limit, cursor: null, sortColumnId: q.sortColumnId, sortDirection: q.sortDirection, filterColumnId: q.filterColumnId, filterText: q.filterText, search: q.search, preset: q.preset }, ac.signal)
      .then(
        (page) => setState({ key, rows: page.rows, total: page.totalRows, nextCursor: page.nextCursor, error: null, loadingMore: false }),
        (e) => {
          if (isAbort(e)) return;
          if (!(e instanceof ApiClientError)) throw e;
          setState({ key, rows: [], total: 0, nextCursor: null, error: e, loadingMore: false });
        },
      );
    return () => ac.abort();
    // q's fields are all captured by key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadToken]);

  const fetchNext = useCallback(
    async (limit: number): Promise<boolean> => {
      const s = stateRef.current;
      if (s.key !== key || !s.nextCursor || s.loadingMore) return false;
      const cursor = s.nextCursor;
      setState((p) => (p.key === key ? { ...p, loadingMore: true } : p));
      stateRef.current = { ...s, loadingMore: true };
      try {
        const page = await api.getRows(q.datasetId, {
          versionId: q.versionId,
          limit,
          cursor,
          sortColumnId: q.sortColumnId,
          sortDirection: q.sortDirection,
          filterColumnId: q.filterColumnId,
          filterText: q.filterText,
          search: q.search,
          preset: q.preset,
        });
        const p = stateRef.current;
        if (p.key !== key || p.nextCursor !== cursor) return false;
        const next = { ...p, rows: [...p.rows, ...page.rows], total: page.totalRows, nextCursor: page.nextCursor, loadingMore: false };
        stateRef.current = next;
        setState(next);
        return true;
      } catch (e) {
        if (!(e instanceof ApiClientError)) throw e;
        setState((p) => (p.key === key ? { ...p, loadingMore: false, error: e } : p));
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  const loadMore = useCallback(() => fetchNext(PAGE_SIZE), [fetchNext]);

  /** Loads further pages until every id is present (or the view ends). Returns ids not in this view. */
  const ensureRows = useCallback(
    async (rowIds: string[]): Promise<string[]> => {
      for (let guard = 0; guard < 100; guard++) {
        const s = stateRef.current;
        if (s.key !== key) return rowIds;
        const have = new Set(s.rows.map((r) => r.id));
        const missing = rowIds.filter((id) => !have.has(id));
        if (missing.length === 0 || !s.nextCursor) return missing;
        if (s.loadingMore) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        if (!(await fetchNext(SCAN_PAGE_SIZE))) return missing;
      }
      return rowIds;
    },
    [key, fetchNext],
  );

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);
  /** Latest loaded rows, for use in async callbacks after ensureRows. */
  const currentRows = useCallback(() => stateRef.current.rows, []);

  // While a new view loads, the previous rows stay on screen (marked busy) so scroll and focus survive.
  const loading = state.key !== key;
  return { rows: state.rows, total: state.total, nextCursor: loading ? null : state.nextCursor, error: loading ? null : state.error, loading, loadingMore: state.loadingMore, loadMore, ensureRows, reload, currentRows };
}

/** Fetches specific rows of a version by id, in chunks the server accepts. Ids not in the version are absent. */
export async function fetchRowsByIds(datasetId: string, versionId: string, ids: string[], signal?: AbortSignal): Promise<Map<string, Row>> {
  const unique = [...new Set(ids)];
  const found = new Map<string, Row>();
  for (let i = 0; i < unique.length; i += MAX_ROW_IDS_PER_QUERY) {
    const chunk = unique.slice(i, i + MAX_ROW_IDS_PER_QUERY);
    const page = await api.getRows(datasetId, { versionId, rowIds: chunk, limit: chunk.length }, signal);
    for (const row of page.rows) found.set(row.id, row);
  }
  return found;
}
