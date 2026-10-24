# T1 NOAA Mauna Loa chart — UNSPIN arm

One consented Gemini extraction of `evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png` on 2026-10-24. Production `next start :3107`, model `gemini-3.8-flash`, one attempt. Crop: 48,78,688,468 px (plot area of the 800×600 PNG). The reference key was not opened until after export.

## What was measured

| Item | Value |
| --- | --- |
| Table | 68 rows × 3 columns (`Date`, `Monthly mean`, `Deseasonalized`) |
| Long observations | 136 (two series) |
| Expected key rows | 138 (69 months × 2 series, 2021-01..2026-09) |
| Extraction | 165.9 s to first candidate (also end-to-end; no cell corrections) |
| Coverage | `uncertain`, acknowledged before export |
| Origins | all `estimated` |

## Scores vs the NOAA monthly file (same vintage)

Match by `(YYYY-MM, series)`. Tolerance declared before scoring: **normalized error ≤ 0.01 of the 20 ppm axis (0.2 ppm)**.

| Metric | Value |
| --- | --- |
| matched | 136 |
| missing | 2 (`2026-09` monthly mean and deseasonalized) |
| extra | 0 |
| wrong_series | 16 (see caveat) |
| abs_error median | 0.135 ppm |
| abs_error p90 | 1.18 ppm |
| abs_error max | 2.37 ppm (`2025-07` average: extracted 425.5, key 427.87) |
| within 0.2 ppm | 73 / 136 matched |
| within 0.5 ppm | 93 / 136 |
| within 1.0 ppm | 116 / 136 |

`wrong_series` counts months where the extracted number is closer to the *other* official series than to its labelled series by more than 0.2 ppm. The two columns were not swapped as a whole; many of those months the red and black series are close on the chart.

Largest misses are on the red (monthly mean) seasonal peaks/troughs in 2025–2026, where a 1–2 ppm error is several millimetres on this figure.

## What this can and cannot support

This is **one image, one crop, one model call, one operator**. It shows that UNSPIN returned a labelled two-series table of estimates in under three minutes, that most points are within about 1 ppm of the publisher file, and that a 0.2 ppm chart-resolution tolerance is **not** met for about half the points. It does not establish Gemini accuracy in general, UNSPIN superiority over other digitizers, or fitness for scientific analysis. Values remain estimates. The general-AI and WebPlotDigitizer arms were not run.

Raw pair errors: `evaluation/results/T1/score.json`. Run log: `evaluation/results/T1/run.json`.
