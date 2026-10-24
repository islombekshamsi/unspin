# Specialist agent: Ingestion and source viewing

## Your goal

Turn actual user uploads into validated sources, explicit selections, previews, and deterministic structured imports.

## Exclusive ownership

src/features/ingestion/**, src/server/ingestion/**, src/server/sources/**

## Work to implement

1. Implement signature/size/pixel-count validation for supported images and PDFs; validate CSV/XLSX types with parsers, not filename alone. Preserve original filename as display metadata only. Refuse encrypted/unsupported files with actionable errors.
2. Implement CSV parsing with explicit delimiter/header selection, preserved raw strings, stable record/column IDs, and correct multiline-record provenance. Reject inconsistent shapes or expose a deliberate recovery choice; never drop bad records silently.
3. Add XLSX sheet/range/header selection. Preserve large identifiers, displayed/raw values, missingness, and cached-formula status. Never execute formulas/macros. Expose unsupported merged/header structures honestly.
4. Build upload, image crop, PDF page/crop selection, workbook selection, and source-preview components. Use actual source bytes. Self-host/version-match the PDF.js worker; preserve orientation/rotation/crop coordinate transforms.
5. Provide an explicit SourceSelection compatible with the frozen contracts. For unstructured sources, supply only the selected permitted content to the extraction service where implemented.
6. Implement actual source anchors from parser geometry where available. Model-only hints are not precise geometry. Make page-only/region-only linking explicit.
7. Match shared design primitives. Handle keyboard alternatives, loading, invalid input, replacement upload, cancellation, and mobile selection without losing recoverable work.

## Verification focus

Verify quoted/multiline CSV records, Unicode, empty values, large identifiers, spreadsheet cached results, PDF rotation, crop round-trips, upload limits, and unsupported files. Use actual permitted documents for the integrated demo.

## Start and coordination

Read AGENTS.md, docs/PRODUCT_SPEC.md, docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/DESIGN.md, docs/VALIDATION.md, and docs/DELIVERY_PLAN.md. Inspect the actual repository and coordinator's committed foundation before editing. If shared contracts are not yet committed, tell the coordinator what you need and work only on independent reconnaissance/owned empty/error states; do not invent conflicting contracts.

Use an isolated worktree when available. Use your assigned port/storage/database namespace, not another agent's environment. Preserve .env.local and all user work. Ask the coordinator for dependency, contract, root styling, route, or migration changes; do not compete over shared files. Implement real behavior inside owned modules and return typed integration seams to the coordinator.

## Completion report

Return changed paths, behavior implemented, exact commands/checks actually run and results, real-provider/data-test status, unresolved limits, contract/dependency requests, and integration instructions. Do not claim a live service was tested if it was not. Continue until your assigned scope is complete or a specific external dependency genuinely blocks it.

