# Evaluation

_2026-10-24. Commands and files only. No accuracy percent._

## A. NOAA CO₂ monthly CSV (local parser)

This is spreadsheet import, not model extraction. CSV bytes are never sent to Gemini.

| Item | Observed |
| --- | --- |
| Input | `evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv` |
| Server | `npx next start -p 3108` (Node 24.13.0, production build) |
| Skip | 40 leading `#` records (suggested, then applied) |
| Shape | 629 rows × 8 columns |
| First row | `1974, 5, 1974.3750, 333.19, …` |
| Source locator | Record 1 = physical line 42 |
| Default chart | Line of `average` vs `decimal date`; Y fitted ~322–438; not include-zero |
| Correction | `333.19` → `333.20` previewed and saved as v2, then undone to v1 |
| Export CSV sha256 | `44138e6ce91a4af1fbef295815f4914334e85bb9b5d050ff06faaab197b9be35` (28 527 bytes) |
| Evidence | `evaluation/results/core-finish/notes.json` (0 fail) |

Reproducible:

```bash
nvm use
npm run build
npx next start -p 3108
BASE_URL=http://localhost:3108 node evaluation/results/core-finish/drive.mjs
```

## B. NOAA Mauna Loa chart (Gemini) — UNSPIN T1 arm

Run 2026-10-24. Coordinator completed the UNSPIN arm after the dedicated eval pass died on a provider connection error. The key was opened only after export.

| Item | Observed |
| --- | --- |
| Input | `evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png` sha256 `1f3bf74036f52d1b77068eb1a8fb143410297fb3a5848e3961a3b0247212d5af` |
| Crop | 48,78,688,468 px on 800×600 (normalized 0.06, 0.13, 0.86, 0.78) |
| Model | `gemini-3.8-flash`, one attempt, consent given |
| Time | 165.9 s to first candidate; no cell corrections |
| Table | 68 × 3, method `vision_estimate`, coverage `uncertain` (acknowledged) |
| First row | `2021-01`, `415.5`, `415.3` (estimates) |
| Missing vs key | `2026-09` both series (2 of 138) |
| matched | 136 |
| extra | 0 |
| abs_error | median 0.135 ppm, p90 1.18 ppm, max 2.37 ppm |
| within 0.2 ppm (1% of 20 ppm axis) | **73 / 136** matched rows |
| Evidence | `evaluation/results/T1_NOAA.md`, `evaluation/results/2026-10-24-builder-t1-unspin.csv`, `evaluation/results/T1/score.json` |

This is not a general accuracy claim. General-AI and WebPlotDigitizer arms were not run.

Reproducible:

```bash
nvm use
npx next start -p 3107
BASE_URL=http://localhost:3107 node evaluation/scripts/run-t1-unspin.mjs
node evaluation/scripts/score-noaa-t1.mjs   # only after export
```

## C. EIA STEO XLSX

Not re-run in the core-finish browser pass. An earlier production HTTP check on this repo reported sheet `2tab`, range `A6:E6` → `WTIPUUS` / `83.22` / `91.64` / `108.5`, formulas not executed. Treat that as historical until it is repeated on this revision.

## D. Durable restart (not an accuracy score)

2026-10-24. Dedicated production server `:3110` + worker, local database `unspin_core_finish`, filesystem blobs. `.env.local` was not modified.

| Item | Observed |
| --- | --- |
| Health after restart | persistence postgres durable true; blob filesystem; jobs worker |
| Source bytes | sha256 `a653f1af074f08f25f7b51e97d4b93b2e5485269a10a11df167e73e5cd7e6fad` before and after |
| After reopen | current version held edited `333.20`; skip 40 still stored |
| After undo + export CSV | sha256 `44138e6ce91a4af1fbef295815f4914334e85bb9b5d050ff06faaab197b9be35` |
| Evidence | `evaluation/results/durable/REPORT.md` |

Everyday `:3000` later used a separate database `unspin_dev` (not this evaluation DB). Health: durable true. Restart/reopen: `evaluation/results/dev-durable/REPORT.md`.
