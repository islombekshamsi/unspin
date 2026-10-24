import type { BaselinePolicy, ChartKind, Column } from "@/contracts";
import { initialChoice, type YScale } from "./presentation";

const PREFIX = "unspin.chart.v1.";

export interface StoredChartSettings {
  xColumnId: string | null;
  yColumnIds: string[];
  hidden: string[];
  kind: ChartKind | null;
  scale: YScale;
  baseline: BaselinePolicy["mode"] | null;
  bounds: { min: string; max: string };
}

const KINDS = new Set<ChartKind>(["bar", "line", "scatter"]);
const SCALES = new Set<YScale>(["linear", "log"]);
const BASELINES = new Set<BaselinePolicy["mode"]>(["include_zero", "fit_data", "explicit_bounds"]);

function storageKey(datasetId: string): string {
  return `${PREFIX}${datasetId}`;
}

export function parseStoredChartSettings(raw: unknown, columns: Column[]): StoredChartSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ids = new Set(columns.map((c) => c.id));
  const fallback = initialChoice(columns);
  const x = typeof o.xColumnId === "string" && ids.has(o.xColumnId) ? o.xColumnId : fallback.xColumnId;
  const listed = Array.isArray(o.yColumnIds) ? o.yColumnIds.filter((id): id is string => typeof id === "string" && ids.has(id) && id !== x) : [];
  const yColumnIds = listed.length ? listed : fallback.yColumnIds.filter((id) => id !== x);
  const hidden = Array.isArray(o.hidden) ? o.hidden.filter((id): id is string => typeof id === "string" && yColumnIds.includes(id)) : [];
  const kind = typeof o.kind === "string" && KINDS.has(o.kind as ChartKind) ? (o.kind as ChartKind) : null;
  const scale = typeof o.scale === "string" && SCALES.has(o.scale as YScale) ? (o.scale as YScale) : "linear";
  const baseline = typeof o.baseline === "string" && BASELINES.has(o.baseline as BaselinePolicy["mode"]) ? (o.baseline as BaselinePolicy["mode"]) : null;
  const boundsRaw = o.bounds && typeof o.bounds === "object" ? (o.bounds as Record<string, unknown>) : {};
  const bounds = {
    min: typeof boundsRaw.min === "string" ? boundsRaw.min : "",
    max: typeof boundsRaw.max === "string" ? boundsRaw.max : "",
  };
  return { xColumnId: x, yColumnIds, hidden, kind, scale, baseline, bounds };
}

export function readChartSettings(datasetId: string, columns: Column[]): StoredChartSettings | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(datasetId));
    if (!raw) return null;
    return parseStoredChartSettings(JSON.parse(raw) as unknown, columns);
  } catch {
    return null;
  }
}

export function writeChartSettings(datasetId: string, settings: StoredChartSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(datasetId), JSON.stringify(settings));
  } catch {
    // Quota or private-mode denial; the live session still has the settings in memory.
  }
}
