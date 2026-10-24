# Core finish status

_Updated 2026-10-24 after the integrated production pass on `npx next start -p 3108`._

| Gap | Owner | Dependency | Acceptance | Status |
| --- | --- | --- | --- | --- |
| Merge Phase 2 NOAA CSV walkthrough | Coordinator | `qa/phase2-walkthrough` (`e8ab289`) | Report on main | Done (`a005038`) |
| Adopt Recharts | Visualization | `agent/charts-recharts` (`186fea6`) | Bar/line/scatter without Plotly | Done (`8f66054`); no `plotly` imports remain in `src/` |
| Restore source selection after refresh | Coordinator | `GET /api/v1/selections/:id` | Refresh of `?source=&dataset=` shows the same CSV region | **Pass** on production: source still says “40 leading records skipped · record 41 is the header” |
| Useful default chart | Visualization | Label heuristics; one Y series | NOAA CSV opens as average vs decimal date, fitted Y | **Pass**: line of `average` against `decimal date`; Y ticks 322–438; include-zero not applied; time note present |
| Landing purpose in 10s | Coordinator | Existing landing | Title states inspect/correct/reuse; one upload action | **Pass**: “Turn charts and spreadsheets into data you can inspect, correct, and reuse.” |
| NOAA extraction scoring (T1) | Coordinator after eval agent died | Gemini + reference CSV | Every aligned observation scored | **Done for the UNSPIN arm.** 136 matched, 2 missing (`2026-09`), median abs error 0.135 ppm, 73/136 within 0.2 ppm. See `docs/EVALUATION.md`. |
| Durable Postgres restart | Coordinator | Local PostgreSQL | Restart web process; same workspace reopens | **Unverified gate.** `pg_isready` on `:5432` had no response. Process env had no `DATABASE_URL`. `.env.local` was not read. Verified mode this pass: in-memory, session only. |
| Public demo controls | P1 after P0 | Auth0 + quotas | Not started | Blocked until P0 eval + durable mode are real |
| Browser acceptance on integrated revision | Coordinator | Merged Recharts + defaults | NOAA CSV path in real UI | **Pass** on production `:3108`. Notes: `evaluation/results/core-finish/notes.json` (0 fail). |

## Decision

**Interactive core path: complete.** Upload → skip 40 comments → inspect → correct `333.19` → `333.20` → readable default chart → undo → export → refresh restored the selection and chart.

**Overall core finish: incomplete.** Durable restart has not been tested. T1 scoring exists for UNSPIN only (one chart). Do not put this server on a public URL.

## Checks actually run (this revision)

- `npm run typecheck`: pass
- `npm test`: 567 passed, 13 skipped
- `npx next build`: pass (`GET /api/v1/selections/[id]` present)
- Production `next start -p 3108` + Playwright Chrome driver: 0 fail
