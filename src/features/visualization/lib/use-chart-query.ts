"use client";

import { useEffect, useState } from "react";
import type { ChartQueryResult } from "@/contracts";
import { ApiClientError, api } from "@/lib/api/client";

type Settled = { key: string; result: ChartQueryResult; error: null } | { key: string; result: null; error: ApiClientError };

/**
 * Fetches a chart query for the displayed version. Stale requests are aborted, and a
 * response is only used when it belongs to the current request key.
 */
export function useChartQuery(datasetId: string, versionId: string, xColumnId: string | null, yColumnIds: string[], savedViewId?: string) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const yKey = yColumnIds.join(",");
  const enabled = !!xColumnId && yKey.length > 0;
  const key = `${datasetId}|${versionId}|${xColumnId}|${yKey}|${savedViewId ?? ""}|${attempt}`;

  useEffect(() => {
    if (!xColumnId || !yKey) return;
    const requestKey = `${datasetId}|${versionId}|${xColumnId}|${yKey}|${savedViewId ?? ""}|${attempt}`;
    const ctrl = new AbortController();
    api.chartQuery(datasetId, { versionId, xColumnId, yColumnIds: yKey.split(","), savedViewId }, ctrl.signal).then(
      (result) => setSettled({ key: requestKey, result, error: null }),
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        const error =
          e instanceof ApiClientError ? e : new ApiClientError("internal", "The chart data could not be loaded.", 0, true, null, undefined);
        setSettled({ key: requestKey, result: null, error });
      },
    );
    return () => ctrl.abort();
  }, [datasetId, versionId, xColumnId, yKey, savedViewId, attempt]);

  const current = enabled && settled?.key === key ? settled : null;
  return {
    result: current?.result ?? null,
    error: current?.error ?? null,
    loading: enabled && !current,
    retry: () => setAttempt((n) => n + 1),
  };
}
