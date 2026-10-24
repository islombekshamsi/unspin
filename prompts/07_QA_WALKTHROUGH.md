# Specialist: Phase 2 browser walkthrough

You own `tests/**`, `evaluation/results/walkthrough*`, and the walkthrough section of `docs/TEST_REPORT.md`. Do not edit `src/**`, `package.json`, or another specialist's result files (`evaluation/results/T1*`, `evaluation/scripts/score-noaa*`).

## Goal

One complete merged-app walkthrough in a real browser. Individual panel checks do not count.

Use a **real permitted input**. Prefer the committed NOAA CO₂ monthly CSV:

`evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv`

(US government work; skip 40 leading `#` records when the UI suggests it.)

For the **failed extraction**, use a title-only crop of `evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png` (or cancel a live Gemini job). Do not invent files.

## Required path

On **your** server only (`npx next dev -p 3106`, Node 24: `export PATH=$HOME/.nvm/versions/node/v24.13.0/bin:$PATH`). Do not use port 3000.

1. Landing empty state.
2. Upload → select → extract → inspect (cell + source) → correct one value (preview, then Save) → chart (click a point; confirm grid/source highlight) → undo → export CSV+JSON+manifest.
3. Refresh the page. Confirm `?source=` / `?dataset=` restore the same workspace, or record the honest lost-state if memory mode wiped it.
4. Failed extraction: title-only crop or Cancel. Confirm the source is still there, the stage text is real (not a fake %), cancel works, and a failure does not invent a dataset.

Also try desktop (~1280) and one phone width (375).

## Honesty

No invented timings, screenshots of stubs, or “looks fine.” Write what you clicked, what you saw, and what broke. Do not score Gemini accuracy (another agent owns that).

## Report

Update `docs/TEST_REPORT.md` with a **Phase 2 walkthrough** section: commit SHA, port, persistence mode, file hashes, pass/fail per step, defects with owner paths. Put notes/screenshots under `evaluation/results/walkthrough/`.

Return: changed paths; steps actually run; defects; commands/results; whether refresh and failed extraction were real.
