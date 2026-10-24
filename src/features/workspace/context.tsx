"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { DatasetDetail, Health, SelectionEvent, Source, SourceSelection } from "@/contracts";
import { ApiClientError, api } from "@/lib/api/client";

export interface WorkspaceState {
  health: Health | null;
  source: Source | null;
  selection: SourceSelection | null;
  /** Detail of the displayed version (may be an older, read-only version). */
  detail: DatasetDetail | null;
  linked: SelectionEvent | null;
  loadError: ApiClientError | null;
}

export interface WorkspaceApi extends WorkspaceState {
  isCurrentVersion: boolean;
  setHealth: (h: Health | null) => void;
  setSource: (s: Source | null) => void;
  setSelection: (s: SourceSelection | null) => void;
  setDetail: (d: DatasetDetail) => void;
  loadDataset: (datasetId: string, versionId?: string) => Promise<void>;
  /** Reloads the dataset's current version (used after a 409 version conflict). */
  reloadCurrent: () => Promise<void>;
  select: (e: SelectionEvent | null) => void;
  reset: () => void;
}

const Ctx = createContext<WorkspaceApi | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [source, setSourceState] = useState<Source | null>(null);
  const [selection, setSelectionState] = useState<SourceSelection | null>(null);
  const [detail, setDetailState] = useState<DatasetDetail | null>(null);
  const [linked, setLinked] = useState<SelectionEvent | null>(null);
  const [loadError, setLoadError] = useState<ApiClientError | null>(null);

  const setDetail = useCallback((d: DatasetDetail) => {
    setDetailState(d);
    setLoadError(null);
    // Linked selection is version-scoped; drop it when the displayed version changes.
    setLinked((prev) => (prev && prev.datasetVersionId === d.version.id ? prev : null));
  }, []);

  const loadDataset = useCallback(
    async (datasetId: string, versionId?: string) => {
      try {
        setDetail(await api.getDataset(datasetId, versionId));
      } catch (e) {
        if (e instanceof ApiClientError) setLoadError(e);
        else throw e;
      }
    },
    [setDetail],
  );

  const reloadCurrent = useCallback(async () => {
    if (detail) await loadDataset(detail.dataset.id);
  }, [detail, loadDataset]);

  const setSource = useCallback((s: Source | null) => {
    setSourceState(s);
    setSelectionState(null);
    setDetailState(null);
    setLinked(null);
    setLoadError(null);
  }, []);

  const setSelection = useCallback((s: SourceSelection | null) => {
    setSelectionState(s);
    if (s === null) {
      setDetailState(null);
      setLinked(null);
    }
  }, []);

  const reset = useCallback(() => setSource(null), [setSource]);

  const value = useMemo<WorkspaceApi>(
    () => ({
      health,
      source,
      selection,
      detail,
      linked,
      loadError,
      isCurrentVersion: !!detail && detail.version.id === detail.dataset.currentVersionId,
      setHealth,
      setSource,
      setSelection,
      setDetail,
      loadDataset,
      reloadCurrent,
      select: setLinked,
      reset,
    }),
    [health, source, selection, detail, linked, loadError, setSource, setSelection, setDetail, loadDataset, reloadCurrent, reset],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return v;
}
