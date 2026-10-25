# Durable restart acceptance — 2026-10-24

HTTP import → edit → commit → kill web+worker → restart → reopen → source/history → undo → export.

Not a browser walkthrough. Script: `evaluation/scripts/run-durable-restart.mjs`.

## Runtime

| Item | Value |
| --- | --- |
| Web | `npx next start -p 3110` |
| Worker | `npx tsx src/server/jobs/worker.ts` |
| Database | local PostgreSQL `unspin_core_finish` (peer auth, `postgres:///unspin_core_finish`) |
| Blobs | filesystem `UNSPIN_STORAGE_ROOT=.data/core-finish-blobs` (mode `600`) |
| Jobs | `UNSPIN_JOBS_MODE=worker` |
| Input | committed NOAA excerpt CSV, sha256 `a653f1af074f08f25f7b51e97d4b93b2e5485269a10a11df167e73e5cd7e6fad`, 29804 bytes |

Process environment supplied `DATABASE_URL`, storage, and jobs. `.env.local` was not modified. The user’s `npm run dev` on `:3000` was left running (memory, non-durable).

`GET /api/v1/health` on `:3110` after restart: persistence `postgres` durable `true` ready `true`; blob `filesystem` ready `true`; jobs `worker`; sharing available.

## Why default `npm run dev` is not durable

`.env.local` exists (99 bytes). Keys present: `GEMINI_API_KEY` (set), `GEMINI_MODEL` (set). Keys absent: `DATABASE_URL`, `UNSPIN_TEST_DATABASE_URL`, `UNSPIN_STORAGE_MODE`, `UNSPIN_JOBS_MODE`, `UNSPIN_STORAGE_ROOT`. No `NEXT_PUBLIC_` keys. Values were not printed.

`:3000` health: persistence `memory`, durable `false`, blob `memory`, jobs `inline`, sharing unavailable.

An earlier `pg_isready` miss on `:5432` was not evidence that Postgres was absent. On this pass `pg_isready -h 127.0.0.1 -p 5432` accepted connections. The product default stayed in memory because `DATABASE_URL` is not in `.env.local` or the `:3000` process environment.

## Before restart

IDs: source `src_171dae12de67474293080bc20b5e812f`, dataset `ds_8d09a252f1e444408e8092a05a7a1a06`, v1 `ver_b924421ca6b84dd29bec0808186bdbab` (first `average` `333.19`), v2 `ver_2c4b99c59dd14a29bdb857bea3f6414a` (edited to `333.20`). Stored source sha256 matched the committed input.

Blob file count was 3: the accepted source plus two leftovers from earlier failed script attempts (same 29804-byte CSV, mode `600`). Files remained on disk after the processes were killed.

## After restart

| Check | Result |
| --- | --- |
| Reopen current version | v2, first average `333.20` |
| Selection | `csv_records`, skip 40 leading records |
| History | 2 entries |
| Source bytes via `GET /sources/:id/content` | sha256 matches input |
| Blob files after restart | 3, unchanged |
| Undo to v1 | first average `333.19` |
| Export CSV after undo | sha256 `44138e6ce91a4af1fbef295815f4914334e85bb9b5d050ff06faaab197b9be35`; contains `333.19`, not `333.20` |

Machine logs: `before.json`, `after.json` (no guest cookie).

After the run, `unspin_core_finish` held 3 sources, 2 selections, 2 datasets, 4 versions, 5 history entries, 2 jobs (includes leftover failed attempts).
