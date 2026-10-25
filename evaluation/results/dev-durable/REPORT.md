# Everyday durable development — 2026-10-24

Dedicated database `unspin_dev` (not `unspin_infra_test` or `unspin_core_finish`). Filesystem blobs `.data/blobs`. Worker mode. Gemini keys in `.env.local` were left unchanged.

## Configuration loaded

| Process | Evidence |
| --- | --- |
| `npm run dev` `:3000` | `GET /api/v1/health`: persistence postgres, **durable true**, ready true; blob filesystem; jobs worker; sharing available; gemini.configured true. Health payload contained no connection string. |
| `npm run worker` | Started (`concurrency=1`). Would have exited 2 if `DATABASE_URL` were missing. |

## Restart / reopen

`BASE_URL=http://localhost:3000` `DURABLE_OUT=evaluation/results/dev-durable` `run-durable-restart.mjs` before → kill web+worker → restart both (they still read `.env.local`) → after.

| Check | Result |
| --- | --- |
| Source bytes | sha256 `a653f1af074f08f25f7b51e97d4b93b2e5485269a10a11df167e73e5cd7e6fad` |
| After reopen | current version first average `333.20`; skip 40 stored |
| Blob files | 1 file, 29804 bytes, mode `600`, unchanged across restart |
| Undo + export CSV | sha256 `44138e6ce91a4af1fbef295815f4914334e85bb9b5d050ff06faaab197b9be35` |

`unspin_dev` after the run: 1 source, 1 dataset, 2 versions.
