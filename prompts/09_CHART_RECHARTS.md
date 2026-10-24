# Specialist: Recharts chart polish

You own `src/features/visualization/**` and `src/features/comparison/**` only.

## Already on main (do not re-add)

- `recharts@3.10.1` and `react-is@19.3.0` (official Recharts install; shadcn Chart uses Recharts v3).
- `src/components/ui/chart.tsx`: `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`. Import the UI config type as `RechartsChartConfig` so it does not clash with `@/contracts` `ChartConfig`.
- CSS tokens `--chart-1` … `--chart-6` alias `--series-*`. Use `var(--chart-n)` or `var(--color-KEY)`, **not** `hsl(var(--chart-n))`.
- `ChartContainer` needs a height (`min-h-[200px]` or similar) so `ResponsiveContainer` can measure.

Docs: https://ui.shadcn.com/docs/components/chart and https://recharts.github.io/en-US/guide/installation/

## Goal

Replace Plotly with Recharts for **bar, line, and scatter only**. Do **not** add area or stacked until those three pass the checks below. Do not change `src/contracts/chart.ts` (`ChartKind` stays `bar | line | scatter`).

Keep `ChartPanel` seam props exactly (`src/features/workspace/seams.ts`).

## Must preserve

1. Clicking a point emits `SelectionEvent` with the correct `rowId` / cell / `provenanceIds` (`pointId` is `${rowId}:${yColumnId}`). Incoming grid/source selection highlights without echoing back.
2. After an edit (new version), the chart query refetches and plotted values update.
3. Missing y values are **gaps**, never zero. Non-numeric y stays excluded and disclosed.
4. Estimates vs user edits remain distinguishable **without colour alone** (open marker / hatched bar / extra mark). Each series still has its own shape or dash.
5. Axis controls (include zero / fit / explicit bounds, log refusal) change presentation only. Underlying values stay exact decimal strings from `buildChartQuery`.
6. Reconstructed caption stays. No Plotly Cloud share. Keyboard point navigator and data table stay.
7. Plotly must not load on the server. Remove the Plotly adapter once Recharts covers the panel. Leave `plotly.js-basic-dist-min` in package.json for the coordinator to drop after merge.

## Verification

Keep existing visualization/comparison unit tests green; update fixtures only if required.

On your server (`npx next dev -p 3104`, Node 24 PATH), use a **real** imported CSV (NOAA excerpt) or existing dataset — no invented product data. Confirm: point click → grid/source; edit a cell → chart updates; a missing cell is a gap; log scale refuses 0/negative.

Do not add area/stacked in this pass. Request those kinds after the report.

## Report

Changed paths; Plotly removal status; checks actually run; remaining visual risks; no contract/package edits.
