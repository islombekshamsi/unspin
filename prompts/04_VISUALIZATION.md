# Specialist agent: Interactive visualization and financial/scientific comparison

## Your goal

Build the distinctive live chart canvas with correct numerical behavior and source-linked interactions.

## Exclusive ownership

src/features/visualization/**, src/features/comparison/**

## Work to implement

1. Implement client-only lazy-loaded bar, line, and scatter rendering through an adapter to the agreed plotting library. Do not add another chart stack without coordinator agreement.
2. Let users choose actual x/y columns and series. Preserve numeric/date spacing, source units, negative values, missing gaps, and valid log domains. Text categories remain explicit categorical spacing.
3. Use point IDs mapped to stable dataset version/row/cell IDs. Hover/selection synchronizes with the grid and source through the shared event contract. Sorting/filtering must not change which original observation a point refers to.
4. Add presentation controls for baseline, bounds, series visibility, and supported scale types. Underlying values and dataset version must not change during presentation animation. Display actual selected bounds/units.
5. Distinguish a reconstructed plot from the original source presentation. Do not claim every nonzero baseline is wrong. Do not make normal data look misleading to create a dramatic demo.
6. Add a comparison workflow that checks units, currency, period, aggregation level, and measure type. If compatibility is unknown, explain what is needed. Explicit indexing/normalization shows the base observation/formula. Price change is not automatically total return.
7. Provide an accessible data-table alternative, keyboard point selection, reduced-motion support, responsive sizing, long-label handling, and useful empty/nonnumeric/invalid-domain states.
8. Chart requests are bounded. Disclose actual sampling/aggregation and retain source-row mapping. Full dataset export must not be replaced by sampled plotted points.

## Verification focus

Check irregular numeric/date x spacing, negative/zero and missing values, log-domain rejection, linked-selection stability, axis animation invariance, explicit compatibility warnings, mobile layout, keyboard access, and bundle loading.

## Start and coordination

Read AGENTS.md, docs/PRODUCT_SPEC.md, docs/ARCHITECTURE.md, docs/CONTRACTS.md, docs/DESIGN.md, docs/VALIDATION.md, and docs/DELIVERY_PLAN.md. Inspect the actual repository and coordinator's committed foundation before editing. If shared contracts are not yet committed, tell the coordinator what you need and work only on independent reconnaissance/owned empty/error states; do not invent conflicting contracts.

Use an isolated worktree when available. Use your assigned port/storage/database namespace, not another agent's environment. Preserve .env.local and all user work. Ask the coordinator for dependency, contract, root styling, route, or migration changes; do not compete over shared files. Implement real behavior inside owned modules and return typed integration seams to the coordinator.

## Completion report

Return changed paths, behavior implemented, exact commands/checks actually run and results, real-provider/data-test status, unresolved limits, contract/dependency requests, and integration instructions. Do not claim a live service was tested if it was not. Continue until your assigned scope is complete or a specific external dependency genuinely blocks it.

