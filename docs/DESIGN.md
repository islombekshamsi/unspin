# Interface and interaction specification

## Direction

Build a calm, editorial scientific workspace with a distinctive visual identity. Use a warm near-white canvas, dark ink typography, fine neutral rules, and one strong teal accent. Source estimates/review states may use amber; reserve red for actionable failures. Do not rely on color alone. Typography, spacing, real data, and interaction should carry the product rather than generic gradients or ornamental charts.

The home page is short. The workspace is the product. No pricing section, testimonials, fabricated metrics, sponsor carousel, or marketing scroll is needed.

## Design tokens and shared components

Coordinator owns the shared token and global CSS layer. Define color, spacing, typography, border, radius, shadow, and motion tokens before agents build panels. Use a compact, readable UI font already available in the project or self-host an appropriately licensed font. Do not introduce a production dependency on an unavailable external font service.

Common primitives: Button, IconButton, Panel, Badge, Tooltip, EmptyState, ErrorState, Dialog, Disclosure, SegmentedControl, ProgressStatus, Select, NumericInput, FileDropzone. Each includes keyboard/focus and disabled/loading behavior. Avoid separate component libraries inside each agent's folder.

## Upload state

Wordmark UNSPIN; one-line product promise; one upload surface. Show accepted formats and actual configured size limits. The file picker button is keyboard accessible. Drag/drop is an enhancement. Invalid input produces a useful inline message without erasing a previously valid source.

After upload, show the actual filename/size and selection controls. Consent/disclosure appears before Gemini processing and accurately states whether only a crop or the whole file will be sent. Provide the same action in plain button form; no gesture-only crop workflow.

## Workspace geometry

Desktop: compact top bar; source panel at left; visualization panel at right; resizable/collapsible grid below or in a dedicated lower pane. The quality panel is a right-side drawer. Leave enough width for actual chart labels and values; avoid squeezing every panel into tiny cards.

Top bar contains dataset title, honest saving state, dataset/version selector, history, export, and optional account controls. Core exploration never requires signing in first.

At narrower widths, switch Source / Data / Chart tabs rather than scaling the full desktop canvas down. Retain selection across tabs. Scrolling tables must not make the entire page unusable on a phone.

## First result

Bring the selected source and candidate chart into view together. Show a short status such as “Extracted estimates — review against the source” when appropriate. Show row/column counts computed from the actual dataset. Do not display a confidence score, verified badge, or “clean” status without a defensible meaning.

The primary next action is inspecting the data, not choosing among ten chart templates. Small instructional hints should explain the interaction once, e.g. selecting a point links it to the table/source. Hints must not cover actual data.

## The signature interaction

Hover/select an actual point → highlight its row/cell → reveal original/raw/current values and the best available source reference. Selecting the grid works in reverse. Precise source highlights require real coordinates; page-only references get page navigation and an explicit label.

Offer keyboard selection and a text description of the selected point. Respect reduced motion. During an axis/presentation transition, interpolate the rendering while holding the underlying dataset version fixed. Values/units remain visible and the chosen bounds are labelled. Do not fabricate a dramatic “before” chart from ordinary data just to make the animation impressive.

## Grid and cleaning interaction

Differentiate raw value, typed interpretation, and current edited value in the cell inspector. Editing is direct and reversible. A review checkbox is an explicit user action, not an automated model judgment. Model-hinted source references receive different treatment from parser-derived or user-confirmed references.

Cleaning findings list the observed issue, affected count, affected rows, and proposed operation. Selecting one opens actual before/after values. Apply and Cancel are explicit. Removing rows or imputing values must never happen invisibly through a “fix all” magic button.

Filter and sort are view changes until the user explicitly exports that scope. Clearly distinguish current view export from whole dataset export. Loading states preserve the user's scroll and selected cells where possible.

## Error and unavailable states

Design and implement empty upload, invalid file, unsupported sheet, encrypted PDF, no readable table, partial extraction, missing Gemini config, quota limit, timeout, stale version conflict, save failure, cancelled job, missing source, and revoked share states. Preserve recoverable work. Never replace a failure with a generic success card or prefilled data.

## Accessibility and performance

Semantic landmarks and labels; visible focus; keyboard crop alternative; keyboard grid navigation; accessible chart table; sufficient contrast; clear non-color review indicators; reduced-motion preference. Avoid a screen-reader announcement on every streamed row. Announce major processing outcomes.

Virtualize/paginate large grids, query bounded plotting data, and lazy-load plotting/PDF modules. A real performance trace is better evidence than a decorative “instant” claim. Never show fake percent progress while waiting for a model response.

## Visual QA

Inspect upload and workspace at desktop and mobile widths with real permitted input. Check long filenames, long category labels, negative values, missing cells, multiple series, many columns, and genuine errors. Capture only non-sensitive internal verification screenshots; do not ship screenshots of private sources. Judge the UI by task clarity and working controls, not just a hero screenshot.
