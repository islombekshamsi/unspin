# What UNSPIN has so far

_24 October 2026. This is what is in the app today, not a roadmap._

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
- **Chart:** bar, line, or scatter. Estimates and your edits use distinct markers, not colour alone. Missing values are gaps. Log scale is refused when any plotted value is zero or negative.
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
- **NOAA CO₂ monthly CSV:** 40 comment lines skipped, 629 rows × 8 columns, first row `1974, 5, 1974.3750, 333.19, …`, source line 42. Export wrote CSV, JSON, and a manifest.
- **EIA STEO workbook:** sheet `2tab`, range `A6:E6` → `WTIPUUS` / `83.22` / `91.64` / `108.5`. Same three export files.
- **NOAA Mauna Loa CO₂ chart (Gemini):** 69 rows × 3 columns, marked `vision_estimate`, 98 seconds. First row `2021-01`, `415.5`, `415.2`. Accuracy against NOAA’s published series was **not** measured (their 2021-01 averages are 415.49 and 415.23). That dataset was not exported.

Automated tests: 556 passed. Typecheck, lint, and production build pass.

## What is not ready

- **Work is session-only** unless you set `DATABASE_URL` and run migrations. Without that, a restart wipes uploads and datasets. Share links stay off in that mode so they cannot silently die.
- **No accounts.** A guest cookie is created when you upload. There is no sign-in.
- **Not for a public URL.** There is no per-user extraction quota and no bot protection. Anyone who can reach the server can trigger Gemini.
- **Browser walkthrough of the full UI** after all pieces were merged has not been done yet. Individual panels were checked while they were built.
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
