# Comparison protocol: UNSPIN vs general AI workflow vs established digitizer

Status: **designed.** The UNSPIN arm of T1 was run and scored on 2026-10-24 (`evaluation/results/T1_NOAA.md`). General-AI and WebPlotDigitizer arms were not run. T2 was not run. Nothing else in this file is a result.

## Question

For a genuine, permitted chart/figure, how long does it take to produce a **correct, verified, exported CSV**, and what errors remain? Compare:

1. **UNSPIN**: upload, select region, extract, inspect against source, correct, export.
2. **General AI workflow**: Gemini app (or ChatGPT with data analysis) given the same crop and the standard prompt below, plus the operator's own verification and corrections in a spreadsheet.
3. **WebPlotDigitizer** (current hosted version, automeris.io): manual axis calibration plus manual or automatic point extraction, then export.

All three must end at the same deliverable: a CSV that the operator believes is correct after checking it against the source image.

## Tasks (from `evaluation/sources.json`)

| Task | Manifest id | Difficulty | Scored series | Reference |
| --- | --- | --- | --- | --- |
| T1 | `noaa-co2-trend-mlo-2026-10` | easy | monthly mean (red) and deseasonalized (black), 2021-01..2026-09, 69 months each | `reference/noaa-co2-trend-mlo-2021-01_2026-09.reference.csv` (author-provided) |
| T2 | `eia-steo-2026-10-pdf-p15-wti` | difficult | WTI spot and STEO forecast; NYMEX futures excluded (third-party) | `reference/eia-steo-2026-10-wtipuus-monthly.reference.csv` (author-provided, 2022-01..2027-12) |

Add tasks only through new manifest records. Include at least one difficult case for every easy case.

## Fairness controls

- **Same input bytes.** Every arm receives the same crop: the PNG for T1; for T2, PDF page 15 rendered at the same resolution and cropped to the WTI chart. Record crop pixel boxes.
- **Same required output.** Columns: `x` (YYYY-MM), `series`, `y` in source units. One row per plotted observation. Missing or unreadable points must be left blank and noted, not guessed.
- **Same verification standard.** The operator may compare against the source image in every arm, but **never** against the reference file before timing stops.
- **No unreviewed answers.** The end of a run is when the operator declares the CSV verified and exports it. Do not compare an unreviewed UNSPIN result with a reviewed baseline, or the reverse.
- **Counterbalanced order.** Each operator does each task in each arm once, in a Latin-square order, to limit learning effects. Record operator familiarity with each tool (none / some / expert).
- **Fixed AI settings.** Record the model name and version as displayed, date, temperature if exposed, number of retries, and whether code execution was used. One initial prompt; follow-up prompts are allowed but counted as correction actions.
- **Same machine/network** where possible; record browser and screen size.

### Standard prompt for the general AI arm

> The attached image is a chart from a published source. Extract every plotted data point as CSV with columns x,series,y. Use YYYY-MM for months. Use the axis units exactly as shown (no rescaling). Include one row per visible marker or monthly point. If a value cannot be read, leave y empty and add a note column explaining why. Do not interpolate or invent points. Report the axis ranges you calibrated against.

## Timing

Use a stopwatch or screen recording with timestamps.

- `t_start`: operator first sees the input in the tool.
- `t_first_candidate`: first complete candidate table available (extraction time).
- `t_verified_export`: verified CSV saved (end-to-end time). Human correction time is included; timing never stops before it.
- Log each correction action with start/end time and what was changed (`corrections_log` column, semicolon-separated).

## Scoring (after `t_verified_export`, by a second person if possible)

Match exported rows to reference rows by `(x, series)`. A value assigned to the wrong series is a series error, even if the number is right.

| Metric | Definition |
| --- | --- |
| `matched` | Exported rows whose `(x, series)` exists in the reference. |
| `missing` | Reference rows within the scored range with no exported row. |
| `extra` | Exported rows with no reference row (includes invented points and unreferenced months such as T2 2021). Unreferenced plotted months are reported separately as `unreferenced` and are not counted as errors. |
| `wrong_series` | Exported rows whose value matches another series' reference better than its own by more than the tolerance, or whose series label is wrong. |
| `abs_error` | \|exported y − reference y\| in original units (ppm; USD/bbl). Report median, 90th percentile, and max over matched rows. |
| `normalized_error` | `abs_error / (y_axis_max − y_axis_min)` of the displayed axis range: T1 = 20 ppm (412.5..432.5), T2 = 120 USD/bbl (0..120). This denominator is never zero. |
| `relative_error` | `abs_error / |reference y|` **only when \|reference y\| > 0**. When the reference is 0, relative error is undefined: report `abs_error` alone and count the row in `relative_error_undefined`. Never divide by zero or substitute a small epsilon. |
| `within_tolerance` | Share of matched rows with `normalized_error ≤ 0.01` (1 % of the axis span). The tolerance is declared before running and reported with the result. |
| `unit_errors`, `percent_errors`, `date_errors`, `scale_errors` | Count of rows/columns with wrong unit, percent representation, date/period alignment (e.g. off-by-one month), or axis-scale interpretation (e.g. log read as linear, thousands vs units). |
| `undisclosed_gaps` | Points the tool filled confidently when they were unreadable, versus `disclosed_gaps` which were left blank with a note. |
| `corrections_n`, `corrections_seconds` | Number and total duration of correction actions. |
| `extraction_seconds` | `t_first_candidate − t_start`. |
| `end_to_end_seconds` | `t_verified_export − t_start`. |

Report every run, including failures and abandoned runs (`outcome = abandoned` with a reason). Do not drop the slowest or worst run.

## What results can and cannot support

- Two tasks and a handful of operators can show whether UNSPIN is usable and where it fails. They cannot establish general accuracy, researcher adoption, or superiority.
- Do not transfer results from these charts to other chart types, scientific domains, or financial decisions.
- A model confidence number is not an error bound and is not recorded as accuracy.

## Recording

One row per (operator, task, arm) in `results/<date>-<operator-alias>.csv`, using `results/TEMPLATE.csv`. Use an alias, not a name. Record consent for any screen recording. Do not include personal data. Operators are the builder or consenting volunteers with genuine tasks; recruiting and observing users is phase 2 and must not involve messaging third parties without explicit authorization.
