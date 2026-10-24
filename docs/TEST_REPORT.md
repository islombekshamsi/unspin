# UNSPIN test report — Phase 1 (pre-integration)

Status: **draft, phase 1**. The verification harness was built and run against the foundation code while
ingestion, extraction, transforms, exports, and chart-query services were still placeholders. Nothing in this
report measures extraction accuracy or user benefit yet.

## Commit and runtime

| Item | Value |
| --- | --- |
| Code under test | `6209dc7af7372d2fdb5265a00e60005a1a862176` (foundation); test harness on branch `qa/phase1-verification` |
| Node | v24.13.0 |
| Next.js | 16.4.3 (`next dev`, Cache Components enabled) |
| Test runner | vitest 5.0.5 |
| OS | macOS (darwin 25.3.0) |
| Persistence | memory (`UNSPIN_PERSISTENCE` unset), non-durable |
| Jobs mode | inline (default) |
| Dev server | `npx next dev -p 3106`, started with `GEMINI_API_KEY` and `DATABASE_URL` unset; no `.env.local` in the worktree |
| Date | 2026-10-24 |

## Commands and results

| Command | Result |
| --- | --- |
| `npm ci` | succeeded |
| `npm run typecheck` | passed (0 errors) |
| `npx eslint tests evaluation` | passed (0 problems) |
| `npm test` | 13 files: 9 passed, 4 skipped. 243 tests: **199 passed, 44 skipped, 0 failed** |
| `BASE_URL=http://localhost:3106 npx tsx tests/smoke/http-smoke.ts` | 25 checks: **19 pass, 6 blocked, 0 fail** (exit 0) |

### Unit and integration tests by file

| File | Pass | Skip | Notes |
| --- | --- | --- | --- |
| tests/contracts/contracts.test.ts (pre-existing) | 19 | 0 | |
| tests/contracts/schemas.test.ts | 82 | 0 | missingness, decimal strings, ids, selections, operation allowlist, error status map, envelope, manifest |
| tests/access/repositories.test.ts | 16 | 0 | cross-owner null/empty, no enumeration, blob key independent of filename, defensive copies, version compare-and-set |
| tests/orchestration/datasets.test.ts | 31 | 0 | cross-owner 404, stale preview/apply/restore/ack 409, preview_required, restore/undo/redo, rows query, export ack and view scope, chart column validation, deleteSource |
| tests/orchestration/extraction.test.ts | 17 | 1 | 1 skipped: real-parser branch; runs once `parseStructuredSelection` is implemented (the placeholder branch ran and passed) |
| tests/http/routes.test.ts | 19 | 0 | route handlers in-process: error envelopes, 400/404/409/413/503, masked 500 with no secret in body or logs, content download headers, hostile filename |
| tests/http/health.test.ts | 4 | 0 | canary env values never appear in the payload |
| tests/quality/findings.test.ts | 2 | 0 | |
| tests/evaluation/manifest.test.ts | 9 | 0 | committed hashes and sizes; no permission-unknown file committed; references match the source verbatim |
| tests/ingestion/real-inputs.test.ts | 0 | 22 | skipped: ingestion services throw the placeholder `not_configured` |
| tests/transforms/transforms.test.ts | 0 | 10 | skipped: `computeTransform` is a placeholder |
| tests/exports/exports.test.ts | 0 | 6 | skipped: `buildCsv`/`buildJson` are placeholders |
| tests/visualization/chart-query.test.ts | 0 | 5 | skipped: `runChartQuery` is a placeholder |

Skips are decided at runtime by probing the service: a call that throws `AppError("not_configured")` or
`unsupported_operation` "…not implemented yet" counts as a placeholder (`tests/helpers/stubs.ts`). No skip is
hardcoded, so each suite starts running as soon as its implementation lands. **The 44 skipped tests have never
executed against a real implementation.** They target the frozen contract signatures and may need adjustment
when they first run.

### Smoke check against the running server (port 3106)

| Check | Outcome | Observed |
| --- | --- | --- |
| GET /health shape | PASS | status=ok, gemini.configured=false, persistence=memory, durable=false |
| GET /health exposes no secrets | PASS | no key or connection-string patterns |
| GET /health cache-control | PASS | `private, no-store` |
| POST /sources JSON body | PASS | 400 bad_request |
| POST /sources multipart without file | PASS | 400 bad_request |
| POST /sources 10 MiB + 1 | PASS | 413 payload_too_large |
| POST /sources legacy .xls (real EIA file) | BLOCKED | 503 not_configured "Upload validation is not implemented yet."; expected 415 |
| POST /sources legacy .xls renamed .xlsx | BLOCKED | 503 not_configured; expected 415 |
| POST /sources truncated PNG | BLOCKED | 503 not_configured; expected 415/422/400 |
| POST /sources empty file | BLOCKED | 503 not_configured; expected 400/415/422 |
| POST /sources real NOAA CSV | BLOCKED | 503 not_configured; expected 201 |
| Guest cookie issued per client | PASS | two jars received distinct 43-char capabilities |
| Guest cookie attributes | PASS | `Path=/; Max-Age=2592000; HttpOnly; SameSite=lax` (no `Secure` over http in dev) |
| Cross-jar source isolation | BLOCKED | no source could be created; only empty-list isolation verified |
| Each jar lists no foreign sources | PASS | A=0, B=0 |
| Unknown source id | PASS | 404 not_found |
| Malformed guest cookie | PASS | replaced with a new capability, not trusted |
| POST /selections malformed JSON | PASS | 400 bad_request |
| POST /selections unknown source | PASS | 404 not_found |
| POST /extractions schema mismatch | PASS | 400 bad_request |
| GET /jobs/:unknown | PASS | 404 |
| GET /datasets/:unknown | PASS | 404 |
| GET /datasets/:id with `..%2F` | PASS | 404 |
| POST /datasets/:id/shares | PASS | 503 not_configured (sharing intentionally unavailable) |

Every error response was checked for the `ApiErrorBody` envelope, `Cache-Control: private, no-store`, and absence
of stack frames, file paths, keys, or connection strings. The server log for the run contained no errors.
Cross-owner isolation with real stored records is covered in-process by the access and orchestration tests;
over HTTP it is **not run** until uploads succeed.

## Real-provider test status

**Not run.** No Gemini calls were made in phase 1, and the dev server ran with no Gemini key.

## Real source manifest IDs

From `evaluation/sources.json` (licensing and permission evidence recorded per entry):

| ID | Kind | Permission | Stored |
| --- | --- | --- | --- |
| noaa-co2-trend-mlo-2026-10 | chart image (PNG) | US Government work (NOAA GML) | committed, `evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png`, sha256 `1f3bf74036f52d1b77068eb1a8fb143410297fb3a5848e3961a3b0247212d5af` |
| noaa-co2-mm-mlo-csv-2026-10 | CSV | NOAA-era rows only (1974-05 onward) | excerpt committed, `…co2-mm-mlo-1974-05_2026-09.excerpt.csv`, sha256 `a653f1af074f08f25f7b51e97d4b93b2e5485269a10a11df167e73e5cd7e6fad`; full file is URL+hash only |
| noaa-co2-data-mlo-full-2026-10 | chart image | unknown (co-branded Scripps/UCSD) | **excluded** |
| eia-steo-2026-10-pdf-p15-wti | PDF figure | US Government work (EIA) | URL+hash only (7.2 MB), fetched by `evaluation/fetch-inputs.sh` |
| eia-steo-2026-10-xlsx | XLSX | US Government work (EIA) | committed, `eia-steo-2026-10-base.xlsx`, sha256 `54989362410da4aff5673580396380c3a8f4f111fa6d01c6d4fab05ef90efbf4` |
| eia-pet-weekly-gasoline-xls | legacy XLS (negative case) | US Government work (EIA) | committed, sha256 `28e286b42e8ac505a904906fea66660601e3626208b34eb16715abe44c6c5bf2` |
| treasury-par-yield-2024-csv | CSV | unknown | local only (`.data/qa`), excluded from tests |
| census-mrts-sales-xlsx | XLSX | unknown | local only (`.data/qa`), excluded from tests |

References (copied verbatim from the machine-readable source, never read off a chart):
`evaluation/reference/noaa-co2-trend-mlo-2021-01_2026-09.reference.csv` (69 rows) and
`evaluation/reference/eia-steo-2026-10-wtipuus-monthly.reference.csv` (72 rows, 57 historical, 15 forecast).
Not acquired: CBO (HTTP 403), BLS (HTTP 403), and a CC-BY journal figure (not searched yet).

## Measured outcomes

**None.** The comparative protocol (`evaluation/PROTOCOL.md`) is designed but **not run**, and
`evaluation/results/` holds only `TEMPLATE.csv`. No accuracy, timing, or preference numbers exist.

## Failures

No test or smoke check failed. The issues below are defects or contract gaps found while writing the tests.
Production fixes belong to the owning specialist.

1. **CSV selection cannot skip a comment preamble.** `src/contracts/source.ts:96` caps `headerRecordCount` at
   `max(1)` and the header must be record 0. Observed: the real NOAA `co2_mm_mlo.csv` has 40 `#` lines (8 contain
   commas) before its header on line 41, so the real header can't be designated, and `recordInterval` can only
   select data records with no header. Expected: a user can select the header row of real public CSVs.
   Suggested patch: add `headerRecordIndex: z.number().int().min(0).nullable()` (or `skipRecords`) to the
   `csv_records` selection and use it in `resolveSelection`/`parseStructuredSelection`.
2. **Read-only GET endpoints create guest identities.** Every route, including GET list/read, calls
   `resolveOwner()`, which sets a new cookie. `currentOwner()` (`src/server/identity/index.ts:43`) is unused.
   Observed in smoke: any GET mints a 30-day capability. Expected: reads without a cookie return an empty list or
   404 without minting one. Suggested patch: use `currentOwner()` in GET handlers and treat `null` as
   "no records".
3. **Cursor parsing accepts trailing garbage.** `src/server/orchestration/datasets.ts:121` and `:151` use
   `Number.parseInt(cursor, 10)`, so `"5abc"` is accepted as 5. Expected: 400 `bad_request`. Suggested patch:
   `if (q.cursor && !/^\d+$/.test(q.cursor)) throw new AppError("bad_request", "Invalid cursor.");`
4. **deleteSource leaves selections and jobs behind.** `src/server/orchestration/sources.ts:96-104` deletes
   datasets, the source, and the blob, but `SelectionRepository` and `JobRepository` have no delete. Owner-scoped
   job and selection records referencing the deleted source remain, including their idempotency keys. Expected:
   deletion removes everything derived from the source (privacy). Suggested patch: add
   `deleteBySource(owner, sourceId)` to both repositories and call them in `deleteSource`.
5. **Unsupported uploads return 503, not 415** (placeholder; expected to resolve when ingestion lands). The
   smoke check records these as BLOCKED, and they must turn into PASS before phase 2 sign-off.
6. **Health route `connection()` runs outside `handle()`** (`src/app/api/v1/health/route.ts:6`). An exception there
   would bypass the error envelope. Low risk; suggested fix: move the call inside the handler.
7. **Source data issue, not a code defect:** EIA STEO October 2026, page 5, labels Brent "(dollars per gallon)",
   while page 3 and the spreadsheet use dollars per barrel. Kept as a real unit-ambiguity case in the manifest.

## Unsupported cases

- Legacy `.xls` (OLE2), including when renamed to `.xlsx`: expected 415. Currently 503 placeholder.
- Unstructured extraction (chart image, PDF figure) without a Gemini key: 503 `not_configured` with no job
  created (verified in-process).
- Sharing: 503 `not_configured` (verified).
- Census MRTS `(S)` suppression tokens and Treasury CSV: not tested (permission unknown).

## Screenshots inspected

**None.** No browser workflow was run in phase 1.

## Unresolved limitations

- 44 tests are gated on placeholder services and have never run against an implementation.
- Mutation checks were not run against production code (I won't edit `src/` in this role), so the tests'
  sensitivity to deliberate faults is unmeasured.
- HTTP cross-cookie isolation with real stored records is not run (uploads blocked).
- Postgres persistence and worker jobs mode: not run (infrastructure owns the database).
- Real Gemini extraction, accuracy against references, timing, and the comparative protocol: not run.
- Only two reference-backed tasks exist (NOAA trend chart, EIA WTI PDF figure). There is no permitted
  peer-reviewed figure yet.

## Phase 2 requirements

1. Merge the ingestion, extraction, transforms, exports, and chart-query implementations, then re-run `npm test`.
   The 44 gated tests must run with no skips, and any failures go back to the owners.
2. Re-run the smoke check. The 6 BLOCKED checks must become PASS, including HTTP isolation with a real uploaded
   source.
3. Decide defect 1 (CSV header row). Without it, the NOAA CSV case can't be represented faithfully.
4. Run `evaluation/fetch-inputs.sh` to fetch the EIA PDF, then run tasks T1 and T2 from `evaluation/PROTOCOL.md`
   with a configured Gemini key. The owner provides the key; QA never reads it. Record results in
   `evaluation/results/`.
5. Run the integrated browser workflow on port 3106 and record the inspected screenshots here.
