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
- **Extraction (merged):** Gemini provider adapter, semantic validation, provenance mapping, launcher with consent, and real-stage job status. `GEMINI_MODEL=gemini-3.8-flash`.
- **Infrastructure (merged):**
  - PostgreSQL repositories and a migration runner.
  - Filesystem and S3-compatible blob stores.
  - A durable worker with leases, attempt limits and cancellation.
  - CSV, JSON and manifest exports.
  - Revocable, expiring read-only shares.
  - A guest-workspace claim seam.
  - Vultr deployment runbook.
- **QA phase 1 (merged):**
  - Contract, access, HTTP and orchestration tests.
  - Real-data manifest of US government sources, with hashes.
  - Reference answer keys and the evaluation protocol.
  - HTTP smoke harness.
- **Coordinator integration:**
  - `/health` reports why Gemini is unavailable.
  - Provider budget is 180 s per job.
  - Only an upload issues a guest cookie; reads never do.
  - Strict row cursors.
  - Health errors use the envelope.
  - Next.js internal signals are re-thrown by `handle()`.
  - Duplicate-dataset race resolved to the winning dataset.
  - Share routes added; sharing is disabled without durable storage.
  - `db/migrations/001_init.sql`, plus `worker` and `db:migrate` scripts.

## In progress

- Ingestion, cleaning/grid and visualization specialists.

## Blocked / not configured

- Upload validation and structured parsing wait on the ingestion merge. Until then uploads return 503 and the end-to-end flow cannot run.
- Auth0 sign-in is not wired: the SDK is not installed. Accounts report "not configured".
- No per-user extraction quota or bot protection yet. Do not deploy publicly until both exist.
- The S3 adapter has not been exercised against a real bucket. Nothing has been deployed.
- Pending contract decision: CSV header rows after leading comment lines (QA defect 1, NOAA CSV). To be resolved together with the ingestion merge.

## Checks actually run (2026-10-24)

- `npm run typecheck`: pass.
- `npx eslint src tests`: pass.
- `npm test`: 342 passed, 47 skipped. Skips are suites waiting on unmerged services.
- With `UNSPIN_TEST_DATABASE_URL` set to a local PostgreSQL 14 test database: 374 passed, 38 skipped.
- `npx next build`: pass.
- HTTP smoke against `next start` on port 3106: 20 pass, 6 blocked (upload validation), 0 fail.
- Live Gemini: one real public-domain FDA chart extracted, by the extraction specialist calling the service directly. It has not been run through the HTTP route yet.

## Known limits

- Limits are design targets, not measurements: 10 MiB upload, 20,000 structured rows, 64 columns, 250 AI rows per region.
- Gemini latency was 50–120 s per call in live tests.

## Next owner

Coordinator: merge ingestion, cleaning and visualization as they finish, then run the end-to-end checkpoint and QA phase 2.
