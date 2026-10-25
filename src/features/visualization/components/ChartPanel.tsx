"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BaselinePolicy, ChartKind, ChartPoint, Column, SavedView } from "@/contracts";
import { api } from "@/lib/api/client";
import {
  Badge,
  Button,
  Disclosure,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  NumericInput,
  SegmentedControl,
  Select,
  UnavailableNote,
} from "@/components/ui";
import type { ChartPanelProps } from "@/features/workspace/seams";
import { buildPlotModel, type FigureSeries } from "../lib/figure";
import {
  MAX_SERIES,
  axisTitle,
  caption,
  checkLogDomain,
  computeYRange,
  describePoint,
  exclusionSummary,
  highlightedPointIds,
  initialChoice,
  safeDecimal,
  selectionEventFor,
  seriesStyle,
  sortByX,
  xAxisNote,
  yAxisTitle,
  type YScale,
} from "../lib/presentation";
import { readChartSettings, writeChartSettings } from "../lib/chart-settings";
import { useChartQuery } from "../lib/use-chart-query";
import { hasNumericPlotPoint } from "../lib/axis-layout";
import { ChartDataTable } from "./ChartDataTable";
import { RechartsChart } from "./RechartsChart";
import { PointNavigator } from "./PointNavigator";

type BaselineMode = BaselinePolicy["mode"];

interface Choice {
  datasetId: string;
  xColumnId: string | null;
  yColumnIds: string[];
  hidden: string[];
}

const SYMBOL_GLYPH: Record<string, string> = { circle: "●", square: "■", diamond: "◆", "triangle-up": "▲", "triangle-down": "▼", star: "★" };

const PARSE_HINT =
  "If a column holds numbers stored as text (for example “1,200” or “12%”), use Parse numbers in Review to convert it.";

function seriesLabel(c: Column | undefined, fallback: string) {
  return c?.seriesLabel || c?.label || fallback;
}

function defaultKind(x: Column | undefined): ChartKind {
  return x && (x.dataType === "decimal" || x.dataType === "date" || x.dataType === "datetime") ? "line" : "bar";
}

export function ChartPanel({ detail, linked, onLinkedSelect, onAskSelection, onShowInData, onShowSource, visible = true }: ChartPanelProps) {
  const { dataset, version } = detail;
  const columns = version.columns;
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedView, setSelectedView] = useState<{ datasetId: string; id: string } | null>(null);
  const [viewsError, setViewsError] = useState(false);
  const savedViewId = selectedView?.datasetId === dataset.id ? selectedView.id : "";
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    api.listViews(dataset.id).then((views) => {
      if (!cancelled) { setSavedViews(views); setViewsError(false); }
    }, () => { if (!cancelled) setViewsError(true); });
    return () => { cancelled = true; };
  }, [dataset.id, visible]);
  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);

  // Column choices survive version changes while their ids exist; a different dataset starts fresh.
  const [rawChoice, setRawChoice] = useState<Choice | null>(null);
  const choice = useMemo<Choice>(() => {
    if (rawChoice && rawChoice.datasetId === dataset.id) {
      const x = rawChoice.xColumnId && byId.has(rawChoice.xColumnId) ? rawChoice.xColumnId : initialChoice(columns).xColumnId;
      return { ...rawChoice, xColumnId: x, yColumnIds: rawChoice.yColumnIds.filter((id) => byId.has(id) && id !== x) };
    }
    const init = initialChoice(columns);
    return { datasetId: dataset.id, xColumnId: init.xColumnId, yColumnIds: init.yColumnIds, hidden: [] };
  }, [rawChoice, dataset.id, byId, columns]);
  const update = (patch: Partial<Choice>) => setRawChoice({ ...choice, ...patch });

  const [kindChoice, setKindChoice] = useState<ChartKind | null>(null);
  const [scale, setScale] = useState<YScale>("linear");
  const [baselineChoice, setBaselineChoice] = useState<BaselineMode | null>(null);
  const [bounds, setBounds] = useState({ min: "", max: "" });
  const [showTable, setShowTable] = useState(false);
  const [focusPointId, setFocusPointId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);

  useEffect(() => {
    setSettingsReady(false);
    const stored = readChartSettings(dataset.id, columns) ?? (dataset.defaultChart ? {
      ...dataset.defaultChart, hidden: [], scale: "linear" as const,
      baseline: dataset.defaultChart.kind === "bar" ? "include_zero" as const : "fit_data" as const,
      bounds: { min: "", max: "" },
    } : null);
    if (stored) {
      setRawChoice({ datasetId: dataset.id, xColumnId: stored.xColumnId, yColumnIds: stored.yColumnIds, hidden: stored.hidden });
      setKindChoice(stored.kind);
      setScale(stored.scale);
      setBaselineChoice(stored.baseline);
      setBounds(stored.bounds);
    } else {
      setRawChoice(null);
      setKindChoice(null);
      setScale("linear");
      setBaselineChoice(null);
      setBounds({ min: "", max: "" });
    }
    setSettingsReady(true);
    // Restore once per dataset. Version changes keep the same ids; overwriting from
    // storage on every columns identity change would reset in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.id]);

  useEffect(() => {
    if (!settingsReady) return;
    writeChartSettings(dataset.id, {
      xColumnId: choice.xColumnId,
      yColumnIds: choice.yColumnIds,
      hidden: choice.hidden,
      kind: kindChoice,
      scale,
      baseline: baselineChoice,
      bounds,
    });
  }, [settingsReady, dataset.id, choice, kindChoice, scale, baselineChoice, bounds]);

  const xColumn = choice.xColumnId ? byId.get(choice.xColumnId) : undefined;
  const kind = kindChoice ?? defaultKind(xColumn);
  const baseline: BaselineMode = baselineChoice ?? (kind === "bar" ? "include_zero" : "fit_data");
  const timeNote = xAxisNote(xColumn, columns);

  const query = useChartQuery(dataset.id, version.id, choice.xColumnId, choice.yColumnIds, savedViewId || undefined);
  const result = query.result;

  const seriesList = useMemo(
    () =>
      choice.yColumnIds.map((id, i) => ({
        seriesId: `series-${id}`,
        yColumnId: id,
        label: seriesLabel(byId.get(id), id),
        visible: !choice.hidden.includes(id),
        ...seriesStyle(i),
      })),
    [choice.yColumnIds, choice.hidden, byId],
  );
  const visibleSeries = useMemo(() => seriesList.filter((s) => s.visible), [seriesList]);

  const describe = useCallback(
    (p: ChartPoint) => describePoint(p, seriesLabel(byId.get(p.yColumnId), p.yColumnId), xColumn, byId.get(p.yColumnId)),
    [byId, xColumn],
  );

  const figureSeries = useMemo<FigureSeries[]>(() => {
    if (!result) return [];
    return visibleSeries.map((s) => ({ ...s, points: result.points.filter((p) => p.yColumnId === s.yColumnId) }));
  }, [result, visibleSeries]);
  const plottedPoints = useMemo(() => figureSeries.flatMap((s) => s.points), [figureSeries]);
  const plottedYs = useMemo(() => plottedPoints.map((p) => p.y), [plottedPoints]);

  const highlighted = useMemo(
    () => (result ? highlightedPointIds(result.points, linked, result.versionId) : new Set<string>()),
    [result, linked],
  );

  const logCheck = useMemo(() => checkLogDomain(plottedYs), [plottedYs]);
  const effectiveScale: YScale = scale === "log" && logCheck.ok ? "log" : "linear";
  const yRange = useMemo(
    () => computeYRange(baseline, plottedYs, effectiveScale, baseline === "explicit_bounds" ? bounds : null),
    [baseline, plottedYs, effectiveScale, bounds],
  );

  const drawnYIds = new Set(plottedPoints.filter((point) => point.y !== null && safeDecimal(point.y) !== null).map((point) => point.yColumnId));
  const yCols = visibleSeries.filter((series) => drawnYIds.has(series.yColumnId)).map((s) => byId.get(s.yColumnId)).filter((c): c is Column => !!c);
  const yTitleInfo = yCols.length ? yAxisTitle(yCols) : { title: "Value", mixedUnits: false };
  const yTitle = yRange.label ? `${yTitleInfo.title} — ${yRange.label}` : yTitleInfo.title;
  const xTitle = xColumn ? axisTitle(xColumn) : "x";
  const model = useMemo(
    () =>
      result
        ? buildPlotModel({
            kind,
            xKind: result.xKind,
            series: figureSeries,
            allPoints: result.points,
            highlighted,
            focusPointId,
            describe,
            xTitle,
            yTitle,
            yScale: effectiveScale,
            yRange: yRange.range,
            clipToBounds: baseline === "explicit_bounds" && !yRange.error,
          })
        : null,
    [result, kind, figureSeries, highlighted, focusPointId, describe, xTitle, yTitle, effectiveScale, yRange.range, yRange.error, baseline],
  );

  const navSeries = useMemo(
    () => (result ? figureSeries.map((s) => ({ seriesId: s.seriesId, label: s.label, points: sortByX(s.points, result.xKind, result.points) })) : []),
    [figureSeries, result],
  );

  const emit = (points: ChartPoint[]) => {
    if (!result) return;
    onLinkedSelect(selectionEventFor(points, result.versionId));
  };
  const pointById = useMemo(() => new Map((result?.points ?? []).map((p) => [p.pointId, p])), [result]);
  const pick = (ids: string[]) => emit(ids.flatMap((id) => pointById.get(id) ?? []));

  // ------------------------------------------------------------------ render

  if (columns.length === 0) {
    return <EmptyState title="Nothing to chart">This dataset has no columns.</EmptyState>;
  }

  const candidates = columns.filter((c) => c.id !== choice.xColumnId && !choice.yColumnIds.includes(c.id));
  const hasDecimal = columns.some((c) => c.dataType === "decimal");
  const summary = result ? exclusionSummary(result) : [];
  const originsPresent = new Set(plottedPoints.filter((p) => p.y !== null).map((p) => p.yOrigin));
  const hasGaps = plottedPoints.some((p) => p.y === null);
  const hasZeroBars = kind === "bar" && plottedPoints.some((p) => p.y !== null && safeDecimal(p.y)?.isZero());
  const selectedCount = highlighted.size;
  const selectedOne = selectedCount === 1 ? pointById.get([...highlighted][0]) : undefined;
  const hovered = hoverId ? pointById.get(hoverId) : undefined;

  const startBounds = () => {
    const ds = plottedYs.flatMap((y) => (y === null ? [] : (safeDecimal(y) ?? [])));
    if (ds.length && !bounds.min && !bounds.max) {
      const lo = ds.reduce((a, b) => (b.lt(a) ? b : a));
      const hi = ds.reduce((a, b) => (b.gt(a) ? b : a));
      setBounds({ min: lo.toString(), max: hi.toString() });
    }
    setBaselineChoice("explicit_bounds");
  };

  const selectionEvent = result && linked && linked.datasetVersionId === result.versionId && linked.rowIds.length > 0 ? linked : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Saved view" className="w-full sm:w-64">
          {(id) => <Select id={id} value={savedViewId} onChange={(e) => {
            const id = e.target.value;
            setSelectedView({ datasetId: dataset.id, id });
            const view = savedViews.find((v) => v.id === id && v.datasetId === dataset.id);
            const selectedColumns = view?.spec.columnIds ? columns.filter((c) => view.spec.columnIds!.includes(c.id)) : columns;
            const next = initialChoice(selectedColumns);
            const available = new Set(selectedColumns.map((c) => c.id));
            const retainedY = choice.yColumnIds.filter((columnId) => available.has(columnId));
            update(choice.xColumnId && available.has(choice.xColumnId) && retainedY.length
              ? { xColumnId: choice.xColumnId, yColumnIds: retainedY, hidden: choice.hidden.filter((columnId) => available.has(columnId)) }
              : { xColumnId: next.xColumnId, yColumnIds: next.yColumnIds, hidden: [] });
          }}>
            <option value="">All data</option>
            {savedViews.filter((v) => v.datasetId === dataset.id).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>}
        </Field>
        <p className="text-[13px] text-ink-muted" role="status">
          {viewsError ? "Saved views could not be loaded. Reopen Overview to retry." : savedViewId ? "Chart uses this saved view’s row filters. Points remain ordered by the X axis." : "Choose a view saved in Data, or chart all data."}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-muted">Chart type</span>
          <SegmentedControl<ChartKind>
            label="Chart type"
            value={kind}
            onChange={setKindChoice}
            options={[
              { value: "bar", label: "Bar" },
              { value: "line", label: "Line" },
              { value: "scatter", label: "Scatter" },
            ]}
          />
        </div>
        <Field label="X axis" className="w-full min-w-48 sm:w-64">
          {(id) => (
            <Select id={id} value={choice.xColumnId ?? ""} onChange={(e) => update({ xColumnId: e.target.value, yColumnIds: choice.yColumnIds.filter((y) => y !== e.target.value) })}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.dataType})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-muted">Y scale</span>
          <SegmentedControl<YScale>
            label="Y scale"
            value={scale}
            onChange={setScale}
            options={[
              { value: "linear", label: "Linear" },
              { value: "log", label: "Log" },
            ]}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[12px] font-medium text-ink-muted">Series (y)</legend>
        <ul className="flex flex-wrap gap-2">
          {seriesList.map((s) => (
            <li key={s.seriesId} className="flex items-center gap-1 rounded-md border border-rule bg-surface py-0.5 pr-0.5 pl-2 text-[13px]">
              <span aria-hidden="true" style={{ color: s.color }}>
                {SYMBOL_GLYPH[s.symbol] ?? "●"}
              </span>
              <span className={s.visible ? "text-ink" : "text-ink-faint line-through"}>{s.label}</span>
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[12px]" aria-label={`${s.visible ? "Hide" : "Show"} series ${s.label}`} onClick={() => update({ hidden: s.visible ? [...choice.hidden, s.yColumnId] : choice.hidden.filter((h) => h !== s.yColumnId) })}>
                {s.visible ? "Hide" : "Show"}
              </Button>
              <IconButton label={`Remove series ${s.label}`} className="h-6 w-6" onClick={() => update({ yColumnIds: choice.yColumnIds.filter((y) => y !== s.yColumnId) })}>
                <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </IconButton>
            </li>
          ))}
          {choice.yColumnIds.length === 1 && (
            <li className="self-center text-[12px] text-ink-faint">One series to start. Add another if you need it.</li>
          )}
          {candidates.length > 0 && choice.yColumnIds.length < MAX_SERIES && (
            <li>
              <label className="sr-only" htmlFor="chart-add-series">
                Add a series
              </label>
              <Select
                id="chart-add-series"
                className="h-8 w-auto text-[13px]"
                value=""
                onChange={(e) => e.target.value && update({ yColumnIds: [...choice.yColumnIds, e.target.value] })}
              >
                <option value="">Add a series…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.dataType !== "decimal" ? ` (${c.dataType} — not numeric)` : ""}
                  </option>
                ))}
              </Select>
            </li>
          )}
        </ul>
      </fieldset>

      {scale === "log" && !logCheck.ok && (
        <p role="alert" className="text-[13px] text-danger">
          {logCheck.message}
        </p>
      )}
      <div className="h-[clamp(280px,52vh,540px)]">{renderBody()}</div>

      {result && result.points.length > 0 && visibleSeries.length > 0 && (
        <div className="flex flex-col gap-1.5 text-[12px] text-ink-muted">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Badge tone={dataset.extractionMethod === "vision_estimate" ? "estimate" : "neutral"}>{(dataset.extraction?.promptVersion === "text-data-v1" ? "Chart built from text · verify quoted values against the source" : caption(dataset.extractionMethod))}</Badge>
            <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Marker key">
              {kind === "bar" ? (
                <>
                  {originsPresent.has("estimated") && <li>Hatched bar (///): estimated from chart</li>}
                  {originsPresent.has("user_edit") && <li>Cross-hatched bar (xxx): edited by you</li>}
                  {hasZeroBars && <li>Bars labelled 0 are zero values</li>}
                </>
              ) : (
                <>
                  {originsPresent.has("estimated") && <li>Open marker (○): estimated from chart</li>}
                  {originsPresent.has("user_edit") && <li>Open marker with dot (⊙): edited by you</li>}
                  {visibleSeries.length > 1 && <li>Each series has its own marker shape and line dash</li>}
                </>
              )}
              {hasGaps && <li>Tick along the bottom (|): missing value, drawn as a gap</li>}
            </ul>
          </div>
          {yTitleInfo.mixedUnits && <p>These series use different units on one axis. Use Compare to check whether they belong together.</p>}
          {timeNote && <p>{timeNote}</p>}
          {summary.map((s) => (
            <p key={s} role="note">
              {s}
              {result.excluded.nonNumericY > 0 && s.includes("non-numeric") ? ` ${PARSE_HINT}` : ""}
            </p>
          ))}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          <div className="flex min-h-9 flex-wrap items-center gap-2 text-[13px] text-ink-muted">
            <span className="min-w-0 flex-1 basis-64">
              {hovered ? describe(hovered) : selectedOne ? `Selected: ${describe(selectedOne)}` : selectedCount > 1 ? `${selectedCount} points selected` : "Click or drag across points to select them."}
            </span>
            {selectionEvent && onShowInData && (
              <Button size="sm" onClick={() => onShowInData(selectionEvent)}>
                Show in data
              </Button>
            )}
            {selectionEvent && onShowSource && (
              <Button size="sm" onClick={() => onShowSource(selectionEvent)}>
                Show source
              </Button>
            )}
            {onAskSelection && (hovered || (linked && linked.rowIds.length > 0)) && (
              <Button
                size="sm"
                onClick={() => {
                  if (hovered) {
                    const event = selectionEventFor([hovered], result.versionId);
                    onLinkedSelect(event);
                    onAskSelection(event);
                    return;
                  }
                  if (linked) onAskSelection(linked);
                }}
              >
                Ask AI
              </Button>
            )}
            <Button size="sm" variant="ghost" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
              {showTable ? "Hide data table" : "Show data table"}
            </Button>
          </div>
          <PointNavigator series={navSeries} describe={describe} onFocusPoint={setFocusPointId} onSelect={(p) => emit([p])} />
          <Disclosure summary={baseline === "explicit_bounds" ? "Y axis range · set bounds" : baseline === "include_zero" ? "Y axis range · includes zero" : "Y axis range · fitted to data"} className="border-rule">
            {renderRangeControls()}
          </Disclosure>
          {showTable && (
            <ChartDataTable
              series={figureSeries.map((s) => ({ seriesId: s.seriesId, label: s.label, yColumn: byId.get(s.yColumnId), points: sortByX(s.points, result.xKind, result.points) }))}
              xColumn={xColumn}
              highlighted={highlighted}
              onSelect={(p) => emit([p])}
            />
          )}
          {result.sampling && <UnavailableNote>The table lists the sampled points only; exports contain every row.</UnavailableNote>}
        </div>
      )}
    </div>
  );

  function renderRangeControls() {
    return (
      <div className="flex flex-col gap-2 py-1">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-muted">Y axis range</span>
            <SegmentedControl<BaselineMode>
              label="Y axis range"
              value={baseline}
              onChange={(v) => (v === "explicit_bounds" ? startBounds() : setBaselineChoice(v))}
              options={[
                { value: "include_zero", label: "Include zero" },
                { value: "fit_data", label: "Fit data" },
                { value: "explicit_bounds", label: "Set bounds" },
              ]}
            />
          </div>
          {baseline === "explicit_bounds" && (
            <>
              <Field label="Minimum" className="w-28">
                {(id) => <NumericInput id={id} value={bounds.min} onChange={(e) => setBounds({ ...bounds, min: e.target.value })} aria-invalid={!!yRange.error} />}
              </Field>
              <Field label="Maximum" className="w-28">
                {(id) => <NumericInput id={id} value={bounds.max} onChange={(e) => setBounds({ ...bounds, max: e.target.value })} aria-invalid={!!yRange.error} />}
              </Field>
            </>
          )}
        </div>
        <p className="text-[12px] leading-4 text-ink-faint">
          A zero baseline matters for bars, whose length shows magnitude. For line and log charts a fitted range is often appropriate; changing the range never changes the values.
        </p>
        {yRange.error && (
          <p role="alert" className="text-[13px] text-danger">
            {yRange.error} The chart fits the data until the bounds are valid.
          </p>
        )}
        {yRange.notes.map((n) => (
          <p key={n} className="text-[13px] text-ink-muted">
            {n}
          </p>
        ))}
      </div>
    );
  }

  function renderBody() {
    if (choice.yColumnIds.length === 0) {
      return (
        <EmptyState title={hasDecimal ? "Choose a column to plot" : "No numeric column to plot yet"}>
          {hasDecimal
            ? "Add a series above. Identifiers, dates, and uncertainty columns are left off until you add them."
            : PARSE_HINT}
        </EmptyState>
      );
    }
    if (query.error) {
      return (
        <ErrorState
          title="Could not load chart data"
          message={query.error.message}
          code={query.error.code}
          requestId={query.error.requestId ?? undefined}
          action={
            <Button size="sm" onClick={query.retry}>
              Retry
            </Button>
          }
        />
      );
    }
    if (!result) {
      return (
        <p role="status" className="py-10 text-center text-[13px] text-ink-muted">
          Loading chart data…
        </p>
      );
    }
    if (result.points.length === 0) {
      return (
        <EmptyState title="Nothing to plot">
          <p>{summary.join(" ") || "The chosen columns have no values."}</p>
          {result.excluded.nonNumericY > 0 && <p className="mt-1">{PARSE_HINT}</p>}
        </EmptyState>
      );
    }
    if (visibleSeries.length === 0) {
      return <EmptyState title="All series are hidden">Use Show on a series above to draw it.</EmptyState>;
    }
    if (model && !hasNumericPlotPoint(model.series.flatMap((series) => series.plotPoints))) {
      return <EmptyState title="No numeric values to plot">
        <p>The visible series have no readable numeric values in this view.</p>
        <p className="mt-1">{PARSE_HINT} You can also show a numeric series or choose another saved view. Missing values stay missing.</p>
      </EmptyState>;
    }

    return (
      <figure className="flex h-full min-h-0 flex-col gap-1">
        <figcaption className="sr-only">{(dataset.extraction?.promptVersion === "text-data-v1" ? "Chart built from text · verify quoted values against the source" : caption(dataset.extractionMethod))}</figcaption>
        {model && !visible && <div aria-hidden="true" className="min-h-0 w-full flex-1" />}
        {model && visible && (
          <RechartsChart
            exportTitle={dataset.title}
            exportBlocked={dataset.coverage !== "complete_selection" && !dataset.coverageAcknowledgedAt}
            exportNote={`${savedViewId ? `Saved view: ${savedViews.find((v) => v.id === savedViewId)?.name ?? savedViewId}. ` : ""}${scale === "log" ? "Logarithmic Y scale. " : ""}Version ${version.id} · ${dataset.extraction?.promptVersion === "text-data-v1" ? "Chart built from text; verify quoted values against the source." : caption(dataset.extractionMethod)} ${dataset.coverage !== "complete_selection" ? `Partial/uncertain coverage: ${dataset.coverageNote ?? dataset.coverage}.` : ""} ${exclusionSummary(result).join(" ")} Estimated values use open markers or hatching; edits use dotted markers or cross-hatching. Missing values remain gaps.`}
            className="min-h-0 w-full flex-1"
            model={model}
            label={`${kind} chart of ${visibleSeries.map((s) => s.label).join(", ")} against ${xTitle}. Use the point navigator or the data table below for exact values.`}
            onPointClick={(id) => pick([id])}
            onPointsSelected={pick}
            onDeselect={() => emit([])}
            onHover={setHoverId}
          />
        )}
      </figure>
    );
  }
}
