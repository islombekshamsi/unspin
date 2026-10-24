# UNSPIN

**Drop your data. Make it usable.**

UNSPIN turns a chart image, PDF figure, CSV, or XLSX file into a dataset you can work with. You can inspect it beside its source, correct it with explicit and reversible operations, explore it in linked interactive charts, and export it with full provenance and history.

> Status: under active multi-agent development. `docs/STATUS.md` lists what works today and how it was verified.

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

```bash
npm run dev          # http://localhost:3000
```

Durable mode (PostgreSQL, filesystem blobs, background worker):

```bash
createdb unspin                      # any local PostgreSQL database
# in .env.local: DATABASE_URL=postgres:///unspin, UNSPIN_STORAGE_MODE=filesystem, UNSPIN_JOBS_MODE=worker
npm run db:migrate                   # applies db/migrations once; refuses edited migrations
npm run dev                          # terminal 1
npm run worker                       # terminal 2
```

Read-only share links need durable storage. On a memory-only server they return 503, rather than handing out a link that stops working when the server restarts. Deployment is described in `deployment/README.md`.

## Checks

```bash
npm run typecheck    # next typegen + tsc
npm test             # vitest; PostgreSQL suites run when UNSPIN_TEST_DATABASE_URL is set
npm run lint
BASE_URL=http://localhost:3106 npx tsx tests/smoke/http-smoke.ts   # against a running server
npm run build
```

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

- **CSV and XLSX** are parsed deterministically on this server. Nothing is sent to an AI model.
- **Images and PDFs:** only the region you select is sent to Google Gemini, and only after you confirm. Values read from charts are marked as estimates, and every value keeps a source reference.

## Project layout

See `docs/ARCHITECTURE.md`. Shared contracts live in `src/contracts/`. HTTP routes are under `src/app/api/v1/`, and use cases are in `src/server/orchestration/`.

## Known limitations

- **Extraction latency:** in the default `inline` jobs mode, the extraction request stays open until Gemini answers. Live calls on 2026-10-24 took 50–120 s, with intermittent provider 503s. Each job has a total budget of 180 s across at most two attempts, after which it fails with an explicit timeout. Worker mode moves this wait out of the request.
- **Unpaid Gemini tier:** if the server's key is on an unpaid tier, Google's terms allow submitted content to be used to improve its products and to be reviewed by people. Send only material you are allowed to share until a paid tier is configured.

See also `docs/STATUS.md` and `docs/TEST_REPORT.md`.

## Deployment

See `deployment/`.
