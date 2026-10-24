import Decimal from "decimal.js";
import type { ChartPoint } from "@/contracts";

/**
 * Precision policy: 34 significant digits during division, results rounded half-even
 * to 6 decimal places. Missing values stay missing.
 */
const D = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });
export const INDEX_DECIMAL_PLACES = 6;
export const INDEX_FORMULA = "value / base * 100" as const;

export type IndexResult =
  | { ok: true; base: string; baseRowId: string; points: ChartPoint[] }
  | { ok: false; message: string };

/** Rebases one series so the observation at baseX equals 100. */
export function indexSeries(points: ChartPoint[], baseX: string): IndexResult {
  const at = points.filter((p) => p.x === baseX);
  const withValue = at.filter((p) => p.y !== null);
  if (withValue.length === 0) {
    return { ok: false, message: at.length ? `The value at ${baseX} is missing, so it cannot be the base.` : `There is no observation at ${baseX}.` };
  }
  if (withValue.length > 1) return { ok: false, message: `${baseX} appears more than once, so the base observation is ambiguous.` };
  const baseObs = withValue[0];
  const base = new D(baseObs.y as string);
  if (base.lte(0)) {
    return { ok: false, message: `The base value at ${baseX} is ${baseObs.y}; an index needs a positive base.` };
  }
  return {
    ok: true,
    base: baseObs.y as string,
    baseRowId: baseObs.rowId,
    points: points.map((p) => ({
      ...p,
      y: p.y === null ? null : new D(p.y).div(base).times(100).toDecimalPlaces(INDEX_DECIMAL_PLACES).toString(),
    })),
  };
}

/** x values where every series has exactly one non-missing y; candidates for a shared base. */
export function sharedBaseCandidates(series: ChartPoint[][]): string[] {
  if (series.length === 0) return [];
  const counts = series.map((pts) => {
    const m = new Map<string, number>();
    for (const p of pts) if (p.x !== null && p.y !== null) m.set(p.x, (m.get(p.x) ?? 0) + 1);
    return m;
  });
  return [...counts[0].keys()].filter((x) => counts.every((m) => m.get(x) === 1));
}
