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

---

# Phase 2 walkthrough — merged app (2026-10-24)

Status: **one real-browser pass completed**. This is not an accuracy score and not a Gemini measurement.

## Commit and runtime

| Item | Value |
| --- | --- |
| Code under test | `ae8f8b8416fc8ed0881db0bd1feda5d2c9336b5b` (worktree branch `qa/phase2-walkthrough`) |
| Node | v24.13.0 |
| Next.js | 16.4.3 (`npx next dev -p 3106`) |
| Browser | Google Chrome (system) driven by playwright-core 1.56.1; landing also opened in the Cursor browser on 3106 |
| OS | macOS (darwin 25.3.0) |
| Persistence | memory (`UNSPIN_PERSISTENCE` unset), `durable=false` |
| Jobs mode | inline |
| Gemini | not configured (`GET /api/v1/health`: `gemini.configured=false`; reason shown on the landing page) |
| Dev server | `npx next dev -p 3106` in this worktree; no `.env.local`; `GEMINI_API_KEY` not read |
| Date | 2026-10-24 |

## Inputs (committed, hashed)

| File | sha256 | Used for |
| --- | --- | --- |
| `evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv` | `a653f1af074f08f25f7b51e97d4b93b2e5485269a10a11df167e73e5cd7e6fad` | Happy path |
| `evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png` | `1f3bf74036f52d1b77068eb1a8fb143410297fb3a5848e3961a3b0247212d5af` | Failed extraction (title-only crop) |

## Steps (pass/fail)

| Step | Result | What I actually saw |
| --- | --- | --- |
| 1. Landing empty state | **PASS** | “Drop your data. Make it usable.” Upload control. Limits 10 MB / 20k rows / 64 cols. Gemini unavailable note. Session-only note. Desktop 1280 and phone 375. |
| 2. Upload NOAA CSV | **PASS** | 29.1 KB accepted. URL `?source=src_182cb9e947c74eba8afcd209a976870b`. |
| 3. Select | **PASS** | Preview suggested skip 40 `#` records and a header. First data row `1974, 5, 1974.3750, 333.19, …`. 629 data records × 8 columns. “Use this selection.” |
| 4. Import / extract | **PASS** | Deterministic parser. “Nothing is sent to an external service.” Workspace: 629 rows × 8 columns, complete selection, 5032 unreviewed. Dataset `ds_cc213be43ca84bc19a55fa8f5acd91e9`. |
| 5. Inspect cell + source | **PASS** | `average` 333.19 on source row 1. Source: Record 1, line 42, linked. Inspector: parsed, not reviewed, “CSV record 1, line 42, field 4”, precise. |
| 6. Correct (preview, then Save) | **PASS** | Edited 333.19 → 333.20. Preview showed before/after. Save created v2; 1 corrected. Source text stayed 333.19. Grid showed 333.20 with an edit marker. |
| 7. Chart click / keyboard select | **PASS** (with defect) | Navigator Enter selected series “month”, source row 2, y=6. Source jumped to Record 2 / line 43 (linked). One grid row selected. Default chart is unreadable: see defect 1. |
| 8. Undo | **PASS** | History → Undo last change → Undo. v1 current again. 0 corrected. First average back to 333.19. |
| 9. Export CSV+JSON+manifest | **PASS** | Dialog downloaded all three. CSV: BOM, 629 data rows, first row `1974,5,1974.3750,333.19,…`. Manifest source hash matches the committed CSV; `skipLeadingRecords: 40`. data.json first average remains `"333.19"` / `parsed` (export was after undo). Hashes in `evaluation/results/walkthrough/downloads/EXPORT_HASHES.txt`. |
| 10. Page refresh | **PASS** (with defect) | Same `?source=` / `?dataset=` restored the dataset, grid, and chart. Source panel lost the selection: “No selection has been made for this file yet.” Memory mode did **not** wipe the workspace on refresh. |
| 11. Failed extraction | **PASS** | Title-only crop of the NOAA PNG: 672×72 px at (64, 6) of 800×600 (title band). Source kept. “Start extraction” disabled. Real stage text: not configured / unavailable. No `?dataset=`. No invented dataset. **Cancel of a live Gemini job was not run** (no key on this server). |
| Desktop 1280 / phone 375 | **PASS** | Full path at 1280. Landing only at 375 (upload + notes still present). |

Screenshots: `evaluation/results/walkthrough/01-landing-desktop.png` … `19-landing-mobile.png`. Machine log: `notes.json`. Narrative: `OBSERVATIONS.md`.

Refresh and failed extraction were real. **This walkthrough did not score Gemini.** A later UNSPIN T1 measurement on the same NOAA chart (commit `c7f7122`) did score it: see the addendum below. Do not treat this Phase 2 section as “accuracy not scored” for the product as a whole.

## Defects (owners)

1. **Default chart plots every numeric column against `year` with Include zero.** Observed y-axis 0–2000 while CO₂ averages are ~333–430, so the series of interest is a flat band. Month (1–12) and decimal-date (~1974–2026) share that axis. Expected: a usable default (e.g. `decimal date` × `average`, Fit data) or a refusal to mix incompatible series. Owner: `src/features/visualization/**`.
2. **Refresh drops the source selection.** After reload, `?source=` / `?dataset=` restore the grid, but Source says “No selection has been made for this file yet.” Linking still needs that selection. Expected: restore the stored selection with the dataset. Owner: `src/features/workspace/WorkspaceShell.tsx` (`useUrlState`) / ingestion `SourceViewer`.
3. **Live job cancel was not exercised.** Gemini is unset, so Start extraction stays disabled. Title-crop failure is honest, but Cancel-while-running is untested. Owner: extraction, when a key is present.

Phase 1 defect 1 (CSV cannot skip a `#` preamble) **did not reproduce** on this build: the UI suggested and applied skip 40, and line 42 stayed the first data record.

## Commands actually run

| Command | Result |
| --- | --- |
| `npm ci` (worktree) | succeeded |
| `npx next dev -p 3106` | Ready; `GET /api/v1/health` → ok, gemini false, persistence memory |
| `node evaluation/results/walkthrough/drive.mjs` | completed; 22 observation notes; 3 downloads |
| File hashes of the two committed NOAA inputs | match Phase 1 / `evaluation/sources.json` |

No unit-test rerun in this role. No Gemini call. No invented timings.

---

# Addendum — T1 scores, skipped tests, durable restart (2026-10-24)

This addendum supersedes the Phase 2 sentence that Gemini was unscored. Phase 1 skip counts (44) are historical; they are not the current `npm test` skip list.

## T1 NOAA chart (UNSPIN arm), committed in `c7f7122`

Source: `evaluation/results/T1/score.json` and `evaluation/results/T1_NOAA.md`. One consented `gemini-3.8-flash` call, crop 48,78,688,468 px, 165.9 s, coverage `uncertain`, all origins `estimated`. The reference key was opened only after export.

| Item | Value |
| --- | --- |
| Tolerance (declared before scoring) | normalized error ≤ 0.01 of the 20 ppm axis (412.5–432.5) = **0.2 ppm** |
| Expected key rows | 138 (69 months × 2 series, 2021-01..2026-09) |
| Extracted | 68 × 3 table → 136 long observations |
| matched | 136 |
| missing | 2 (`2026-09` monthly mean and deseasonalized) |
| extra | 0 |
| wrong_series | 16 (numerical closeness to the other series, not a whole-column swap) |
| abs_error | median 0.135 ppm, p90 1.18 ppm, max 2.37 ppm (`2025-07` average: extracted 425.5, key 427.87) |
| within 0.2 ppm | **73 / 136** matched |
| within 0.5 ppm | 93 / 136 |
| within 1.0 ppm | 116 / 136 |

Limitations: one image, one crop, one model call, one operator, no cell corrections. It does not establish Gemini accuracy in general, UNSPIN superiority, or fitness for scientific analysis. General-AI and WebPlotDigitizer arms were not run. T2 was not run.

## The 13 skipped tests on default `npm test`

Recorded count: **567 passed, 13 skipped, 0 failed.** Skips are not a hidden persistence hole in the HTTP path; 9 of them *are* Postgres tests that opt in via `UNSPIN_TEST_DATABASE_URL`.

| Count | Where | Why skipped | Required behavior? |
| --- | --- | --- | --- |
| 7 | `src/server/jobs/runner.test.ts` `JobWorker (postgres)` | `UNSPIN_TEST_DATABASE_URL` unset | Yes: worker claim/lease/cancel against Postgres. Memory twin of the same 7 tests **does** run. |
| 2 | `src/server/storage/postgres.test.ts` | same unset URL | Yes: migration idempotence and advisory-lock serialization. |
| 3 | `tests/ingestion/real-inputs.test.ts` (`it.runIf(pdfPresent)`) | EIA STEO PDF is not in the repo; needs `evaluation/fetch-inputs.sh` | PDF page/geometry ingestion. Not persistence. |
| 1 | `tests/orchestration/extraction.test.ts` placeholder-parser failure | Parser now exists, so `it.runIf(parserIsPlaceholder)` does not run | Obsolete honest-failure branch. The real-parser NOAA job test **runs**. |

**Not in the 13:** 23 `postgres repositories` contract tests in `repository-contract.ts` are registered only `if (url)`. Default `npm test` never sees them (not skipped, not counted). They cover ownership isolation, version compare-and-set, restore, job leases, shares, deletion cascade, guest claim.

On this pass, with `UNSPIN_TEST_DATABASE_URL=postgres:///unspin_infra_test`:

```text
npx vitest run src/server/storage/postgres.test.ts src/server/jobs/runner.test.ts
# Test Files  2 passed; Tests  39 passed (0 skip)
```

That 39 = 7 memory worker + 7 postgres worker + 2 migrate + 23 repository contract. Persistence unit coverage exists; default `npm test` still omits it unless the URL is set. It does not replace the HTTP restart acceptance.

## Durable HTTP restart

See `evaluation/results/durable/REPORT.md`. Pass on `:3110`. Everyday `:3000` was then pointed at `unspin_dev` (Gemini keys kept; persistence keys appended). Health `durable=true`; restart/reopen pass in `evaluation/results/dev-durable/REPORT.md`.

---

# Addendum — interactive workspace (2026-10-24)

Isolated production `next start -p 3122` against `postgres:///unspin_interactive`, filesystem `.data/interactive-blobs`, `UNSPIN_JOBS_MODE=inline`. Everyday `:3000` / worker on `unspin_dev` were not stopped.

NOAA Mauna Loa monthly CSV excerpt, skip 40 leading records: 629 × 8, first average `333.19`, provenance CSV record 1 / line 42. Deterministic overview: time series, `average` over `decimal date` 1974.375 → 2026.7083, 333.19 to 426.07 (+92.88). Saved view `NOAA all` persisted across reload. Record panel and chart Ask AI on a selected point. Search `zzzznomatch` → “No rows match this view.” Consent, then Gemini `gemini-3.8-flash`: overview job completed with 4 insight cards; question “How did average change from the first to the latest observation?” completed with 1 card. Show evidence on the trend card selected source row 1 (`333.19`). JSON schema success was not treated as grounding; an earlier entire-dataset call was rejected until fact ids and validation salvage were in place.

`npx vitest run tests/analysis/view-profile.test.ts`: 10 passed. `npx tsc --noEmit`: pass. `npm run build`: pass.

Known remaining: Penn State expense PDF and Fed borrowing-rate PDF not started. T1 general-AI and WebPlotDigitizer arms not run. Auth0 / public deploy parked. Client insight rendering on this production bundle omitted unit suffixes (`629 across 8`); source now appends units.

## Build from text (2026-10-25)

Added an explicit prose mode for PDF/image selections using the existing durable extraction pipeline. Only reported numerical observations are accepted. Present values require transcribed supporting quotes; validation rejects estimated values, absent quotes, and numbers inconsistent with their quoted text. Quotes are model transcriptions, not independently verified PDF text. Chart suitability still depends on meaningful compatible numeric columns; no values are fabricated for prose without observations.

Checks run: TypeScript `npx tsc --noEmit` passed. Focused extraction/provider/ingestion/presentation/orchestration suite: 85 passed, 1 skipped. After adding mode-isolation/idempotency coverage, orchestration alone: 18 passed, 1 skipped. Protocol fixtures test behavior and do not measure real extraction accuracy.

Real browser on existing :3000: October-2026-Newsletter.pdf, whole page 3, selected Build from text, confirmed external-processing disclosure, submitted to configured Gemini. Observed queued → waiting for model → no_data_found: “The selected text has no explicit numerical observations suitable for a chart. No numbers were invented.” Thus the real failure path is verified; a successful prose-derived table/chart for this document is NOT established. No dataset was created from this response. Screenshot: `docs/text-mode-browser.png`. Existing restart/undo/export acceptances were not rerun or newly claimed.
