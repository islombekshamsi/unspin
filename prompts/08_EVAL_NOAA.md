# Specialist: NOAA extraction measurement (T1)

You own `evaluation/scripts/**`, `evaluation/results/T1*`, `evaluation/results/2026-10-24-builder-t1-unspin.csv`. Do not edit `src/**`, `docs/TEST_REPORT.md`, or `evaluation/results/walkthrough*`.

## Goal

Measure the **UNSPIN arm of T1** from `evaluation/PROTOCOL.md` against the author-provided key:

`evaluation/reference/noaa-co2-trend-mlo-2021-01_2026-09.reference.csv`

Manifest: `noaa-co2-trend-mlo-2026-10` in `evaluation/sources.json`.
Input: `evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png`.

## Rules (protocol)

- Same crop for the whole run. Record the pixel box.
- Do **not** open the reference file until timing has stopped and the CSV is exported as “verified.”
- Verify against the **source image**, then export. Timing includes human correction.
- Columns for the scored CSV: `x` (YYYY-MM), `series`, `y`. One row per plotted observation.
- Operator alias: `builder`. Familiarity: `expert`. Arm: `unspin`.
- Do not run the general-AI or WebPlotDigitizer arms unless they complete in this session; mark them **not run**.

## What to measure (every observation, not the first row)

Match exported rows to the key by `(x, series)`.

- Correct months and series assignment (monthly mean vs deseasonalized).
- Missing and extra observations.
- Numerical differences vs the key, allowing for chart-visible precision. Declared tolerance: `normalized_error ≤ 0.01` of the 20 ppm axis span (412.5–432.5).
- Time to first candidate, time to reviewed export, correction count and seconds.

Fill `evaluation/results/TEMPLATE.csv` into `evaluation/results/2026-10-24-builder-t1-unspin.csv`. Write a short `evaluation/results/T1_NOAA.md` that states what the numbers can and cannot support. No accuracy claim beyond this one chart.

## How to run it

Your server: `npx next dev -p 3107` (Node 24 PATH). Gemini is configured in the user's `.env.local` — confirm key **presence** only; never print the value.

A prior HTTP extraction (69×3, first row `2021-01` / `415.5` / `415.2`, 98 s) is **not** a scored run: it was not reviewed against the image or exported. You may use the API plus the UI; the scored artifact is the **reviewed export**.

Write a small scorer under `evaluation/scripts/` that reads the exported CSV and the key and prints the protocol metrics. Do not put source pixels or secrets in the repo.

## Report

Changed paths; extraction seconds; end-to-end seconds; matched/missing/extra/wrong_series; abs_error median/p90/max; within_tolerance share; whether you looked at the key before export (must be no).
