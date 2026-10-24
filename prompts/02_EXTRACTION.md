# Specialist agent: Gemini extraction and provenance

## Your goal

Produce candidate datasets from selected real figures/tables with honest provenance, coverage, uncertainty, and recoverable provider failures.

## Exclusive ownership

src/features/extraction/**, src/server/extraction/**, src/server/providers/gemini/**

## Work to implement

1. Implement the provider adapter against current official Gemini docs and the project's configured GEMINI_MODEL. Keep credentials server-only. Detect missing configuration by presence, never printing the value.
2. Build a versioned structured-output prompt/schema from frozen contracts. Source contents and user hints are untrusted data; they cannot change system rules or execute tools.
3. Respect selected page/region boundaries and disclose what bytes are actually sent. Do not silently forward a whole private document when the UI promises crop-only processing.
4. Preserve labels, units, series identity, axis interpretation, visible precision, and missingness. Never fabricate individual observations from averages/error bars or densely sample an unmarked curve as if those were original measurements.
5. Validate structure and semantics: row lengths/counts, column mapping, series consistency, finite typed values, unknown units, missing references, partial/ambiguous coverage, provider truncation, and unsupported plot types. Do not fill errors with plausible values.
6. Assign origin classifications. Chart readings remain estimates; table transcription remains subject to checking. Preserve best available source references with their method/precision, not fake coordinates or numerical confidence.
7. Return typed service results to coordinator-owned routes/jobs. Handle auth/quota/timeouts/safety/non-JSON/partial replies without exposing upstream content. Retries are bounded and idempotent.
8. Build extraction review UI elements that disclose candidate/partial status and let users return to source selection. Store no fake successful fallback.

## Verification focus

Test provider protocol/semantic failures in isolation, then perform at least one actual configured request on a permitted real input if credentials are available. Explicitly report live extraction as untested if not.

## Start and coordination

Read AGENTS.md, docs/PRODUCT_SPEC.md, docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/DESIGN.md, docs/VALIDATION.md, and docs/DELIVERY_PLAN.md. Inspect the actual repository and coordinator's committed foundation before editing. If shared contracts are not yet committed, tell the coordinator what you need and work only on independent reconnaissance/owned empty/error states; do not invent conflicting contracts.

Use an isolated worktree when available. Use your assigned port/storage/database namespace, not another agent's environment. Preserve .env.local and all user work. Ask the coordinator for dependency, contract, root styling, route, or migration changes; do not compete over shared files. Implement real behavior inside owned modules and return typed integration seams to the coordinator.

## Completion report

Return changed paths, behavior implemented, exact commands/checks actually run and results, real-provider/data-test status, unresolved limits, contract/dependency requests, and integration instructions. Do not claim a live service was tested if it was not. Continue until your assigned scope is complete or a specific external dependency genuinely blocks it.

