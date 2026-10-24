"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BaselinePolicy, ChartKind, ChartPoint, Column } from "@/contracts";
import {
  Badge,
  Button,
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

export function ChartPanel({ detail, linked, onLinkedSelect }: ChartPanelProps) {
  const { dataset, version } = detail;
  const columns = version.columns;
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
    const stored = readChartSettings(dataset.id, columns);
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

  const query = useChartQuery(dataset.id, version.id, choice.xColumnId, choice.yColumnIds);
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

  const yCols = visibleSeries.map((s) => byId.get(s.yColumnId)).filter((c): c is Column => !!c);
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
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
        <Field label="X axis" className="min-w-40 flex-1">
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

      {scale === "log" && !logCheck.ok && (
        <p role="alert" className="text-[13px] text-danger">
          {logCheck.message}
        </p>
      )}

      <fieldset className="flex flex-col gap-2">
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

      {renderBody()}
    </div>
  );

  function renderRangeControls() {
    return (
      <div className="flex flex-col gap-2 border-t border-rule pt-3">
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

    return (
      <figure className="flex min-h-0 flex-col gap-2">
        <figcaption className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
          <Badge className="whitespace-normal!" tone={dataset.extractionMethod === "deterministic_parser" ? "neutral" : "estimate"}>
            {caption(dataset.extractionMethod)}
          </Badge>
          {yTitleInfo.mixedUnits && <span>These series use different units on one axis. Use Compare to check whether they belong together.</span>}
          {timeNote && <span>{timeNote}</span>}
        </figcaption>
        {summary.map((s) => (
          <p key={s} className="text-[12px] text-ink-muted" role="note">
            {s}
            {result.excluded.nonNumericY > 0 && s.includes("non-numeric") ? ` ${PARSE_HINT}` : ""}
          </p>
        ))}

        {model && (
          <RechartsChart
            className="h-[min(420px,60vh)] min-h-[260px] w-full shrink-0"
            model={model}
            label={`${kind} chart of ${visibleSeries.map((s) => s.label).join(", ")} against ${xTitle}. Use the point navigator or the data table below for exact values.`}
            onPointClick={(id) => pick([id])}
            onPointsSelected={pick}
            onDeselect={() => emit([])}
            onHover={setHoverId}
          />
        )}

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-label="Marker key">
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

        <p className="min-h-4 text-[12px] text-ink-muted">
          {hovered ? describe(hovered) : selectedOne ? `Selected: ${describe(selectedOne)}` : selectedCount > 1 ? `${selectedCount} points selected` : "Click or drag across points to select them in the table and source."}
        </p>

        {renderRangeControls()}

        <PointNavigator series={navSeries} describe={describe} onFocusPoint={setFocusPointId} onSelect={(p) => emit([p])} />

        <div>
          <Button size="sm" variant="ghost" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Hide data table" : "Show data table"}
          </Button>
        </div>
        {showTable && (
          <ChartDataTable
            series={figureSeries.map((s) => ({ seriesId: s.seriesId, label: s.label, yColumn: byId.get(s.yColumnId), points: sortByX(s.points, result.xKind, result.points) }))}
            xColumn={xColumn}
            highlighted={highlighted}
            onSelect={(p) => emit([p])}
          />
        )}
        {result.sampling && <UnavailableNote>The table lists the sampled points only; exports contain every row.</UnavailableNote>}
      </figure>
    );
  }
}
