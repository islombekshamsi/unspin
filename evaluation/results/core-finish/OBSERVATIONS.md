# Core-finish browser observations

Production `npx next start -p 3108`, Node v24.13.0, Playwright Chrome headless, 2026-10-24. Driver: `evaluation/results/core-finish/drive.mjs`. Persistence: session only. 0 fail / 15 notes.

Gemini: the title-crop screen offered `gemini-3.8-flash` and a consent checkbox; Start stayed disabled without consent. The key was not printed. The title band was not submitted.

## NOAA CSV path

Landing heading matched “inspect, correct, and reuse.” Upload of the committed excerpt (29.1 KB) suggested skip 40, header on record 41, first preview `1974, 5, 1974.3750, 333.19`. Import: 629 × 8, source “40 leading records skipped · record 41 is the header.”

Default chart: one series `average`, x `decimal date`, line, Y ticks 322.027–437.593, include-zero not applied. Note: “X is the file’s decimal date column … not a newly computed date.” Extra numeric columns were in “Add a series”, not plotted.

Inspect linked `average` 333.19 on record 1 / line 42. Saved `333.20` as v2 (1 corrected). Keyboard navigator selected source row 2 (`332.20` / line 43). Undo restored v1 and `333.19`. Export wrote CSV + manifest + data.json (JSON hashed then deleted from the tree). Refresh kept `?source=` / `?dataset=` and the skipped-comment selection; it did **not** show “No selection has been made for this file yet.” Chart settings still showed `average` vs decimal date.

## Title-only PNG

Crop 8/1/84/12 % (672 × 72 px at title band). No `dataset=` in the URL. Start extraction disabled until the consent box is checked.
