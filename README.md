# UNSPIN

**Turn charts and spreadsheets into data you can inspect, correct, and reuse.**

UNSPIN turns a chart image, PDF figure, CSV, or XLSX file into a dataset you can work with. You can inspect it beside its source, correct it with explicit and reversible operations, explore it in linked interactive charts, and export it with full provenance and history.

> What works today: `docs/WHAT_WE_HAVE.md`. Engineering checkpoints: `docs/STATUS.md`.

## Current workspace

- Overview, Data and Source tabs with linked evidence and optional Gemini analysis.
- Inline cell editing with declared-type validation, version history and undo.
- Bar, line and scatter charts with pointer-centered zoom, distribution-aware fitting, saved views and PNG export.
- Finance, Academic and Research import modes for the exact prepared source files described in [the prepared-data guide](docs/PREPARED_DEMOS.md). These results are previously prepared, not live AI responses; Live import remains available for other supported files.
- Exact decimal strings preserve numerical precision. Unambiguous numeric CSV columns remain numeric even with NA/N/A markers; missing measurements are not replaced with zero.

Credentials, local databases/blobs, temporary document inspections, dependency folders and build outputs are excluded from Git. The repository includes the prepared source-bound manifests and permitted evaluation fixtures, not your local `.env.local` or uploaded-file storage.

## Requirements

- Node.js 24 LTS. The version is pinned in `.nvmrc` and `package.json` `engines`. `pdfjs-dist` 6 needs Node ≥ 22.13, and `vitest` 5 needs Node ≥ 22.12.

  ```bash
  nvm install 24 && nvm use
  ```

- npm (the lockfile is `package-lock.json`).
- Optional: PostgreSQL 14+ for durable workspaces.

## Setup

```bash
nvm use
npm ci
cp .env.example .env.local   # only if you don't already have .env.local
```

Edit `.env.local`. Never commit it.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | For chart/PDF extraction | Server-only Gemini key |
| `GEMINI_MODEL` | For chart/PDF extraction | Explicit model id. Extraction stays disabled until both Gemini variables are set |
| `DATABASE_URL` | Optional | PostgreSQL. Without it, work is kept in process memory and lost on restart |
| `UNSPIN_STORAGE_MODE`, `UNSPIN_STORAGE_ROOT` | Optional | Private blob storage (`memory`, `filesystem`, or `s3`) |
| `UNSPIN_JOBS_MODE` | Optional | `inline` (default) or `worker` (needs `DATABASE_URL` and a worker process) |
| `APP_BASE_URL`, `AUTH0_*`, `UNSPIN_S3_*`, `ELEVENLABS_*` | Optional | Deployment origin and optional integrations. Each one is reported as unavailable until configured |

No secret uses a `NEXT_PUBLIC_` prefix. Only server code reads the Gemini key.

## Run

Everyday local development is durable when `.env.local` has `DATABASE_URL`, filesystem blobs, and worker mode. Use two terminals:

```bash
createdb unspin_dev                  # once; not the test or evaluation databases
npm run db:migrate                   # applies db/migrations once; refuses edited migrations
npm run dev                          # terminal 1 — http://localhost:3000
npm run worker                       # terminal 2 — required in worker mode
```

`GET /api/v1/health` should report `persistence.durable: true`. Without `DATABASE_URL`, work stays in process memory and is lost on restart. Read-only share links need durable storage; on a memory-only server they return 503 rather than handing out a link that dies on restart.

Do not point `UNSPIN_TEST_DATABASE_URL` at `unspin_dev`. Tests use `postgres:///unspin_infra_test`.

### Substituting a Supabase Postgres later

The app talks to PostgreSQL through `pg` and `DATABASE_URL` only. There is no Supabase client, Auth, or Storage SDK. To use a hosted database later:

1. In the Supabase dashboard, copy a **Postgres** connection string from **Connect**. Prefer the **direct** URI (`db.<project>.supabase.co:5432`) for `npm run db:migrate` and for the web/worker processes (they use session features: advisory locks, `FOR UPDATE SKIP LOCKED`). If the machine is IPv4-only, use the **session pooler** on port 5432, not transaction mode on 6543.
2. Replace `DATABASE_URL` in `.env.local` (or the server env). Keep `UNSPIN_STORAGE_MODE=filesystem` until you separately configure private S3. Do not add `NEXT_PUBLIC_` copies of the URI.
3. Append `sslmode=require` if the URI does not already specify SSL. Do not use `sslmode=no-verify`. `verify-full` plus the project CA is stronger when you have the certificate.
4. Run `npm run db:migrate` against that database, then start `npm run dev` and `npm run worker` as before.

No application rewrite. Auth0, Supabase Auth, cloud object storage, and public deploy stay unused until those are explicitly enabled.

Deployment is described in `deployment/README.md`.

## Checks

```bash
npm run typecheck    # next typegen + tsc
npm test             # vitest; PostgreSQL suites run when UNSPIN_TEST_DATABASE_URL is set
npm run lint
BASE_URL=http://localhost:3106 npx tsx tests/smoke/http-smoke.ts   # against a running server
npm run build
```

Current production-build limitation: Turbopack's CSS helper has encountered a local port permission error, and the Webpack fallback encounters an existing PDF-worker ESM bundling error. Neither is a passing production build; the local development workflows are verified. See [prepared-data verification](docs/PREPARED_DEMOS.md#build-status).

## Upload limits

These are the initial guardrails, set in `src/server/config/limits.ts`. They are design targets, not measured performance:

- 10 MiB per file.
- 20,000 structured rows.
- 64 columns.
- 40 megapixels per image.
- 200 PDF pages.
- One selected region per extraction.
- 250 AI-extracted rows per region.

Anything over a limit gets an explicit error. Nothing is silently truncated.

Supported inputs are PNG, JPEG, WebP, PDF, CSV (UTF-8), and XLSX. Legacy XLS, macro-enabled XLSM, encrypted files, archives, and executables are rejected with a reason. CSV files with leading `#` comment records can skip those records; the skip is chosen, never applied silently, and line numbers in source references stay physical.

## What happens to your file

- **CSV and XLSX** are parsed deterministically on this server. Spreadsheet bytes are not sent to a model for import.
- **Optional analysis** may send computed facts (counts, ranges, coverage) to Google Gemini after a separate confirmation. It does not edit the table.
- **Images and PDFs:** only the region you select is sent to Google Gemini, and only after you confirm. Values read from charts are marked as estimates, and every value keeps a source reference.

## Project layout

See `docs/ARCHITECTURE.md`. Shared contracts live in `src/contracts/`. HTTP routes are under `src/app/api/v1/`, and use cases are in `src/server/orchestration/`.

## Known limitations

- **Extraction latency:** in the default `inline` jobs mode, the extraction request stays open until Gemini answers. Live calls on 2026-10-24 took 50–120 s, with intermittent provider 503s. Each job has a total budget of 180 s across at most two attempts, after which it fails with an explicit timeout. Worker mode moves this wait out of the request.
- **Unpaid Gemini tier:** if the server's key is on an unpaid tier, Google's terms allow submitted content to be used to improve its products and to be reviewed by people. Send only material you are allowed to share until a paid tier is configured.

See also `docs/STATUS.md` and `docs/TEST_REPORT.md`.

## Deployment

See `deployment/`.
