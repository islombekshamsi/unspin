# Specialist agent: Verification, real-data evaluation, and integration QA

## Your goal

Establish what actually works and whether the workflow helps people, using real permitted inputs and honest measurements.

## Exclusive ownership

tests/**, evaluation/**, docs/TEST_REPORT.md; production changes require owner coordination

## Work to implement

1. Create a source manifest for real evaluation/demo inputs: source/license/permission, exact selected region, source hash, numeric-reference origin, units/series/time period, and access date. Do not create fake demo papers/data or planted mistakes.
2. Obtain a small set of genuine published figures with independently known author-provided numeric values where possible, plus actual permitted CSV/XLSX/PDF inputs. Distinguish original reference data from other digitizers' estimates.
3. Write meaningful tests for runtime schemas, parser semantics, provenance, transform preview/apply/undo, concurrent versions, access control, exports, and chart selection. Protocol stubs belong only in isolated tests and never in the product/demo path.
4. Exercise the real browser flow at desktop/mobile widths, including first-use empty state, file errors, actual extraction, correction, linked source/chart selection, undo/export, quota failure, and refresh recovery where enabled.
5. Design a fair small comparison against a well-prompted general AI workflow and a suitable established digitizer. Measure numerical errors, wrong series/missing observations, and total time to a correct verified CSV. Do not stop timing before human correction.
6. Recruit consenting nearby students with genuine tasks if accessible; do not send third-party messages without explicit authorization. Observe first use without coaching. Record actual background/sample size/outcomes and assistance. Researcher adoption remains unvalidated unless actual researchers used it.
7. Inspect keyboard navigation, accessible chart alternatives, focus, source links, long labels, missing data, responsive layout, and honest loading/error/save states. Report actual visual inspection, not inferred appearance.
8. Produce docs/TEST_REPORT.md with commit, commands, results, live-provider status, actual measurements, failures, exclusions, source manifest IDs, and unresolved limits. Mark unperformed checks not run. Submit minimal actionable issues to module owners.

## Verification focus

The report must let the coordinator distinguish code checks, stubbed protocol tests, actual provider calls, real-input accuracy, and real-user usability. Never convert a planned benchmark into a claimed result.

## Start and coordination

Read AGENTS.md, docs/PRODUCT_SPEC.md, docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/DESIGN.md, docs/VALIDATION.md, and docs/DELIVERY_PLAN.md. Inspect the actual repository and coordinator's committed foundation before editing. If shared contracts are not yet committed, tell the coordinator what you need and work only on independent reconnaissance/owned empty/error states; do not invent conflicting contracts.

Use an isolated worktree when available. Use your assigned port/storage/database namespace, not another agent's environment. Preserve .env.local and all user work. Ask the coordinator for dependency, contract, root styling, route, or migration changes; do not compete over shared files. Implement real behavior inside owned modules and return typed integration seams to the coordinator.

## Completion report

Return changed paths, behavior implemented, exact commands/checks actually run and results, real-provider/data-test status, unresolved limits, contract/dependency requests, and integration instructions. Do not claim a live service was tested if it was not. Continue until your assigned scope is complete or a specific external dependency genuinely blocks it.

