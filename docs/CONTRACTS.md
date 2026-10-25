# Shared contracts — coordinator freezes before parallel work

This is a design contract, not executable TypeScript. The coordinator converts it into Zod schemas and inferred types under src/contracts/, validates it with specialists, and commits one authoritative version. No agent creates a competing shared interface.

## Conventions

- IDs are opaque server-generated strings. Stable row/column/cell IDs survive sorting and filtering.
- Time values are ISO 8601 UTC strings; document date columns retain an explicit parsing/timezone policy.
- Exact numeric values are decimal strings. Large integers and identifiers never silently round through Number.
- Unknown is null or a typed unavailable state, never a fabricated empty result or zero.
- Original source/raw values are immutable. Corrections and transformations create new versions.
- All API resources are implicitly scoped by server-derived identity; client owner/workspace IDs are not authorization.
- Every mutating dataset request supplies expectedVersionId. Stale state returns 409 with the current version ID and a recoverable UI path.

## Source and selection

Source:
- id, filename, mimeType, byteSize, sha256, createdAt.
- kind: pdf | image | csv | xlsx.
- pageCount and sheetNames when actually determined; otherwise null.
- processingDisclosure: local_parser | gemini_selected_region | gemini_whole_file.
- capabilities: preview/crop/selectSheet/textCoordinates booleans based on the implemented path.

SourceSelection:
- sourceId; kind: image_region | pdf_region | csv_records | xlsx_range.
- PDF pageNumber is one-indexed; page dimensions and rotation are recorded.
- image region uses normalized top-left x/y/width/height in [0,1], measured from the displayed, orientation-corrected source.
- Store original pixel/page coordinate transforms so selections can be reproduced.
- CSV specifies delimiter, header record count, selected columns, and explicit record interval when applicable.
- XLSX specifies actual sheet name and cell range/header policy.
- Include an optional bounded user hint to identify the intended figure/series, not an arbitrary instruction channel.

## Dataset and cells

Dataset:
- id, sourceSelectionId, title, description, createdAt, currentVersionId.
- extractionMethod: deterministic_parser | pdf_text | pdf_vector | vision_estimate | manual.
- coverage: complete_selection | partial_selection | uncertain.
- coverageNote explaining omissions and limits; required unless complete_selection.

DatasetVersion:
- id, datasetId, parentVersionId/null, createdAt, schemaVersion.
- columns, rowCount, operationId/null, unresolvedFindingCount.
- reviewSummary derived from actual cell/row review events; never a global scientific-validity score.

Column:
- id, label, semanticRole: category | x | y | uncertainty | identifier | other.
- dataType: text | decimal | date | datetime | boolean | unknown.
- unit/null, currency/null, percentRepresentation/null, datePolicy/null, sourceScale: linear | log | categorical | unknown.
- Label/type/unit changes are operations with history. Duplicate labels are permitted but cannot collide as IDs.

Row:
- id, sourceOrder, cells keyed by stable columnId.

Cell:
- id, rawText, currentValue: string | boolean | null.
- valueType and missingReason/null: blank | unreadable | not_reported | invalid | not_applicable.
- origin: parsed | transcribed | estimated | derived | user_edit.
- reviewStatus: unreviewed | accepted | corrected | unavailable.
- provenanceIds[], parentCellIds[] for derived values.
- notes[] for explicit ambiguity and interpretation.

Cell editing never erases the prior version/rawText. A reviewed derived value does not turn its estimated ancestors into exact observations.

## Provenance

Provenance:
- id, sourceId, sourceSelectionId, locatorType.
- locator types: pdf_box, image_box, pdf_page, figure_label, csv_record, xlsx_cell, user_edit, derived_operation.
- A box records its coordinate system and actual transform, not an unexplained array of floats.
- locatorOrigin: parser | model_hint | user_confirmed | operation.
- locatorAvailability: precise | region_only | page_only | unavailable.
- label, extractionMethod, createdAt.

Model-proposed boxes are hints until a legitimate geometric/source verification path supports them. UI styling must distinguish that state. When precision is unavailable, navigate to the page/region rather than pretending to highlight the exact data mark.

## Findings and proposed operations

QualityFinding:
- id, datasetVersionId, kind, severity: info | review | blocking.
- message, affectedRowIds[], affectedColumnIds[], affectedCellIds[].
- evidence: observable facts from the parser/source/values; not an unsupported accusation.
- suggestedOperation/null; dismissedByUser event when applicable.

TransformOperation is a discriminated allowlist:
- edit_cell(cellId, newValue, explicitType, note).
- rename_column(columnId, newLabel).
- trim_text(columnIds, optionalRowIds).
- parse_numeric(columnId, locale, groupingPolicy, percentPolicy, currencyPolicy, onFailure=keep_and_flag).
- parse_date(columnId, format, timezonePolicy, onFailure=keep_and_flag).
- mark_missing(columnId, explicitTokens, optionalRowIds).
- remove_selected_rows(rowIds).
- remove_exact_duplicates(columnIds, retainPolicy) after explicit review.
- convert_unit(columnId, registeredConversionId) once conversion support passes validation.

No eval, executable string, arbitrary SQL, model-supplied code, inferred deletion of outliers, automatic imputation, or unsupplied aggregation operation belongs in this contract.

TransformPreview:
- operation, baseVersionId, affectedCount, rowCountBefore/After.
- paginated actual before/after cell changes; warnings and precision/unit effects.
- previewId or deterministic operation hash bound to the same base version and operation.

Apply accepts the exact previewed operation/base version. If either changed, require a new preview. Undo selects a stored previous version. Redo/reapply is another explicit version transition; do not reconstruct history from UI state.

## Visualization

ChartConfig:
- id, datasetVersionIds[], kind: bar | line | scatter.
- xColumnId, series: stable seriesId + yColumnId + label + color + visibility.
- xScale, yScale: linear | log | category | date as applicable.
- baselinePolicy: include_zero | fit_data | explicit_bounds; explicit bounds are visible in the UI.
- normalization/null: base observation, formula, compatibility check status.
- missingPolicy: gaps (initial implementation).
- aggregation/null; sampling/null, including exact method/count when used.
- displayedUnits, filters, selection IDs, configVersion.

Chart queries return actual point IDs mapped to dataset version/row/cell IDs. Do not rely on a displayed point's array position for source linking. If sampling/aggregation occurs, disclose it and retain its source-row mapping. CSV export includes all requested rows, not merely points currently visible in the chart.

Selection event: { origin: grid | chart | source, datasetVersionId, rowIds, cellIds, provenanceIds }. Prevent event echo loops. Selecting a source region may match multiple points; do not arbitrarily designate one as verified.

## Job state

Job: id, sourceSelectionId, operationType (extraction | structured_parse | analysis), status, createdAt, startedAt/null, finishedAt/null, attemptCount, stage, measuredProgress/null, error/null, resultDatasetId/null, resultAnalysisId/null, analysis payload/null.

Statuses: queued → running → completed | failed | cancelled. cancellation_requested is a request flag while running. No completed state before the dataset commit succeeds. Failed attempts retain bounded failure metadata and do not fabricate a result.

## API surface

All endpoints below use /api/v1. Routes are thin coordinator-owned adapters calling specialist services. All file/dataset/job/export accesses enforce ownership. All responses have requestId and Cache-Control behavior appropriate to private data.

| Method/path | Purpose |
| --- | --- |
| GET /health | Configured capability booleans and readiness; no secrets/source contents |
| POST /sources | Validated multipart upload; returns Source and selection capabilities |
| GET /sources/:id | Authorized metadata |
| GET /sources/:id/content | Authorized preview/download with safe content disposition |
| POST /selections | Validate/store an explicit source selection |
| POST /extractions | Create an idempotent extraction job for the selection |
| GET /jobs/:id | Actual state; bounded polling hints |
| POST /jobs/:id/cancel | Best-effort cancellation request |
| GET /datasets/:id | Metadata, columns, version, coverage, quality summary |
| GET /datasets/:id/rows | versionId, cursor, limit, allowlisted sort/filter/search/preset; paginated rows |
| GET /datasets/:id/overview | Deterministic profile and fact catalog for a version/view |
| GET/POST /datasets/:id/views | List and save named display views (not dataset versions) |
| PATCH/DELETE /datasets/:id/views/:viewId | Rename, update spec, or delete a saved view |
| POST /datasets/:id/analysis/consent | Analysis consent, distinct from extraction consent |
| GET/POST /datasets/:id/analysis | List records or enqueue a grounded analysis job |
| GET /datasets/:id/analysis/:analysisId | One persisted analysis record |
| GET /datasets/:id/findings | Actual quality findings for a version |
| POST /datasets/:id/transforms/preview | Preview validated operation with expectedVersionId |
| POST /datasets/:id/transforms/apply | Apply exact previewed operation transactionally |
| POST /datasets/:id/restore | Restore a stored version using concurrency checks |
| GET /datasets/:id/history | Immutable committed operation/version history |
| POST /datasets/:id/chart-query | Bounded plotting payload plus point/source mapping |
| POST /datasets/:id/exports | Export selected version/format/scope and manifest |
| POST /datasets/:id/shares | Optional explicit read-only, expiring share creation |
| DELETE /shares/:id | Revoke authorized share |
| DELETE /sources/:id | Delete source and owned derivatives under documented retention rules |

The coordinator may initially expose a smaller subset to complete the vertical slice; unsupported endpoints must not return fabricated successful responses.

Error envelope: { error: { code, message, retryable, details? }, requestId }. Never expose provider payloads, stack traces, connection strings, storage keys, or uploaded source text.

Status mapping: 400 malformed input; 401 missing required identity; 403 unauthorized; 404 unavailable resource without cross-owner enumeration; 409 stale version; 413 configured size limit; 415 unsupported format; 422 extraction/semantic validation failure; 429 quota/rate limit; 502 provider failure; 503 capability not configured; 504 bounded timeout.

## Exports

CSV: selected committed data version, column labels/units, documented null/locale/precision policy. Prevent spreadsheet formula injection in text without altering legitimate negative numeric data. Keep an exact machine-readable JSON export if spreadsheet-oriented escaping changes representation.

Manifest: schemaVersion, source hash and permitted bibliographic metadata, source selection/crop transform, extraction method/model/version if available, original/current dataset versions, operations, provenance, review states, coverage/omissions, export scope/time, and software version. Exclude API keys, private storage URLs, unrelated user identity, and source contents not requested in the export.

Reproducible code: deterministically generated from supported stored operations and chart config. Code is delivered as a file; the server does not execute model-generated code. State prerequisites and any source input that the recipient must supply.


## Explicit values from prose (2026-10-25)

`CreateExtractionRequest.extractionMode` accepts `chart_table` (default) or `text`. Image/PDF source selections retain the optional mode. The server creates a separate immutable, owner-scoped selection for a different mode so previous chart jobs/datasets cannot be reused as prose results. Existing selections remain compatible.

Text mode uses `text-data-v1`, `contentKind=prose_data`, and the structured cell `sourceQuote`. Every present cell must be `transcribed`, have a quote, and its exact text must occur in that quote; numeric substring matches inside a larger value are rejected. At least one non-identifier numeric observation is required. This checks model consistency; it does not certify the quote against a PDF text layer. Source quotes are stored in cell notes and the selected region/page remains bound through provenance. Dataset extractionMethod remains `vision_estimate` because the pathway reads a raster image; individual cells retain `transcribed` origin and unreviewed status. UI labels the resulting chart as built from text.
