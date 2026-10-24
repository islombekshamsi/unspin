# Verification, evidence, and release gates

## Claims we can and cannot make

Existing evidence supports a real workflow: researchers recover numerical data from published figures, and existing digitizers/AI tools already serve it. No current evidence proves that UNSPIN is faster, more accurate, more useful, or preferred. Those are hypotheses until measured.

Schema-valid JSON is not numerical validation. A model confidence number is not a calibrated error bound. A source overlay is not proof that the model read the correct series. A user review marker is not scientific peer review. Every claim in the UI/pitch should respect these boundaries.

## Real-data manifest

Before adding any evaluation/demo input, record:

- Source URL or owner-consented local source identifier.
- Authors/title/date or dataset publisher/version.
- License/permission and whether automated/model processing is permitted.
- Figure/table/sheet/page/range used.
- Where independently known numeric reference values come from.
- Whether those reference values are author-provided or themselves digitized.
- Units, series/category identity, time range, and supported chart type.
- SHA-256 of the exact input, date accessed, and any exclusions.

Prefer explicitly licensed published figures with author-provided CSV/supplementary numeric values. Public access alone does not establish reuse or model-processing permission. Never use a paper's own digitized estimates as independent ground truth without disclosure.

Do not construct an apparently published chart from invented values or plant a data error to create a demo. A chart generated from public data for a technical unit test is not an existing published figure and cannot be passed off as the real-person demo.

## Evaluation design

Use a small, disclosed set of genuine supported charts/tables initially. Include clear and difficult cases rather than picking only a dramatic success. Record actual failures and exclusions.

Compare the same task against:

1. A well-specified Gemini or ChatGPT extraction/analysis workflow.
2. WebPlotDigitizer or another appropriate established digitizer.
3. UNSPIN, including user verification and correction time.

Keep inputs, required output, reviewer access to source, and correctness criteria comparable. Do not compare an unreviewed UNSPIN answer with a meticulously reviewed baseline. Record model/version, prompt/settings, retries, date, and operator familiarity. Report extraction time and end-to-end time separately.

Metrics:
- Absolute numeric error in original units and, when appropriate, normalized error with its denominator defined.
- Missing/extra observations and wrong category/series associations.
- Unit, percent-representation, date, and scale interpretation mistakes.
- Time to a correct, verified exported dataset.
- Number and duration of correction actions.
- Whether unsupported/ambiguous inputs were disclosed rather than confidently filled.

Do not use an unlabeled numeric match metric alone: the right number assigned to the wrong series is still wrong. Do not divide by zero to compute relative error; disclose the alternative policy. Do not transfer results from generated benchmark charts to scientific figures without a separate evaluation.

## Real-user test

Find nearby students with an actual graph/table/file they need to use; ask them to show their last real attempt. The builder can be the first user of a genuine task. Get consent for processing and any recording. Do not solicit private financial/medical documents just to fill the demo.

Let each person try the core flow without a tutorial. Observe whether they understand the first screen, choose the intended region, catch a mistaken extraction, correct it, and export. Ask which existing tool/workaround they would otherwise use and why they would return. Prefer task behavior over “would you use this?” enthusiasm.

Record the actual number and background of participants, task/input, success definition, assistance, errors, and their own feedback. Student usability results do not establish adoption among researchers or financial decision quality.

## Meaningful automated checks

### Parsing and source mapping

Quoted multiline CSV fields, header choices, Unicode/BOM, inconsistent rows, leading-zero identifiers, large numbers, negative values, explicit missingness, ambiguous locale, percent strings, actual workbook sheets/cached formulas, PDF rotation/crop coordinate conversion, and oversized/invalid files.

### Extraction

Malformed JSON/schema, empty results, truncated output, row/column mismatches, missing/wrong references, unsupported plot types, provider quota/auth/timeout responses, partial coverage, no numeric observations, and semantic validation. Protocol stubs are allowed only as isolated tests, never as app fallbacks or evidence of real model performance.

### Transform and history

Original values survive edits; preview equals applied output; stale versions conflict; undo restores the exact old version; missing values are not changed to zero; duplicate removal is explicit; decimal/locale/date policies behave as documented; unsupported operations are rejected.

### Visualization

Correct numerical/date x spacing, missing-value gaps, valid log-domain behavior, negative/zero values, unit labels, stable-ID selection, sorting without selection corruption, actual source linking, compatibility checks, and transparent sampling/aggregation. Changing axes never changes values.

### Identity and exports

Guest/account ownership, cross-owner source/job/dataset/export denial, read-only/revoked shares, no secret in client bundles, no raw source content in logs, CSV formula handling, export full/view scope, and manifest lineage completeness.

### Browser workflow

Real permitted input upload → select → process → inspect → edit → chart → undo → export. Test missing provider configuration and quota failure without losing recoverable work. Test refresh recovery when persistence is enabled. Test keyboard navigation and at least desktop/mobile layouts.

## Release gates

Gate 0: repository preserved, secrets excluded, shared contracts committed, scripts work.

Gate 1: deterministic CSV plus real chart-image extraction works end to end with editable data and export. Do not count a stubbed provider as passing real extraction.

Gate 2: provenance and transform/history correctness; no silent meaning changes; source and data remain linked after edits/sorts.

Gate 3: PDF/XLSX source selection and durable persistence meet their documented subset and recoverable failure behavior.

Gate 4: real-input benchmark and usability sessions completed, or clearly labelled not yet run. Claims reflect only observed results. A lack of improved verification time is a reason to revise the interaction, not invent success metrics.

Gate 5: deployment/auth/share/accessibility checks and optional integrations actually tested. A public deployment requires cost/abuse protections.

## Test report format

docs/TEST_REPORT.md contains commit identifier, runtime, commands/results, real-provider test status, real source manifest IDs, measured outcomes, failures, unsupported cases, screenshots inspected, and unresolved limitations. Mark “not run” explicitly. Do not present estimated targets as achieved results.
