# Product specification

## Positioning

UNSPIN is a source-linked data workspace. Users bring a document, chart, or spreadsheet and leave with a dataset they have inspected, a visualization they can manipulate, and an export they can reuse.

The research task is not “summarize a paper.” It is “recover these plotted/tabulated results and prepare them for reuse without losing their origin.” The financial task is not “tell me what to invest in.” It is “help me inspect the values behind this financial presentation and understand whether the comparison is appropriate.”

## People and accessible validation

- A student working with a real figure/table in their coursework or project.
- A researcher/reviewer extracting numerical results from published figures.
- A person examining their own financial file or a publicly available financial claim.

The builder may be the first real user if the task is genuine. Nearby student tests can establish usability. They do not establish adoption or validity for specialist research workflows. Keep that distinction in evaluation and pitches.

## First thirty seconds

Landing state: one strong title, one upload zone, supported types, and a concise explanation of what happens to the file. No fake dashboard behind the upload zone, stock statistics, waitlist, or forced login.

After selecting a source:

1. Recognize its actual type and validate it.
2. Show the source. CSV/XLSX offers sheet/header selection; PDFs offer page and region selection; images offer a crop.
3. Show a short scope statement, e.g. extraction is limited to the selected figure/table. Never imply that one selected region covers the whole paper.
4. The user starts processing with a clear external-processing disclosure when Gemini will be used.
5. The working workspace appears with the candidate result, provenance, quality flags, and a useful next action: inspect a cell or correct a value.

Do not promise a fixed processing time. Display actual job state. Progress percentages require measurable units such as pages completed; provider waiting time is indeterminate.

## Input behavior

### CSV

Deterministic parsing. Support quoted fields, escaped quotes, BOM, CRLF, embedded newlines, blank fields, Unicode, and an explicit delimiter choice. Suggest delimiter/header detection but show the decision before committing. Do not silently coerce dates, percentages, currencies, leading-zero identifiers, missing values, or large integers. Detect inconsistent field counts and report affected records.

### XLSX

List actual sheets and allow explicit selection. Show merged-cell and multi-header complications instead of inventing a rectangular meaning. Preserve displayed and underlying values when available. Never run spreadsheet formulas or macros. Cached formula results must be identified as cached; formula results without caches remain unavailable. Support XLSX first, and explicitly reject legacy XLS/XLSM until a reviewed implementation exists.

### PDF

Render thumbnails and let the user select one page/region. Use a self-hosted, version-matched PDF.js worker. Prefer a text/vector path when it actually preserves coordinates; otherwise pass only the selected raster region to the extraction adapter. Keep original PDF page coordinates and the crop transform. If a first checkpoint forwards a whole small PDF with a page hint, disclose this and do not call it a region-isolated implementation. The complete implementation sends the selected region.

### Chart image

Validate PNG/JPEG/WebP signatures, decode safely, handle image orientation, cap decoded pixel count, and preserve original dimensions. Let the user crop one chart/table. A clear source is more valuable than automatic extraction of every object in a page.

### Limits

Initial design targets: 10 MiB upload, 20,000 structured rows, 64 columns, one selected PDF region, and 250 AI-extracted rows per region. These are proposed guardrails, not achieved performance. Centralize them in config. Hard overflow is an honest error or an explicitly chosen smaller selection; no silent partial import.

## Main workspace

### Source panel

Original document/image or structured record view. Linked highlights show real source anchors. If only page/figure identification is available, navigate there and say that precise anchoring is unavailable. Never draw a fabricated bounding box because the model proposed coordinates.

### Editable grid

Virtualized/paginated rows with stable IDs. Cells expose original text, current typed value, units, origin, and review status. Sorting/filtering changes the view, not the saved dataset. Editing produces a new version or staged edit transaction; use explicit save/apply behavior. Keyboard support, focus retention, undo, and column controls are required.

### Quality/cleaning panel

Flag missing cells, duplicate records, inconsistent numeric representations, mixed units, ambiguous dates, and extraction ambiguities. A flag is a question for review, not proof of an error. Display affected rows and the precise suggested operation. Preview before/after results and row counts before applying anything substantive.

Initial operations: trim selected text cells, set an explicit missing-value rule, parse numbers with a chosen locale, rename a column, edit a cell, cast a selected column, remove explicitly selected rows, and remove exact duplicates after confirmation. Add unit conversion only through a reviewed conversion registry. A duplicate row may be a repeated real measurement; do not remove it by default.

### Visualization canvas

User selects x and y columns/series. Support bar, line, and scatter. Preserve numeric/date x spacing and axis semantics. Missing values produce gaps, not zeros or invented interpolation. Currency/percent units remain visible. Hover/select links to grid and actual source references. A table alternative is always available.

Presentation controls can compare baseline choices or scales while holding values constant. Explain that a zero baseline is often relevant to magnitude-encoded bars; it is not a universal correction for every line/log plot. Negative values, zero, and missingness must remain distinguishable.

### History and export

Every material edit/transform has an entry with actor, version, exact operation, changed cells/rows, and time. Original source and extraction are retained. Export current CSV and a provenance manifest first; add reproducible code and XLSX after the core path is tested. Exporting unreviewed/partial results remains possible only with clear status included in the manifest; never label them verified automatically.

## Comparing datasets

Users explicitly select compatible series. Display source, units, time period, aggregation, and whether values are price, total return, count, average, or another measure. Do not overlay unrelated currencies, normalize incompatible measures, forward-fill missing dates, or call price appreciation total investment return. Any indexing/normalization has a documented base observation and visible formula. If compatibility cannot be established, explain what must be supplied before comparison.

## Persistence

Store committed source metadata, datasets, versions, operations, and chart configuration independently of AI context. Refresh restores the actual saved workspace. Clearly show saving/failed-save state. If persistence is not configured, use an honest local-session state and make export available; do not claim cross-session recovery.

## Explicit exclusions from the first release

No universal scientific inference, raw-observation reconstruction from summary charts, general-purpose natural-language code execution, automated meta-analysis, portfolio advice, fraud classification, automatic publisher scraping, collaboration chat, native mobile app, or blockchain requirement. Extend only after the primary workflow is useful.
