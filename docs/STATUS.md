# UNSPIN status

_Updated by the coordinator at milestones. No secrets or source contents._

## Completed

- **Gate 0 foundation**
  - Runtime contracts (Zod) in `src/contracts/`.
  - Central limits and environment config in `src/server/config/`.
  - Error envelope and route helpers in `src/server/orchestration/http.ts`.
  - Orchestration use cases and all `/api/v1` routes.
  - Repository interfaces with a process-memory implementation.
  - Guest capability cookie identity.
  - Design tokens and shared UI primitives.
  - Typed API client.
  - Workspace shell with frozen component seams (`src/features/workspace/seams.ts`).
- **Node runtime:** pinned to the Node 24 LTS line (`.nvmrc`, `engines`). `pdfjs-dist` 6 needs Node ≥ 22.13 and `vitest` 5 needs Node ≥ 22.12.

## In progress

- Specialist workstreams 1–6 (see `prompts/`).

## Blocked / not configured

- `GEMINI_MODEL` is not set, so chart/PDF extraction reports "not configured". The key is present.
- Persistence is process memory only. It is not durable.

## Checks actually run

- `npm run typecheck`: pass.
- `npm test`: contract tests pass.
- `npx eslint src tests`: pass.
- `GET /api/v1/health` returns honest capabilities.
- `/` renders.

## Known limits

- Limits are design targets, not measurements: 10 MiB upload, 20,000 structured rows, 64 columns, 250 AI rows per region.

## Next owner

Specialists, then the coordinator for integration.
