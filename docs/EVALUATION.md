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

## B. NOAA Mauna Loa chart (Gemini) — scoring not finished

A prior HTTP pass on this repository reported a consented crop producing 69 × 3 estimated rows in 98 seconds, first month `2021-01`, values `415.5` / `415.2`. NOAA’s published 2021-01 averages are 415.49 and 415.23. **One matching row is not an accuracy benchmark.**

On this core-finish revision:

- The T1 protocol in `evaluation/PROTOCOL.md` was not completed.
- No reviewed extraction export exists to score against `evaluation/reference/noaa-co2-trend-mlo-2021-01_2026-09.reference.csv`.
- No mean/median/max absolute error, and no counts within the predeclared 0.01 × 20 ppm tolerance, are reported.
- A title-only crop of the committed PNG reached the consent screen. **Start extraction** stayed disabled until consent. No dataset was created. The crop was not submitted to Gemini on this pass.

Do not invent aligned/matched/mismatched counts.

## C. EIA STEO XLSX

Not re-run in the core-finish browser pass. An earlier production HTTP check on this repo reported sheet `2tab`, range `A6:E6` → `WTIPUUS` / `83.22` / `91.64` / `108.5`, formulas not executed. Treat that as historical until it is repeated on this revision.
