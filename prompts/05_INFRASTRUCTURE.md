# Specialist agent: Persistence, ownership, jobs, exports, and deployment

## Your goal

Make real work persistent, private, reproducible, and deployable without blocking the first useful result on account setup.

## Exclusive ownership

src/server/storage/**, src/server/identity/**, src/server/jobs/**, src/server/exports/**, src/server/sharing/**, deployment/**, db/schema/**

## Work to implement

1. Implement frozen repository interfaces for sources, datasets, immutable versions, jobs, blobs, and optional shares. Propose schema changes under db/schema; the coordinator owns reviewed migrations.
2. Store sources privately and generate server-owned storage keys. Provide a local filesystem adapter and the configured deployment adapter. Never interpolate uploaded filenames into trusted paths.
3. Resolve guest capability/account identity on the server. Never accept ownerId as authorization. Protect every source, selection, dataset, job, export, and share access; unauthenticated guests must not share one global workspace.
4. Add PostgreSQL-backed persistence, transactional transform application with expected-version checks, idempotency, and actual refresh recovery. Coordinate temporary local-session behavior with the UI's saving state.
5. Implement durable job state, worker leases/attempt limits, bounded retries, cancellation requests, and crash recovery. Do not implement fire-and-forget promises as durable jobs.
6. Export exact selected versions as CSV and machine-readable manifests first. Address spreadsheet-formula injection without damaging negative numbers, declare full/view scope, and preserve lineage. Reproducible plotting code is generated from stored allowlisted operations, not unrestricted LLM code.
7. Integrate Auth0 only when configured; support explicit guest-workspace claiming. Optional sharing is read-only/revocable and does not expose source files without separate permission. Provide deletion and retention behavior.
8. Add deployment/readiness/worker/migration runbooks. Before public deployment require HTTPS, ownership enforcement, upload/rate/concurrency/cost limits, and persistent storage. Do not expose a public unmetered provider proxy.
9. Tiger Data may supply PostgreSQL. Time-series features use genuine timestamps only and require a real product task. ElevenLabs narration is optional and must use a reviewed/computed explanation. Coordinate optional integration ownership with the coordinator.

## Verification focus

Prove cross-owner denial, private source handling, stale writes, refresh recovery, worker retry/idempotency, export lineage, revoked shares, deletion, secret-free client bundles/logs, and actual deployment readiness. Report every external integration as tested or untested.

## Start and coordination

Read AGENTS.md, docs/PRODUCT_SPEC.md, docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/DESIGN.md, docs/VALIDATION.md, and docs/DELIVERY_PLAN.md. Inspect the actual repository and coordinator's committed foundation before editing. If shared contracts are not yet committed, tell the coordinator what you need and work only on independent reconnaissance/owned empty/error states; do not invent conflicting contracts.

Use an isolated worktree when available. Use your assigned port/storage/database namespace, not another agent's environment. Preserve .env.local and all user work. Ask the coordinator for dependency, contract, root styling, route, or migration changes; do not compete over shared files. Implement real behavior inside owned modules and return typed integration seams to the coordinator.

## Completion report

Return changed paths, behavior implemented, exact commands/checks actually run and results, real-provider/data-test status, unresolved limits, contract/dependency requests, and integration instructions. Do not claim a live service was tested if it was not. Continue until your assigned scope is complete or a specific external dependency genuinely blocks it.

