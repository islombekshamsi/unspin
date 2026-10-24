import Decimal from "decimal.js";
import type { ChartQueryResult, Column } from "@/contracts";

/** What a series measures. The data rarely states this, so the user declares it. */
export const MEASURES = ["unknown", "price", "total_return", "amount", "count", "average", "rate", "other"] as const;
export type Measure = (typeof MEASURES)[number];
export const MEASURE_LABEL: Record<Measure, string> = {
  unknown: "Not stated yet",
  price: "Price / level",
  total_return: "Total return (incl. distributions)",
  amount: "Amount / total (e.g. revenue)",
  count: "Count",
  average: "Average",
  rate: "Rate",
  other: "Other",
};

/** How each value was aggregated over its x period, as declared by the user. */
export const AGGREGATIONS = ["unknown", "as_recorded", "end_of_period", "period_average", "period_total"] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];
export const AGGREGATION_LABEL: Record<Aggregation, string> = {
  unknown: "Not stated yet",
  as_recorded: "Individual observations as recorded",
  end_of_period: "End-of-period values",
  period_average: "Period averages",
  period_total: "Period totals",
};

export interface SeriesFacts {
  label: string;
  xColumn: Column;
  yColumn: Column;
  xKind: ChartQueryResult["xKind"];
  /** x values of points that have a y value. */
  xValues: string[];
  /** Number of non-missing y values. */
  plottable: number;
  measure: Measure;
  aggregation: Aggregation;
}

export type CheckStatus = "ok" | "warning" | "unknown" | "incompatible";

export interface Check {
  id: "series" | "values" | "measure" | "aggregation" | "currency" | "unit" | "percent" | "x_kind" | "x_unit" | "period";
  label: string;
  status: CheckStatus;
  message: string;
}

export interface Compatibility {
  status: "compatible" | "incompatible" | "unknown";
  checks: Check[];
  /** What the user must supply or change before an overlay is shown. */
  needs: string[];
}

const names = (xs: SeriesFacts[]) => xs.map((s) => `“${s.label}”`).join(", ");
const distinct = <T>(xs: T[]) => [...new Set(xs)];

/**
 * Decides whether series can share one axis. Unknown facts block the overlay just like
 * conflicts; the result says what must be supplied. Indexing removes unit scale but never
 * reconciles currencies, percent representations, measures, or aggregation.
 */
export function checkCompatibility(series: SeriesFacts[], opts: { indexed: boolean }): Compatibility {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  if (series.length < 2) {
    add({ id: "series", label: "Series", status: "unknown", message: "Choose at least two series to compare." });
    return finish(checks);
  }

  const empty = series.filter((s) => s.plottable === 0);
  add(
    empty.length
      ? { id: "values", label: "Values", status: "incompatible", message: `${names(empty)} ${empty.length === 1 ? "has" : "have"} no numeric values to plot.` }
      : { id: "values", label: "Values", status: "ok", message: "Every series has numeric values." },
  );

  // Measure type
  const unstated = series.filter((s) => s.measure === "unknown" || s.measure === "other");
  const measures = distinct(series.map((s) => s.measure));
  if (unstated.length) {
    add({
      id: "measure",
      label: "Measure",
      status: "unknown",
      message: `State what ${names(unstated)} ${unstated.length === 1 ? "measures" : "measure"} (price, total return, amount, count, average, or rate). “Other” cannot be checked automatically.`,
    });
  } else if (measures.length > 1) {
    const priceVsReturn = measures.includes("price") && measures.includes("total_return");
    add({
      id: "measure",
      label: "Measure",
      status: "incompatible",
      message: priceVsReturn
        ? "A price series and a total-return series are different measures: price change leaves out dividends and other distributions."
        : `The series measure different things (${measures.map((m) => MEASURE_LABEL[m].toLowerCase()).join(" vs ")}).`,
    });
  } else {
    add({ id: "measure", label: "Measure", status: "ok", message: `Every series is stated as: ${MEASURE_LABEL[measures[0]].toLowerCase()}.` });
  }

  // Aggregation
  const unknownAgg = series.filter((s) => s.aggregation === "unknown");
  const aggs = distinct(series.map((s) => s.aggregation));
  if (unknownAgg.length) {
    add({ id: "aggregation", label: "Aggregation", status: "unknown", message: `State how the values of ${names(unknownAgg)} were aggregated.` });
  } else if (aggs.length > 1) {
    add({
      id: "aggregation",
      label: "Aggregation",
      status: "incompatible",
      message: `The series are aggregated differently (${aggs.map((a) => AGGREGATION_LABEL[a].toLowerCase()).join(" vs ")}).`,
    });
  } else {
    add({ id: "aggregation", label: "Aggregation", status: "ok", message: AGGREGATION_LABEL[aggs[0]] + "." });
  }

  // Currency (never reconciled, not even by indexing)
  const withCurrency = series.filter((s) => s.yColumn.currency);
  const currencies = distinct(withCurrency.map((s) => s.yColumn.currency as string));
  if (currencies.length > 1) {
    add({
      id: "currency",
      label: "Currency",
      status: "incompatible",
      message: `Different currencies (${currencies.join(", ")}) are not overlaid. Convert one series with a documented exchange rate first.`,
    });
  } else if (withCurrency.length && withCurrency.length < series.length) {
    const missing = series.filter((s) => !s.yColumn.currency);
    add({ id: "currency", label: "Currency", status: "unknown", message: `${names(missing)} ${missing.length === 1 ? "has" : "have"} no recorded currency; record it in the data before comparing with ${currencies[0]}.` });
  } else {
    add({ id: "currency", label: "Currency", status: "ok", message: currencies.length ? `All in ${currencies[0]}.` : "No currency recorded on any series." });
  }

  // Unit
  const units = distinct(series.map((s) => s.yColumn.unit ?? null));
  const someMissingUnit = units.includes(null) && units.length > 1;
  if (units.length > 1) {
    add({
      id: "unit",
      label: "Unit",
      status: opts.indexed ? "warning" : someMissingUnit ? "unknown" : "incompatible",
      message: opts.indexed
        ? `Units differ (${units.map((u) => u ?? "none recorded").join(", ")}); indexing compares relative change only, so confirm the series measure the same thing.`
        : someMissingUnit
          ? "Some series have no recorded unit. Record the unit in the data, or index the series to compare relative change."
          : `Units differ (${units.join(", ")}). Convert to a common unit, or index the series to compare relative change.`,
    });
  } else {
    add({ id: "unit", label: "Unit", status: units[0] ? "ok" : "warning", message: units[0] ? `All in ${units[0]}.` : "No unit is recorded on any series; confirm they share one." });
  }

  // Percent representation (12.5 vs 0.125)
  const reps = distinct(series.map((s) => s.yColumn.percentRepresentation ?? null));
  add(
    reps.length > 1
      ? {
          id: "percent",
          label: "Percent",
          status: "incompatible",
          message: `Percent representations differ (${reps.map((r) => (r === "percent_number" ? "12.5 = 12.5%" : r === "fraction" ? "0.125 = 12.5%" : "not a percent")).join(" vs ")}). Convert one series first.`,
        }
      : { id: "percent", label: "Percent", status: "ok", message: reps[0] ? "Same percent representation." : "No series is a percent." },
  );

  // x axis kind and units
  const kinds = distinct(series.map((s) => s.xKind));
  if (kinds.length > 1) {
    add({ id: "x_kind", label: "X axis", status: "incompatible", message: `The x axes are of different kinds (${kinds.join(" vs ")}).` });
    return finish(checks);
  }
  add({ id: "x_kind", label: "X axis", status: "ok", message: `All x axes are ${kinds[0] === "numeric" ? "numbers" : kinds[0] === "date" ? "dates" : "categories"}.` });
  if (kinds[0] === "numeric") {
    const xUnits = distinct(series.map((s) => s.xColumn.unit ?? null));
    if (xUnits.length > 1) add({ id: "x_unit", label: "X unit", status: "incompatible", message: `The x axes use different units (${xUnits.map((u) => u ?? "none recorded").join(", ")}).` });
  }

  add(periodCheck(series, kinds[0]));
  return finish(checks);
}

function periodCheck(series: SeriesFacts[], kind: SeriesFacts["xKind"]): Check {
  if (kind === "category") {
    const sets = series.map((s) => new Set(s.xValues));
    const shared = [...sets[0]].filter((v) => sets.every((set) => set.has(v)));
    if (shared.length === 0) return { id: "period", label: "Coverage", status: "incompatible", message: "The series share no categories." };
    const partial = sets.some((set) => set.size > shared.length);
    return {
      id: "period",
      label: "Coverage",
      status: partial ? "warning" : "ok",
      message: partial ? `${shared.length} categories are shared; the others appear in only some series.` : "All series cover the same categories.",
    };
  }

  const ranges = series.map((s) => range(s.xValues, kind));
  if (ranges.some((r) => r === null)) return { id: "period", label: "Coverage", status: "incompatible", message: "A series has no x values." };
  const rs = ranges as Array<{ min: string; max: string; lo: Decimal; hi: Decimal }>;
  const lo = rs.reduce((a, b) => (b.lo.gt(a.lo) ? b : a));
  const hi = rs.reduce((a, b) => (b.hi.lt(a.hi) ? b : a));
  const span = rs.map((r, i) => `“${series[i].label}” ${r.min} – ${r.max}`).join("; ");
  if (lo.lo.gt(hi.hi)) {
    return {
      id: "period",
      label: kind === "date" ? "Period" : "X range",
      status: kind === "date" ? "incompatible" : "warning",
      message: `The ${kind === "date" ? "periods" : "x ranges"} do not overlap (${span}).`,
    };
  }
  const full = rs.every((r) => r.lo.eq(lo.lo) && r.hi.eq(hi.hi));
  const granularity = kind === "date" && distinct(series.map((s) => s.xColumn.dataType)).length > 1;
  return {
    id: "period",
    label: kind === "date" ? "Period" : "X range",
    status: full && !granularity ? "ok" : "warning",
    message:
      (full
        ? `Same ${kind === "date" ? "period" : "range"}: ${lo.min} – ${hi.max}.`
        : `Shared ${kind === "date" ? "period" : "range"} is ${lo.min} – ${hi.max} (${span}). Values outside it are shown but not matched; nothing is filled in.`) +
      (granularity ? " Some series have dates and others date-times." : ""),
  };
}

function range(xs: string[], kind: "numeric" | "date") {
  let best: { min: string; max: string; lo: Decimal; hi: Decimal } | null = null;
  for (const x of xs) {
    let d: Decimal;
    try {
      d = kind === "numeric" ? new Decimal(x) : new Decimal(Date.parse(x));
    } catch {
      continue;
    }
    if (!d.isFinite()) continue;
    if (!best) {
      best = { min: x, max: x, lo: d, hi: d };
      continue;
    }
    if (d.lt(best.lo)) {
      best.min = x;
      best.lo = d;
    }
    if (d.gt(best.hi)) {
      best.max = x;
      best.hi = d;
    }
  }
  return best;
}

function finish(checks: Check[]): Compatibility {
  const status = checks.some((c) => c.status === "incompatible") ? "incompatible" : checks.some((c) => c.status === "unknown") ? "unknown" : "compatible";
  return { status, checks, needs: checks.filter((c) => c.status === "unknown" || c.status === "incompatible").map((c) => c.message) };
}
