"use client";

import { useEffect, useRef, useState } from "react";
import type { ChartQueryResult, Dataset, DatasetDetail } from "@/contracts";
import { ApiClientError, api } from "@/lib/api/client";

export interface CatalogEntry {
  dataset: Dataset;
  sourceName: string;
}

type Catalog = { status: "loading" } | { status: "ok"; entries: CatalogEntry[] } | { status: "error"; error: ApiClientError };

function asClientError(e: unknown, message: string): ApiClientError {
  return e instanceof ApiClientError ? e : new ApiClientError("internal", message, 0, true, null, undefined);
}

/** Every dataset the user owns, across sources, with the open dataset always included. */
export function useDatasetCatalog(current: Dataset) {
  const [catalog, setCatalog] = useState<Catalog>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sources = await api.listSources();
        const lists = await Promise.all(sources.map(async (s) => ({ s, ds: await api.listDatasetsForSource(s.id) })));
        const entries = lists.flatMap(({ s, ds }) => ds.map((dataset) => ({ dataset, sourceName: s.filename })));
        if (!cancelled) setCatalog({ status: "ok", entries });
      } catch (e) {
        if (!cancelled) setCatalog({ status: "error", error: asClientError(e, "Your datasets could not be listed.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const withCurrent: Catalog =
    catalog.status === "ok" && !catalog.entries.some((e) => e.dataset.id === current.id)
      ? { status: "ok", entries: [{ dataset: current, sourceName: "Open source" }, ...catalog.entries] }
      : catalog;

  return {
    catalog: withCurrent,
    retry: () => {
      setCatalog({ status: "loading" });
      setAttempt((n) => n + 1);
    },
  };
}

/** Loads other datasets' details on demand (current versions). The open dataset is not fetched. */
export function useDatasetDetails(current: DatasetDetail, wantedIds: string[]) {
  const [loaded, setLoaded] = useState<Record<string, DatasetDetail | ApiClientError>>({});
  const requested = useRef(new Set<string>());
  const wantedKey = [...new Set(wantedIds)].filter((id) => id && id !== current.dataset.id).sort().join(",");

  useEffect(() => {
    for (const id of wantedKey ? wantedKey.split(",") : []) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      api.getDataset(id).then(
        (d) => setLoaded((m) => ({ ...m, [id]: d })),
        (e: unknown) => {
          requested.current.delete(id);
          setLoaded((m) => ({ ...m, [id]: asClientError(e, "The dataset could not be opened.") }));
        },
      );
    }
  }, [wantedKey]);

  return loaded;
}

/** Key for one single-series chart query. Ids never contain "|". */
export function queryKey(datasetId: string, versionId: string, xColumnId: string, yColumnId: string) {
  return `${datasetId}|${versionId}|${xColumnId}|${yColumnId}`;
}

/** One chart query per series; settled results are cached by key, stale requests aborted. */
export function useSeriesQueries(keys: string[]) {
  const [results, setResults] = useState<Record<string, ChartQueryResult | ApiClientError>>({});
  const [attempt, setAttempt] = useState(0);
  const done = useRef(new Set<string>());
  const keyList = [...new Set(keys)].join("\n");

  useEffect(() => {
    const ctrl = new AbortController();
    for (const key of keyList ? keyList.split("\n") : []) {
      if (done.current.has(key)) continue;
      const [datasetId, versionId, xColumnId, yColumnId] = key.split("|");
      api.chartQuery(datasetId, { versionId, xColumnId, yColumnIds: [yColumnId] }, ctrl.signal).then(
        (r) => {
          done.current.add(key);
          setResults((m) => ({ ...m, [key]: r }));
        },
        (e: unknown) => {
          if (ctrl.signal.aborted) return;
          done.current.add(key);
          setResults((m) => ({ ...m, [key]: asClientError(e, "The series could not be loaded.") }));
        },
      );
    }
    return () => ctrl.abort();
  }, [keyList, attempt]);

  return {
    results,
    retry: (key: string) => {
      done.current.delete(key);
      setResults((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      });
      setAttempt((n) => n + 1);
    },
  };
}
