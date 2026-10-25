# Core finish status

_Updated 2026-10-24 after everyday durable mode was enabled on `npm run dev :3000`._

| Gap | Owner | Dependency | Acceptance | Status |
| --- | --- | --- | --- | --- |
| Merge Phase 2 NOAA CSV walkthrough | Coordinator | `qa/phase2-walkthrough` (`e8ab289`) | Report on main | Done (`a005038`) |
| Adopt Recharts | Visualization | `agent/charts-recharts` (`186fea6`) | Bar/line/scatter without Plotly | Done (`8f66054`); no `plotly` imports remain in `src/` |
| Restore source selection after refresh | Coordinator | `GET /api/v1/selections/:id` | Refresh of `?source=&dataset=` shows the same CSV region | **Pass** on production: source still says “40 leading records skipped · record 41 is the header” |
| Useful default chart | Visualization | Label heuristics; one Y series | NOAA CSV opens as average vs decimal date, fitted Y | **Pass**: line of `average` against `decimal date`; Y ticks 322–438; include-zero not applied; time note present |
| Landing purpose in 10s | Coordinator | Existing landing | Title states inspect/correct/reuse; one upload action | **Pass**: “Turn charts and spreadsheets into data you can inspect, correct, and reuse.” |
| NOAA extraction scoring (T1) | Coordinator after eval agent died | Gemini + reference CSV | Every aligned observation scored | **Done for the UNSPIN arm.** Tolerance: normalized error ≤ 0.01 of the 20 ppm axis (0.2 ppm). 136 matched, 2 missing (`2026-09` both series), extra 0, wrong_series 16, abs_error median 0.135 / p90 1.18 / max 2.37 ppm, **73/136** within 0.2 ppm. One image, one crop, one call. See `docs/EVALUATION.md`. |
| Durable Postgres restart | Coordinator | Local PostgreSQL | Restart web and worker; same workspace reopens; source bytes survive | **Pass** on dedicated `:3110` (`unspin_core_finish`) and on everyday `:3000` (`unspin_dev`, filesystem `.data/blobs`, worker). Evidence: `evaluation/results/durable/REPORT.md`, `evaluation/results/dev-durable/REPORT.md`. |
| Public demo controls | P1 after P0 | Auth0 + quotas | Not started | Parked. No public URL. |
| Browser acceptance on integrated revision | Coordinator | Merged Recharts + defaults | NOAA CSV path in real UI | **Pass** on production `:3108`. Notes: `evaluation/results/core-finish/notes.json` (0 fail). |

## Decision

**Interactive core path: complete.** Upload → skip 40 comments → inspect → correct `333.19` → `333.20` → readable default chart → undo → export → refresh restored the selection and chart.

**Durable capability: complete** on everyday `npm run dev` `:3000` plus `npm run worker`, database `unspin_dev`. Gemini keys in `.env.local` were not overwritten. Auth0, Vultr, and public access stay parked.

**Overall core finish: complete for P0.** T1 scoring exists for UNSPIN only (one chart). Do not put this server on a public URL.

## Checks actually run (this durable pass)

- Everyday `:3000` health: persistence postgres, durable true, jobs worker (Gemini keys kept; persistence keys appended).
- Everyday restart/reopen against `unspin_dev`: pass (`evaluation/results/dev-durable/REPORT.md`).
- Earlier `:3110` HTTP acceptance (`run-durable-restart.mjs` before / kill / after): pass. Source sha256 unchanged across restart; undo export sha256 `44138e6ce91a4af1fbef295815f4914334e85bb9b5d050ff06faaab197b9be35`.
- `UNSPIN_TEST_DATABASE_URL=postgres:///unspin_infra_test` vitest `postgres.test.ts` + `runner.test.ts`: **39 passed** (includes 23 postgres repository-contract tests that are not even registered in default `npm test`).
- `.env.local` key presence inspected (names and set/empty only; values not printed).
- `pg_isready -h 127.0.0.1 -p 5432`: accepting.

Not re-run this pass (unchanged code, already recorded): typecheck, default `npm test` (567 passed, 13 skipped), production build, `:3108` NOAA CSV browser path.
