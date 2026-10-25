# UNSPIN status

_Updated by the coordinator at milestones. No secrets or source contents._

## Completed

- **Gate 0 foundation**
  - Runtime contracts (Zod) in `src/contracts/`.
  - Central limits and environment config in `src/server/config/`.
  - Error envelope and route helpers in `src/server/orchestration/http.ts`.
  - Orchestration use cases and all `/api/v1` routes.
  - Repository interfaces.
  - Guest capability cookie identity.
  - Design tokens and shared UI primitives.
  - Typed API client.
  - Workspace shell with frozen component seams (`src/features/workspace/seams.ts`).
- **Node runtime:** pinned to the Node 24 LTS line (`.nvmrc`, `engines`). `pdfjs-dist` 6 needs Node ≥ 22.13 and `vitest` 5 needs Node ≥ 22.12.
- **All six specialist branches are merged.**
  - **Ingestion:** content-based upload checks, CSV/XLSX parsers, image/PDF region preparation, selectors and source viewer. Native `@napi-rs/canvas` and `pdfjs-dist` load as server external packages.
  - **Extraction:** Gemini provider adapter, semantic validation, provenance mapping, launcher with consent, and real-stage job status. `GEMINI_MODEL=gemini-3.8-flash`.
  - **Cleaning/grid:** deterministic transforms, quality findings, editable virtualized grid, history.
  - **Visualization:** chart query, chart panel, comparison panel.
  - **Infrastructure:** PostgreSQL repositories, blob stores, durable worker, exports, sharing, Vultr runbook.
  - **QA phase 1:** contract/access/HTTP tests, real-data manifest, smoke harness.
- **Coordinator integration after those merges:**
  - `/health` reports why Gemini is unavailable; provider budget is 180 s.
  - Only an upload issues a guest cookie; reads never do. Strict row cursors.
  - Next.js internal signals are re-thrown by `handle()`.
  - Duplicate-dataset race resolved to the winning dataset.
  - Share routes added; sharing is disabled without durable storage.
  - Rows query by `rowIds`; quality selection origin; bounded workspace height on large screens.
  - CSV `skipLeadingRecords` (optional; default 0). Leading `#` comment records are suggested, never silently dropped. Physical line numbers stay in provenance.

## In progress

- Interactive workspace (browser-accepted 2026-10-24 on `next start :3122`, DB `unspin_interactive`): expandable overview, Notion-style grid (search, presets, saved view “NOAA all”, record panel, empty-search “No rows match this view.”), deterministic NOAA time-series facts, consented Gemini overview (4 grounded cards) and a catalog-backed question, Show evidence to the matching rows. Everyday `:3000` (`unspin_dev`) was left running.
- T1 general-AI and WebPlotDigitizer arms not run.
- Penn State expense PDF and Fed borrowing-rate PDF paths not started.

## Durable mode (2026-10-24)

Verified on dedicated `next start :3110` (`unspin_core_finish`) and on everyday `npm run dev :3000` (`unspin_dev`, filesystem `.data/blobs`, worker). `.env.local` gained only missing persistence keys; existing Gemini keys were not changed. `:3000` health: `persistence.durable=true`. Restart/reopen: `evaluation/results/dev-durable/REPORT.md`. Tests stay on `unspin_infra_test`.

## Blocked / not configured

- Auth0 sign-in is not wired: the SDK is not installed. Accounts report "not configured".
- No per-user extraction quota or bot protection yet. Do not deploy publicly until both exist.
- The S3 adapter has not been exercised against a real bucket. Nothing has been deployed.

## Checks actually run (2026-10-24, core-finish revision)

- `npm run typecheck`: pass (not re-run after the durable docs pass).
- `npm test`: **567 passed**, 13 skipped. Nine of those skips are Postgres suites gated on `UNSPIN_TEST_DATABASE_URL`; three are unfetched EIA PDF cases; one is an obsolete placeholder-parser branch. Breakdown: `docs/TEST_REPORT.md` addendum.
- `UNSPIN_TEST_DATABASE_URL=postgres:///unspin_infra_test npx vitest run src/server/storage/postgres.test.ts src/server/jobs/runner.test.ts`: **39 passed**.
- Durable HTTP restart on `:3110`: pass (`evaluation/results/durable/REPORT.md`).
- Everyday `:3000` health after loading `.env.local`: persistence postgres, durable true, jobs worker.
- Everyday restart/reopen on `:3000` against `unspin_dev`: pass (`evaluation/results/dev-durable/REPORT.md`).
- `npx next build`: pass (not re-run after the durable docs pass).
- Production `next start -p 3108` NOAA CSV browser path: **0 fail** (`evaluation/results/core-finish/notes.json`). Default chart is `average` vs `decimal date`. Refresh restores the CSV selection.
- HTTP smoke against `next start` on port 3106 (earlier the same day): **30 pass, 0 blocked, 0 fail**.
- **HTTP end-to-end, real files, production server on 3106 (earlier the same day):**
  - NOAA CO₂ monthly CSV excerpt: skip 40 comment records, 629 × 8, first row `1974,5,1974.3750,333.19,…`, provenance line 42.
  - EIA STEO XLSX sheet `2tab` range `A6:E6`: `WTIPUUS` / `83.22` / `91.64` / `108.5`.
  - NOAA Mauna Loa CO₂ trend PNG through Gemini (T1 UNSPIN arm): 68 × 3, 165.9 s, first row `2021-01` / `415.5` / `415.3`. After export: 136 matched, 2 missing (`2026-09`), extra 0, wrong_series 16, median abs error 0.135 ppm, 73/136 within 0.2 ppm.

## Known limits

- Limits are design targets, not measurements: 10 MiB upload, 20,000 structured rows, 64 columns, 250 AI rows per region, 200 MiB inflated XLSX.
- Gemini latency was 50–120 s per call in live tests.

## Next owner

Auth0, Vultr, and public deploy stay parked. Everyday local durable mode is on `:3000` with `unspin_dev`. A later Supabase (or other hosted) Postgres is a `DATABASE_URL` substitution; see README.
