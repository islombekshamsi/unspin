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

- End-to-end checkpoint (real CSV/XLSX through export; real image through Gemini via the HTTP route).
- QA phase 2: browser workflow, measurements, `docs/TEST_REPORT.md`.

## Blocked / not configured

- Auth0 sign-in is not wired: the SDK is not installed. Accounts report "not configured".
- No per-user extraction quota or bot protection yet. Do not deploy publicly until both exist.
- The S3 adapter has not been exercised against a real bucket. Nothing has been deployed.

## Checks actually run (2026-10-24)

- `npm run typecheck`: pass.
- `npx eslint src tests`: 0 errors; 1 warning (`react-hooks/incompatible-library` on `useVirtualizer`).
- `npm test`: 556 passed, 13 skipped.
- `npx next build`: pass (after the ingestion merge).
- HTTP smoke against `next start` on port 3106: last run was 20 pass / 6 blocked (upload validation), before the ingestion merge. Re-run is next.
- Live Gemini: one real public-domain FDA chart extracted by the extraction specialist calling the service directly. It has not been run through the HTTP route yet.

## Known limits

- Limits are design targets, not measurements: 10 MiB upload, 20,000 structured rows, 64 columns, 250 AI rows per region, 200 MiB inflated XLSX.
- Gemini latency was 50–120 s per call in live tests.

## Next owner

Coordinator: HTTP smoke re-run, real upload-to-export checkpoint, then QA phase 2.
