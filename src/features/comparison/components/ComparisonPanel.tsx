"use client";

import { useMemo, useState } from "react";
import type { ChartPoint, ChartQueryResult, Column, DatasetDetail } from "@/contracts";
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Select, UnavailableNote, cx } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import type { ComparisonPanelProps } from "@/features/workspace/seams";
import { RechartsChart } from "@/features/visualization";
import { ChartDataTable } from "@/features/visualization/components/ChartDataTable";
import { PointNavigator } from "@/features/visualization/components/PointNavigator";
import { buildPlotModel, type FigureSeries } from "@/features/visualization/lib/figure";
import {
  axisTitle,
  describePoint,
  initialChoice,
  seriesStyle,
  sortByX,
  sortXValues,
  unitText,
  yAxisTitle,
} from "@/features/visualization/lib/presentation";
import { ApiClientError } from "@/lib/api/client";
import {
  AGGREGATIONS,
  AGGREGATION_LABEL,
  MEASURES,
  MEASURE_LABEL,
  checkCompatibility,
  type Aggregation,
  type CheckStatus,
  type Compatibility,
  type Measure,
  type SeriesFacts,
} from "../lib/compatibility";
import { INDEX_DECIMAL_PLACES, INDEX_FORMULA, indexSeries, sharedBaseCandidates } from "../lib/indexing";
import { queryKey, useDatasetCatalog, useDatasetDetails, useSeriesQueries } from "../lib/use-comparison-data";

interface SeriesRow {
  key: number;
  datasetId: string;
  xColumnId: string;
  yColumnId: string;
  measure: Measure;
  aggregation: Aggregation;
}

/** A row resolved against its loaded dataset and query result. */
interface Resolved {
  row: SeriesRow;
  detail: DatasetDetail | null;
  detailError: ApiClientError | null;
  xColumn?: Column;
  yColumn?: Column;
  key: string | null;
  result: ChartQueryResult | null;
  queryError: ApiClientError | null;
  label: string;
}

const MAX_ROWS = 6;

const STATUS_TEXT: Record<CheckStatus, { mark: string; text: string; className: string }> = {
  ok: { mark: "✓", text: "OK", className: "text-success" },
  warning: { mark: "!", text: "Note", className: "text-estimate" },
  unknown: { mark: "?", text: "Needs information", className: "text-estimate" },
  incompatible: { mark: "✕", text: "Conflict", className: "text-danger" },
};

const OVERALL: Record<Compatibility["status"], { tone: BadgeTone; text: string }> = {
  compatible: { tone: "success", text: "Compatible" },
  unknown: { tone: "estimate", text: "Needs information" },
  incompatible: { tone: "danger", text: "Not comparable" },
};

function firstRows(detail: DatasetDetail): SeriesRow[] {
  const init = initialChoice(detail.version.columns);
  const base = { measure: "unknown" as Measure, aggregation: "unknown" as Aggregation };
  return [
    { key: 1, datasetId: detail.dataset.id, xColumnId: init.xColumnId ?? "", yColumnId: init.yColumnIds[0] ?? "", ...base },
    { key: 2, datasetId: "", xColumnId: "", yColumnId: "", ...base },
  ];
}

export function ComparisonPanel({ detail }: ComparisonPanelProps) {
  const { catalog, retry: retryCatalog } = useDatasetCatalog(detail.dataset);
  const [rows, setRows] = useState<SeriesRow[]>(() => firstRows(detail));
  const [nextKey, setNextKey] = useState(3);
  const [indexed, setIndexed] = useState(false);
  const [baseChoice, setBaseChoice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const loadedDetails = useDatasetDetails(
    detail,
    rows.map((r) => r.datasetId),
  );

  // Resolve each row against its dataset, with sensible column defaults once it is loaded.
  const resolvedBase = useMemo(
    () =>
      rows.map((row) => {
        const d = !row.datasetId ? null : row.datasetId === detail.dataset.id ? detail : (loadedDetails[row.datasetId] ?? null);
        const loaded = d instanceof ApiClientError ? null : d;
        const cols = loaded?.version.columns ?? [];
        const init = loaded ? initialChoice(cols) : null;
        const xColumn = cols.find((c) => c.id === row.xColumnId) ?? cols.find((c) => c.id === init?.xColumnId);
        const yColumn =
          cols.find((c) => c.id === row.yColumnId && c.id !== xColumn?.id) ?? cols.find((c) => c.id === init?.yColumnIds[0] && c.id !== xColumn?.id);
        const key = loaded && xColumn && yColumn ? queryKey(loaded.dataset.id, loaded.version.id, xColumn.id, yColumn.id) : null;
        return { row, detail: loaded, detailError: d instanceof ApiClientError ? d : null, xColumn, yColumn, key };
      }),
    [rows, detail, loadedDetails],
  );
  const queries = useSeriesQueries(resolvedBase.flatMap((r) => (r.key ? [r.key] : [])));
  const resolved = useMemo<Resolved[]>(() => {
    const multipleDatasets = new Set(rows.map((r) => r.datasetId).filter(Boolean)).size > 1;
    return resolvedBase.map((r) => {
      const q = r.key ? (queries.results[r.key] ?? null) : null;
      const name = r.yColumn ? r.yColumn.seriesLabel || r.yColumn.label : "Series";
      return {
        ...r,
        result: q instanceof ApiClientError ? null : q,
        queryError: q instanceof ApiClientError ? q : null,
        label: multipleDatasets && r.detail ? `${name} — ${r.detail.dataset.title}` : name,
      };
    });
  }, [resolvedBase, queries.results, rows]);

  const ready = resolved.every((r) => r.result && r.xColumn && r.yColumn);
  const compat = useMemo(() => {
    if (!ready) return null;
    const facts: SeriesFacts[] = resolved.map((r) => {
      const withY = r.result!.points.filter((p) => p.y !== null);
      return {
        label: r.label,
        xColumn: r.xColumn!,
        yColumn: r.yColumn!,
        xKind: r.result!.xKind,
        xValues: withY.flatMap((p) => (p.x === null ? [] : [p.x])),
        plottable: withY.length,
        measure: r.row.measure,
        aggregation: r.row.aggregation,
      };
    });
    return checkCompatibility(facts, { indexed });
  }, [ready, resolved, indexed]);

  const sortedCandidates = useMemo(
    () => (ready ? sortXValues(sharedBaseCandidates(resolved.map((r) => r.result!.points)), resolved[0].result!.xKind) : []),
    [ready, resolved],
  );
  const baseX = baseChoice && sortedCandidates.includes(baseChoice) ? baseChoice : (sortedCandidates[0] ?? null);
  const indexResults = useMemo(
    () => (indexed && ready && baseX ? resolved.map((r) => indexSeries(r.result!.points, baseX)) : null),
    [indexed, ready, baseX, resolved],
  );
  const indexError = indexed && ready && !baseX ? "No x value is observed exactly once in every series, so there is no shared base observation." : null;

  const overlayAllowed = compat?.status === "compatible" && (!indexed || (indexResults?.every((r) => r.ok) ?? false));

  const figure = useOverlay(overlayAllowed ? resolved : null, indexResults, baseX, focusId, selected);

  const updateRow = (key: number, patch: Partial<SeriesRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  if (catalog.status === "loading") {
    return (
      <p role="status" className="py-10 text-center text-[13px] text-ink-muted">
        Loading your datasets…
      </p>
    );
  }
  if (catalog.status === "error") {
    return (
      <ErrorState
        title="Could not list your datasets"
        message={catalog.error.message}
        code={catalog.error.code}
        requestId={catalog.error.requestId ?? undefined}
        action={
          <Button size="sm" onClick={retryCatalog}>
            Retry
          </Button>
        }
      />
    );
  }

  const entries = catalog.entries;
  const bySource = new Map<string, typeof entries>();
  for (const e of entries) bySource.set(e.sourceName, [...(bySource.get(e.sourceName) ?? []), e]);

  return (
    <div className="flex flex-col gap-4">
      {entries.length <= 1 && (
        <UnavailableNote>
          This is your only dataset. To compare against another source, export or note this work, choose the UNSPIN wordmark to start over, and upload the other file; its dataset will then be listed here. You can still compare two columns of this dataset below.
        </UnavailableNote>
      )}

      <section aria-labelledby="cmp-series" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="cmp-series" className="text-[13px] font-semibold tracking-wide uppercase">
            Series
          </h3>
          <p className="text-[12px] text-ink-muted">The data rarely states what a value measures, so say it for each series.</p>
        </div>
        <ol className="flex flex-col gap-3">
          {resolved.map((r, i) => {
            const style = seriesStyle(i);
            const cols = r.detail?.version.columns ?? [];
            return (
              <li key={r.row.key} className="rounded-md border border-rule p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium">
                    <span aria-hidden="true" style={{ color: style.color }}>
                      ●{" "}
                    </span>
                    Series {i + 1}
                    {r.yColumn ? `: ${r.label}` : ""}
                  </p>
                  {rows.length > 2 && (
                    <IconButton label={`Remove series ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.row.key))}>
                      <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    </IconButton>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Field label="Dataset">
                    {(id) => (
                      <Select id={id} value={r.row.datasetId} onChange={(e) => updateRow(r.row.key, { datasetId: e.target.value, xColumnId: "", yColumnId: "" })}>
                        <option value="">Choose a dataset…</option>
                        {[...bySource.entries()].map(([source, es]) => (
                          <optgroup key={source} label={source}>
                            {es.map((e) => (
                              <option key={e.dataset.id} value={e.dataset.id}>
                                {e.dataset.title}
                                {e.dataset.id === detail.dataset.id ? " (open now)" : ""}
                                {e.dataset.coverage !== "complete_selection" ? " — partial coverage" : ""}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="X column">
                    {(id) => (
                      <Select id={id} disabled={!cols.length} value={r.xColumn?.id ?? ""} onChange={(e) => updateRow(r.row.key, { xColumnId: e.target.value })}>
                        {cols.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label} ({c.dataType})
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Y column">
                    {(id) => (
                      <Select id={id} disabled={!cols.length} value={r.yColumn?.id ?? ""} onChange={(e) => updateRow(r.row.key, { yColumnId: e.target.value })}>
                        {!r.yColumn && <option value="">No column</option>}
                        {cols
                          .filter((c) => c.id !== r.xColumn?.id)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                              {c.dataType !== "decimal" ? ` (${c.dataType})` : ""}
                            </option>
                          ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="This series measures">
                    {(id) => (
                      <Select id={id} value={r.row.measure} onChange={(e) => updateRow(r.row.key, { measure: e.target.value as Measure })}>
                        {MEASURES.map((m) => (
                          <option key={m} value={m}>
                            {MEASURE_LABEL[m]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Values are">
                    {(id) => (
                      <Select id={id} value={r.row.aggregation} onChange={(e) => updateRow(r.row.key, { aggregation: e.target.value as Aggregation })}>
                        {AGGREGATIONS.map((a) => (
                          <option key={a} value={a}>
                            {AGGREGATION_LABEL[a]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
                <SeriesFactsLine r={r} onRetry={() => r.key && queries.retry(r.key)} />
              </li>
            );
          })}
        </ol>
        {rows.length < MAX_ROWS && (
          <div>
            <Button
              size="sm"
              onClick={() => {
                setRows((rs) => [...rs, { key: nextKey, datasetId: "", xColumnId: "", yColumnId: "", measure: "unknown", aggregation: "unknown" }]);
                setNextKey((k) => k + 1);
              }}
            >
              Add series
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="cmp-check" className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 id="cmp-check" className="text-[13px] font-semibold tracking-wide uppercase">
            Compatibility
          </h3>
          {compat && <Badge tone={OVERALL[compat.status].tone}>{OVERALL[compat.status].text}</Badge>}
        </div>
        {!compat ? (
          <p className="text-[13px] text-ink-muted">Choose a dataset and columns for every series to check whether they can share one chart.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {compat.checks.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span aria-hidden="true" className={cx("w-4 shrink-0 text-center font-semibold", STATUS_TEXT[c.status].className)}>
                  {STATUS_TEXT[c.status].mark}
                </span>
                <span>
                  <span className="font-medium">{c.label}</span>
                  <span className="sr-only"> ({STATUS_TEXT[c.status].text})</span>: {c.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cmp-index" className="flex flex-col gap-2">
        <h3 id="cmp-index" className="text-[13px] font-semibold tracking-wide uppercase">
          Indexing (optional)
        </h3>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={indexed} onChange={(e) => setIndexed(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Index each series to 100 at a shared base observation
        </label>
        {indexed && (
          <div className="flex flex-col gap-2 rounded-md border border-rule bg-sunken p-3 text-[13px]">
            {sortedCandidates.length > 0 && (
              <Field label="Base observation (x)" className="max-w-64">
                {(id) => (
                  <Select id={id} value={baseX ?? ""} onChange={(e) => setBaseChoice(e.target.value)}>
                    {sortedCandidates.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <p>
              Formula: <code className="font-mono">index = {INDEX_FORMULA}</code>, rounded to {INDEX_DECIMAL_PLACES} decimal places. Indexing shows change relative to the base; it does not turn a price series into total return.
            </p>
            {indexError && <p className="text-danger">{indexError}</p>}
            {indexResults && (
              <ul className="flex flex-col gap-1">
                {indexResults.map((ir, i) => (
                  <li key={resolved[i].row.key}>
                    <span className="font-medium">{resolved[i].label}</span>:{" "}
                    {ir.ok ? (
                      <span className="tabular">
                        value / {ir.base} × 100 (base at x = {baseX})
                      </span>
                    ) : (
                      <span className="text-danger">{ir.message}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="cmp-chart" className="flex flex-col gap-2">
        <h3 id="cmp-chart" className="text-[13px] font-semibold tracking-wide uppercase">
          Overlay
        </h3>
        {!figure ? (
          <EmptyState title="No overlay yet">
            {compat && compat.needs.length ? (
              <ul className="list-disc pl-5 text-left">
                {compat.needs.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : indexed && indexResults?.some((r) => !r.ok) ? (
              "Choose a base observation that every series has, with a positive value."
            ) : (
              "The overlay appears once every series is chosen and the compatibility check passes."
            )}
          </EmptyState>
        ) : (
          <figure className="flex flex-col gap-2">
            <figcaption>
              <Badge className="whitespace-normal!" tone="neutral">{indexed ? `Indexed: ${INDEX_FORMULA}, base at x = ${baseX}` : "Values as stored in each dataset"}</Badge>
            </figcaption>
            <RechartsChart
              className="h-[min(380px,55vh)] min-h-[240px] w-full shrink-0"
              model={figure.model}
              label={`Overlay of ${resolved.map((r) => r.label).join(", ")}. Use the point navigator or data table for exact values.`}
              onPointClick={setSelected}
              onPointsSelected={(ids) => setSelected(ids[0] ?? null)}
              onDeselect={() => setSelected(null)}
            />
            <p className="min-h-4 text-[12px] text-ink-muted" aria-live="polite">
              {selected && figure.lookup.get(selected) ? `Selected: ${figure.describe(figure.lookup.get(selected)!)}` : "Click a point to see its exact value and dataset."}
            </p>
            <PointNavigator series={figure.nav} describe={figure.describe} onFocusPoint={setFocusId} onSelect={(p) => setSelected(p.pointId)} />
            <div>
              <Button size="sm" variant="ghost" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
                {showTable ? "Hide data table" : "Show data table"}
              </Button>
            </div>
            {showTable && (
              <ChartDataTable
                series={figure.nav.map((s, i) => ({ ...s, yColumn: indexed ? undefined : resolved[i].yColumn }))}
                xColumn={resolved[0].xColumn}
                highlighted={new Set(selected ? [selected] : [])}
                onSelect={(p) => setSelected(p.pointId)}
              />
            )}
          </figure>
        )}
      </section>
    </div>
  );
}

function SeriesFactsLine({ r, onRetry }: { r: Resolved; onRetry: () => void }) {
  if (r.detailError) return <p className="mt-2 text-[12px] text-danger">{r.detailError.message}</p>;
  if (r.queryError) {
    return (
      <p className="mt-2 flex items-center gap-2 text-[12px] text-danger">
        {r.queryError.message} <span className="font-mono text-ink-muted">{r.queryError.code}</span>
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      </p>
    );
  }
  if (!r.row.datasetId) return null;
  if (!r.result || !r.yColumn) return <p className="mt-2 text-[12px] text-ink-muted">Loading…</p>;
  const withY = r.result.points.filter((p) => p.y !== null);
  const xs = sortByX(withY, r.result.xKind, r.result.points);
  const parts = [
    `Unit: ${unitText(r.yColumn) ?? "none recorded"}`,
    `x: ${r.result.xKind}${xs.length ? ` ${xs[0].x} – ${xs[xs.length - 1].x}` : ""}`,
    `${withY.length} value${withY.length === 1 ? "" : "s"}`,
  ];
  if (r.result.excluded.missingY) parts.push(`${r.result.excluded.missingY} missing`);
  if (r.result.excluded.nonNumericY) parts.push(`${r.result.excluded.nonNumericY} non-numeric`);
  if (r.result.sampling) parts.push(`sampled ${r.result.sampling.keptCount} of ${r.result.sampling.totalCount}`);
  return <p className="tabular mt-2 text-[12px] text-ink-muted">{parts.join(" · ")}</p>;
}

/** Overlay figure; point ids are namespaced per series so identical row ids in two datasets never collide. */
function useOverlay(
  resolved: Resolved[] | null,
  indexResults: ReturnType<typeof indexSeries>[] | null,
  baseX: string | null,
  focusId: string | null,
  selected: string | null,
) {
  const series = useMemo(() => {
    if (!resolved) return null;
    return resolved.map((r, i) => {
      const ir = indexResults?.[i];
      const pts = ir && ir.ok ? ir.points : r.result!.points;
      return {
        r,
        points: pts.map((p) => ({ ...p, pointId: `${r.row.key}::${p.pointId}` })),
        ...seriesStyle(i),
      };
    });
  }, [resolved, indexResults]);

  return useMemo(() => {
    if (!series || !resolved) return null;
    const xKind = resolved[0].result!.xKind;
    const all = series.flatMap((s) => s.points);
    const lookup = new Map(all.map((p) => [p.pointId, p]));
    const owner = new Map(series.flatMap((s) => s.points.map((p) => [p.pointId, s] as const)));
    const describe = (p: ChartPoint) => {
      const s = owner.get(p.pointId)!;
      const base = describePoint(p, s.r.label, s.r.xColumn, indexResults ? undefined : s.r.yColumn);
      return indexResults ? `${base} (index, ${baseX} = 100)` : base;
    };
    const fs: FigureSeries[] = series.map((s) => ({
      seriesId: `cmp-${s.r.row.key}`,
      yColumnId: s.r.yColumn!.id,
      label: s.r.label,
      color: s.color,
      symbol: s.symbol,
      dash: s.dash,
      points: s.points,
    }));
    const kind = xKind === "category" ? "bar" : "line";
    const xLabels = [...new Set(resolved.map((r) => r.xColumn!.label))];
    const model = buildPlotModel({
      kind,
      xKind,
      series: fs,
      allPoints: all,
      highlighted: new Set(selected ? [selected] : []),
      focusPointId: focusId,
      describe,
      xTitle: xLabels.length === 1 ? axisTitle(resolved[0].xColumn!) : xLabels.join(" / "),
      yTitle: indexResults ? `Index (${baseX} = 100)` : yAxisTitle(resolved.map((r) => r.yColumn!)).title,
      yScale: "linear",
      yRange: null,
      clipToBounds: false,
    });
    const nav = fs.map((s) => ({ seriesId: s.seriesId, label: s.label, points: sortByX(s.points, xKind, all) }));
    return { model, nav, lookup, describe };
  }, [series, resolved, indexResults, baseX, focusId, selected]);
}
