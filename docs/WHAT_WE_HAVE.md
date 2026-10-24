# What UNSPIN has so far

_24 October 2026, after the core-finish production pass. This is what is in the app today, not a roadmap._

UNSPIN is a local web app. You upload a chart image, PDF page, CSV, or Excel file and get a dataset you can inspect next to the source, clean with reversible steps, chart, and export. Missing values stay missing. Estimated values stay marked as estimates. Nothing is presented as verified just because it is valid JSON.

Run it with Node 24 (`nvm use`) and `npm run dev`. Open http://localhost:3000. Restart that server under Node 24 if it was started earlier, or PDF support and the Gemini setting will not load.

## What you can do

**1. Upload a file.** PNG, JPEG, WebP, PDF, UTF-8 CSV, and XLSX. The type is decided from the contents, not the filename. Legacy `.xls`, macro-enabled `.xlsm`, password-protected files, archives, and executables are refused with a reason. Limits: 10 MiB, 20,000 structured rows, 64 columns, 200 PDF pages, 40 megapixels.

**2. Choose what to use.**
- Image: crop one region, optional short hint (300 characters).
- PDF: pick a page and optionally a region. Thumbnails render in the browser.
- CSV: delimiter, whether the first record is a header, which columns and records to import. Leading `#` comment lines (as in NOAA files) can be skipped; that skip is chosen, never applied silently. Line numbers in source references stay physical.
- XLSX: pick a sheet and a cell range. Saved formula results are marked as cached. Formulas are never run. Merged cells stay empty except for the cell that actually holds the value.

**3. Turn the selection into a dataset.**
- CSV and XLSX are parsed on this server. Nothing is sent to a model. Original text is kept.
- Images and PDFs: after you consent, **only the selected region** is sent to Google Gemini (`gemini-3.8-flash`). Values read from a chart are marked as estimates. Each value keeps a source reference. Progress shows the real job stage, not a fake percentage. A job has 180 seconds across at most two attempts.

**4. Work in the workspace.** Source, data table, and chart sit together. Selecting a point or cell highlights the matching source location when one exists. Model-proposed boxes are dashed and labelled unverified. The app never draws a box it does not have.

- **Grid:** keyboard navigation, pages of rows, missing values shown as a dashed token with a reason, estimates marked, edits marked. Save goes through a preview. Older versions are read-only.
- **Review:** quality findings cite what they observed. Preview a suggested fix, then apply it. There is no “fix all.”
- **Cleaning:** explicit operations only (edit a cell, parse numbers with chosen separators, mark missing, convert units with exact factors, remove selected rows or exact duplicates, and similar). Preview always matches apply. Missing values are never turned into zero.
- **Chart:** bar, line, or scatter (Recharts). The default is **one** Y series. Identifiers, date parts, and uncertainty columns stay off until you add them. NOAA monthly CO₂ opens as `average` vs the file’s `decimal date`, with a fitted Y range (not include-zero). Estimates and your edits use distinct markers, not colour alone. Missing values are gaps. Log scale is refused when any plotted value is zero or negative. Axis choices are remembered in this browser for that dataset id.
- **Compare:** you say what each series measures. Mixed currencies, mixed percent forms, and price versus total return are refused with an explanation.
- **History:** every committed change. Undo, view an older version, or make an older version current again.

**5. Export.** CSV (spreadsheet-safe), JSON with exact values, and a provenance manifest. Partial extractions require an explicit acknowledgement first.

## Where AI is used

Only chart and PDF extraction, and only after consent.

| Input | What happens |
| --- | --- |
| CSV, XLSX | Parsed here. Never sent to a model. |
| Image or PDF region | Sent to Gemini after you confirm. Results are estimates. |

There is no chat assistant and no automatic “clean this for me.” Sign-in and spoken narration are not wired.

If the Gemini key is on an unpaid tier, Google’s terms allow submitted content to be used to improve its products and to be reviewed by people. Send only material you are allowed to share.

## What has been run for real

These used the production server and published US-government files, not invented data.

- **HTTP smoke:** 30 checks passed, including a real NOAA CSV upload, rejected `.xls` files, and per-browser isolation.
- **NOAA CO₂ monthly CSV (browser, production `:3108`, 2026-10-24):** 40 comment lines skipped, 629 rows × 8 columns, first row `1974, 5, 1974.3750, 333.19, …`, source line 42. Default chart: line of `average` vs `decimal date`. Correct `333.19` → `333.20`, undo, export. Refresh restored the skipped-comment selection. Export CSV sha256 `44138e6ce91a4af1fbef295815f4914334e85bb9b5d050ff06faaab197b9be35`. Notes in `evaluation/results/core-finish/`.
- **EIA STEO workbook:** sheet `2tab`, range `A6:E6` → `WTIPUUS` / `83.22` / `91.64` / `108.5`. Same three export files. Not re-run in the core-finish browser pass.
- **NOAA Mauna Loa CO₂ chart (Gemini, T1 UNSPIN arm, 2026-10-24):** crop 48×78+688×468 px, `gemini-3.8-flash`, 165.9 s, 68 × 3 estimated rows, first row `2021-01` / `415.5` / `415.3`. Scored after export: 136 matched, 2 missing (`2026-09`), median abs error 0.135 ppm, **73 / 136** within 0.2 ppm. One chart only (`docs/EVALUATION.md`).

Automated tests on this revision: **567 passed**, 13 skipped. Typecheck and production build pass.

## What is not ready

- **Work is session-only** unless you set `DATABASE_URL` and run migrations. Without that, a restart wipes uploads and datasets. Share links stay off in that mode so they cannot silently die.
- **No accounts.** A guest cookie is created when you upload. There is no sign-in.
- **Not for a public URL.** There is no per-user extraction quota and no bot protection. Anyone who can reach the server can trigger Gemini.
- **Durable restart** has not been tested: local Postgres was not listening on this pass.
- **Chart extraction** on this NOAA figure is an estimate with 73/136 points inside 0.2 ppm of the publisher file. That is not a general accuracy rating.
- **S3 storage** has not been tried against a real bucket. Nothing has been deployed.
- Chart extraction can take about a minute and sometimes hits a provider 503.

## How to try it

```bash
nvm use          # Node 24
npm run dev      # http://localhost:3000
```

For work that survives a restart:

```bash
# in .env.local: DATABASE_URL, UNSPIN_STORAGE_MODE=filesystem, UNSPIN_JOBS_MODE=worker
npm run db:migrate
npm run dev      # terminal 1
npm run worker   # terminal 2
```

Setup details are in `README.md`. Engineering checkpoints are in `docs/STATUS.md`.
