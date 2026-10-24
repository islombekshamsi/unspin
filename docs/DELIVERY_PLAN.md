# Parallel delivery plan

## Foundation owner: coordinator

Before specialist implementation: inspect the actual project, preserve changes, establish shared runtime schemas and IDs, create API/service boundaries, define central limits/environment flags, choose the shared plotting/grid dependencies, create design tokens, and agree on storage interfaces. Commit this checkpoint.

Only the coordinator updates shared dependencies, root layout, global CSS, shared contracts, migrations, and orchestration. Specialist branches start from this same checkpoint. They do not separately scaffold Next apps.

## Workstreams and handoffs

| Workstream | Can start after | Produces | Needed by |
| --- | --- | --- | --- |
| Ingestion | Source/selection contracts | Validated sources, previews, selected regions/sheets, structured parsed data | Extraction, grid, integration |
| Extraction | Selected-source + dataset/provenance contracts | Gemini provider adapter, candidate dataset, semantic validation | Grid, chart, integration |
| Cleaning/grid | Dataset/cell/operation contracts | Editable review grid, findings, preview/apply/undo logic | Workspace, exports, evaluation |
| Visualization | Dataset/selection/chart-query contracts | Linked chart canvas, scale controls, comparison checks | Workspace and demos |
| Infrastructure | Repository/job/identity contracts | Storage, jobs, authorized persistence, exports, deployment | Integrated save/share/export flow |
| QA | Contracts and first available real modules | Source manifest, meaningful tests, benchmarks, browser/accessibility report | Every gate |

Parallelism does not eliminate dependencies. UI agents can implement empty/error states and typed adapters before real extraction exists. They cannot ship fake datasets as an interim backend. Service tests may isolate boundaries with explicit protocol stubs, excluded from production/demo paths.

## Suggested execution waves

### Wave A — first usable slice

Ingestion handles CSV and one image selection. Extraction implements the real Gemini image path. Grid implements review/edit selection and direct CSV export. Visualization implements one correct linked bar/line chart. Infrastructure provides the minimal repository interface and local-only session storage path with honest status. QA acquires permitted inputs and checks contracts/real errors.

Coordinator integrates early, so upload-to-export works before each agent expands its module. Do not wait until every feature is “finished” to discover API incompatibility.

### Wave B — correctness and source linkage

Add exact raw/current separation, provenance inspector, true source anchors where supported, missingness/units handling, explicit transformations, before/after previews, immutable versions, undo, and complete export manifest. Confirm geometry and chart selection are linked to stable IDs after sorting/filtering.

This wave earns the source-verification claim. Attractive output alone does not pass it.

### Wave C — broader real inputs and durable workspaces

Add PDF page/crop selection and XLSX sheet/range selection. Enable PostgreSQL-backed persistence, durable jobs, refresh recovery, dataset version concurrency, guest/account ownership, deletion, and authenticated saved workspaces. Move from prototype in-memory flows without pretending the earlier state was durable.

### Wave D — comparison, evaluation, and polish

Add compatible-series comparison, full visualization controls, keyboard workflows, mobile panel transitions, export refinements, and measured real-data/user validation. Fix issues discovered in actual task completion before adding new panels.

### Wave E — sponsor extensions and deployment

Integrate Vultr deployment and Auth0 account flows. Tiger Data can host the PostgreSQL data layer; meaningful dated-series queries require genuine time data. ElevenLabs narration reads a structured, reviewed/computed explanation rather than improvising numbers. Register an eligible domain if desired. Follow actual Cursor/Grok Bot raffle requirements and record genuine usage.

Any optional integration that breaks the primary workflow remains disabled until fixed. Do not block the finished core indefinitely on an optional sponsor feature.

## Merge protocol

1. Each agent identifies owned files, upstream contract version, and expected inputs/outputs before coding.
2. Use one isolated worktree/branch per agent when available. Configure distinct web ports, storage directories, and database namespaces for tests.
3. Agents submit small cohesive changes with their completion report. The coordinator reviews contract and dependency impact.
4. Merge ingestion/extraction service changes with actual consumers rather than collecting disconnected components. Integrate persistence incrementally through the frozen repository interfaces.
5. Run relevant type/build/logic/access checks after a merge. Run the browser vertical slice after changes to orchestration or selection flow.
6. Fix integration regressions before starting another expansion wave. Update docs/STATUS.md and hand off newly available capabilities.

If worktrees or branches are unavailable, enforce file ownership in the shared tree and coordinate before any shared edit. Never run simultaneous npm installs or conflicting migrations against one working copy.

## Scope gates

The full specification is the destination; a demo must show the supported subset honestly. A user can accept scoped coverage without accepting fake functionality. If time is constrained, retain image/CSV → review/correct → chart/export, provenance, proper errors, and one measured real task. Defer advanced PDF geometry, realtime collaboration, automatic corpus processing, narration, and elaborate deployment orchestration before removing data integrity or the working backend.

## End-of-build handoff

Deliver exact setup/run commands for this repository; real configured capabilities; actual tests and measurements; documented unsupported inputs; secret-free environment example; source/license manifest; deployment status; and a short real demo script. Record a completed real session as a fallback only with participant/data permission. No staged or precomputed success is acceptable.
