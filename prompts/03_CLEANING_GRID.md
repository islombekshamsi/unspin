# Specialist agent: Deterministic cleaning, editable grid, and history

## Your goal

Make candidate data inspectable and correctable through explicit, reversible operations with a real history.

## Exclusive ownership

src/features/grid/**, src/features/cleaning/**, src/server/transforms/**, src/server/quality/**

## Work to implement

1. Implement a paginated/virtualized, keyboard-usable data grid against stable row/column/cell IDs. Sorting and filtering are view changes, not silent dataset mutations.
2. Add a cell inspector showing raw/original text, current value, exact type/unit interpretation, origin, review status, and provenance. Use linked-selection events instead of private component state as a competing domain model.
3. Implement observable findings for missing values, repeated rows, mixed numeric formats, ambiguous dates, mixed units, and extraction issues. A repeated observation is not automatically erroneous.
4. Implement initial allowlisted operations: edit cell, rename column, trim selected text, explicit numeric/date parsing, explicit missing-token rule, remove selected rows, and reviewed exact-deduplication. Add registry-backed unit conversion only after precision/semantics checks pass.
5. For every material transformation provide actual before/after preview, affected IDs/counts, warnings, and expectedVersionId. Apply the exact previewed operation against the same base version. A stale version returns a recoverable conflict.
6. Keep exact decimal strings and explicit locale/percent/timezone policies. Missing stays missing; no automatic zero fill, outlier removal, rounding, or imputation.
7. Preserve immutable version lineage and operation history. Undo returns to an actual stored version. Coordinate repository calls with infrastructure and orchestration; do not create a second storage system.
8. Show saving/failed-save/unsaved-edit states truthfully. Keep selection and focus stable after edits. Use shared primitives and design tokens.

## Verification focus

Check preview/apply equivalence, stale-version behavior, actual undo restoration, source lineage after edits, missing-vs-zero, decimal/locale/percent/date handling, duplicate review, and keyboard/sorted-row selection.

## Start and coordination

Read AGENTS.md, docs/PRODUCT_SPEC.md, docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/DESIGN.md, docs/VALIDATION.md, and docs/DELIVERY_PLAN.md. Inspect the actual repository and coordinator's committed foundation before editing. If shared contracts are not yet committed, tell the coordinator what you need and work only on independent reconnaissance/owned empty/error states; do not invent conflicting contracts.

Use an isolated worktree when available. Use your assigned port/storage/database namespace, not another agent's environment. Preserve .env.local and all user work. Ask the coordinator for dependency, contract, root styling, route, or migration changes; do not compete over shared files. Implement real behavior inside owned modules and return typed integration seams to the coordinator.

## Completion report

Return changed paths, behavior implemented, exact commands/checks actually run and results, real-provider/data-test status, unresolved limits, contract/dependency requests, and integration instructions. Do not claim a live service was tested if it was not. Continue until your assigned scope is complete or a specific external dependency genuinely blocks it.

