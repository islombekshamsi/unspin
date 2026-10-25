# Architecture and implementation boundaries

## Stack decision

Use the existing Next.js App Router + TypeScript + React application. Keep its working dependency versions unless compatibility requires a change. Use Tailwind if already configured, with a small shared token layer. Do not introduce a second frontend framework.

Initial backend: TypeScript server modules and Next route handlers, plus a separate Node worker process once durable jobs are needed. Do not introduce FastAPI/Python as a parallel second backend for the same responsibilities. A future geometry/columnar worker is an explicit architectural extension, not a second extraction implementation started by another agent.

Recommended building blocks, subject to current-doc and license checks by the coordinator:

- Zod for runtime validation and shared schemas.
- Papa Parse or an equivalently tested CSV parser.
- ExcelJS for XLSX parsing/export; verify supported formula/cached-value behavior.
- PDF.js for document rendering, text items, and coordinate conversion.
- TanStack Table/Virtual for grid structure and virtualization.
- Plotly with a client-only, selectively loaded bundle for scientific/chart interaction. Coordinate responsive sizing and selection events through an adapter.
- decimal.js for exact decimal transformations. Do not silently push identifiers/large values into JavaScript Number.
- PostgreSQL for durable metadata/data/history. Local `unspin_dev` is the everyday database. A hosted Postgres (Supabase, Tiger Data) is a `DATABASE_URL` substitution; the app does not use a vendor SDK.
- Auth0 for authenticated accounts when enabled.
- Private filesystem blob storage locally; an S3-compatible private object-storage adapter for deployment when configured.

Coordinator controls package/lockfile changes. Each specialist submits dependency requests with purpose, version, bundle/runtime impact, and licensing notes.

## Module layout

    src/contracts/                    Runtime schemas and inferred shared types
    src/app/api/v1/                   Thin HTTP handlers; coordinator-owned
    src/server/orchestration/         End-to-end use cases; coordinator-owned
    src/server/config/                Central limits, feature flags, environment validation
    src/server/ingestion/             Structured parsing, file validation, sheet/header selection
    src/server/sources/               Source metadata, crops, coordinate transforms
    src/server/extraction/            Extraction pipeline and semantic validation
    src/server/providers/gemini/      Only module permitted to call Gemini
    src/server/transforms/            Allowlisted deterministic transformations
    src/server/quality/               Data-quality findings, no automatic destructive fixes
    src/server/storage/               Metadata/data/blob repositories
    src/server/identity/              Server-derived guest/account ownership
    src/server/jobs/                  Durable job state and worker runner
    src/server/analysis/              Deterministic profiler, view matching, grounded insight validation
    src/server/exports/               CSV/manifests/code/XLSX generation
    src/server/sharing/               Revocable, scoped share capabilities
    src/features/ingestion/           Upload and region/sheet selection UI
    src/features/extraction/          Selection and extraction review UI
    src/features/grid/               Data grid, cell editor, provenance inspector
    src/features/cleaning/            Findings, transform preview, history controls
    src/features/visualization/       Charts, axes, linked interactions
    src/features/comparison/          Compatibility checks and comparison views
    db/schema/                       Database schema proposals
    db/migrations/                   Coordinator-approved migrations
    tests/                           Logic, integration, access-control, and browser tests
    evaluation/                      Real-source manifests and measured benchmark outputs
    deployment/                      Runbooks, worker/service configuration

## Data flow

1. Resolve a server-owned workspace identity; validate and privately store the upload.
2. Return source metadata and actual previews/selections.
3. Parse structured sources deterministically or queue extraction for an explicit unstructured selection.
4. Gemini returns candidate rows/labels/source hints. Validate structure and semantics independently.
5. Persist an immutable initial dataset version and unresolved findings. The first version is not silently “clean.”
6. Serve paginated grid rows, view presets, a deterministic overview, and bounded chart queries. Optional analysis jobs send a fact catalog, not the source file. Model context is not storage.
7. Preview/apply validated operations against an expected version. Persist the resulting version and operation transactionally.
8. Export the selected committed version and its lineage.

## Provider design

Define GeminiProvider.extract(selection, schemaVersion, signal). Keep provider transport, prompt construction, parsing, and retry policy separate. Use an explicitly configured GEMINI_MODEL and current official SDK/API documentation; do not assume that a model name seen in an old tutorial is available. Check actual project availability during integration.

Gemini sees only the selected permitted source and bounded relevant context. It does not receive the entire growing dataset after every edit. It may propose an allowlisted operation but cannot execute arbitrary code. Responses are schema-validated and checked for column lengths, row counts, nonfinite values, missing source references, type mismatches, series ambiguity, and truncation.

Never use valid JSON as a proxy for correct data. Preserve raw provider output privately only if explicitly justified and consented; default operational logs contain IDs, status, elapsed time, and error category, not document content. Do not expose provider error bodies or credentials to clients.

## Processing and jobs

First vertical slice may run a bounded request synchronously if the host supports the timeout; surface its real limitations. Durable mode uses persisted job states, worker leases/heartbeats, attempt counts, cancellation requests, and bounded retries. A worker crash cannot erase the uploaded source or create a false success.

Design for at-least-once execution: completion writes are idempotent per job/selection/schema version. Two workers cannot create duplicate committed datasets for one extraction. Cancellation is best-effort for an already running provider request, and the UI must not imply a request was refunded or stopped upstream unless verified.

For local execution, document two terminal commands: web server and worker. Do not rely on an unawaited process inside a Next HTTP handler as a durable background job.

## Storage and identity

Repository interfaces: SourceRepository, DatasetRepository, VersionRepository, JobRepository, BlobStore, ShareRepository. Private storage keys are generated by the server, never from a raw filename. Every lookup checks owner/workspace access. Signed download URLs are short-lived and scoped.

Guest access uses an unguessable server-owned capability in a protected cookie. Account ownership comes from a validated server session. Never accept ownerId from a request body. Logging in may explicitly claim the guest workspace through a server transaction. Sharing is optional and read-only by default, revocable, and authorized at access time. A share link must not expose private source files unless source sharing was separately enabled.

Local worktrees need separate database namespaces and storage roots. No specialist runs destructive migrations against the integration or user's workspace. The coordinator applies reviewed migrations.

## Tiger Data and real time series

Use ordinary relational tables for source metadata, datasets, versions, provenance, and arbitrary x/y values. Only genuine dated observations belong in a time-series table/hypertable. A temperature/concentration x-axis is not a timestamp. Never invent dates merely to use a sponsor feature.

If added, demonstrate matching-window queries or real aggregation on actual dated series. Keep units, coverage, and aggregation rules visible. Performance claims require measured queries on the real input.

## Environment and deployment

Document required/optional variables in .env.example without secrets: GEMINI_API_KEY, GEMINI_MODEL, DATABASE_URL, storage mode/root, deployment origin, Auth0 configuration, optional S3 settings and ElevenLabs credentials. Exact names beyond the Gemini key are frozen by the coordinator. Secret-bearing variables never have NEXT_PUBLIC_ prefixes.

Vultr deployment should include HTTPS, private database connectivity, a persistent source-data volume/object store, worker supervision, health/readiness endpoints, and a migration/recovery runbook. Do not publish a public unmetered Gemini proxy: require ownership checks, request limits, concurrency caps, and provider budget controls before public deployment.

Auth0, Tiger Data, and ElevenLabs are feature-flagged integrations. An unavailable integration produces an honest unavailable state and must not break the functioning core.
