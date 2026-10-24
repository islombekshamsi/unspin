# Phase 2 walkthrough notes

Real browser pass on 2026-10-24 against `npx next dev -p 3106` (Node v24.13.0, Next.js 16.4.3) in worktree `qa/phase2-walkthrough` at `ae8f8b8416fc8ed0881db0bd1feda5d2c9336b5b`. Persistence: memory, not durable. Jobs: inline. Gemini: not configured (`GET /api/v1/health` reported `gemini.configured=false`). No `.env.local` in this worktree. `GEMINI_API_KEY` was not read.

Driver: system Google Chrome via `playwright-core` (`evaluation/results/walkthrough/drive.mjs`). File inputs were set with the committed files, not invented bytes. Screenshots 01–19 are from that pass. DOM/accessibility text was the source of truth; several PNGs show overlapping glyphs (Geist + capture). Copied page text was single and correct.

## Inputs

| File | sha256 | size |
| --- | --- | --- |
| `evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv` | `a653f1af074f08f25f7b51e97d4b93b2e5485269a10a11df167e73e5cd7e6fad` | 29804 |
| `evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png` | `1f3bf74036f52d1b77068eb1a8fb143410297fb3a5848e3961a3b0247212d5af` | 71023 |

## What I clicked and saw

1. **Landing (1280×800).** Heading “Drop your data. Make it usable.” Upload dropzone with limits 10 MB / 20,000 rows / 64 columns / 200 PDF pages / 40 MP. Honest notes: Gemini not configured; work is session-only.
2. **Upload NOAA CSV.** Filename `noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv · 29.1 KB`. URL became `?source=src_182cb9e947c74eba8afcd209a976870b`.
3. **Select.** After preview: 670 records, 8 columns, UTF-8. Suggested comma, skip 40 leading `#` records (lines 1–40), header on record 41. First data preview row `1974, 5, 1974.3750, 333.19, …`. Skip field showed 40. Clicked **Use this selection**.
4. **Import.** Source panel: “40 leading records skipped · record 41 is the header.” Clicked **Import data**. Workspace opened with 629 rows × 8 columns, `?dataset=ds_cc213be43ca84bc19a55fa8f5acd91e9`. “Imported with the local parser.” “Covers the whole selection.” Review: 5032 unreviewed.
5. **Inspect.** Selected the `average` cell on source row 1. Source: Record 1, line 42, `average` 333.19 marked linked. Inspector: origin “Parsed from the file”, review “Not reviewed”, provenance “CSV record 1, line 42, field 4” / “Precise location”.
6. **Correct.** Edit `333.19` → `333.20`, note “Walkthrough check against NOAA source text.” Preview showed Before → after `"333.19" number → "333.20" number`. Save created **v2**. Review became 5031 unreviewed / 1 corrected. Grid showed `333.20` with an edit marker. Source text stayed `333.19`. Inspector added “Your edit”.
7. **Chart.** Default line chart plotted month, decimal date, average, deseasonalized, ndays, sdev against year, Y range 0–2000 (Include zero). CO₂ values sit in a thin band. Keyboard navigator: Enter selected series “month”, source row 2, x=1974, y=6. Source jumped to Record 2, line 43, with `year` and `month` linked. One grid row `aria-selected=true`.
8. **Undo.** History: “Undo last change” → confirm Undo. Header became **v1 (current)** of 2; review 5032 unreviewed / 0 corrected; first `average` back to `333.19`.
9. **Export.** Whole dataset, CSV + manifest + exact JSON. Dialog: “Downloaded noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv, …manifest.json, …data.json.” Also “5032 of 5032 values have not been reviewed.”
10. **Refresh.** Same `?source=` / `?dataset=` URL. Dataset, grid (629 rows, first row 1974 / 5 / 333.19), and chart came back. Source panel said **“No selection has been made for this file yet.”**
11. **Failed extraction.** Started over. Uploaded the NOAA PNG (69.4 KB, 800×600). Set region Left 8%, Top 1%, Width 84%, Height 12% → “Selected 672 × 72 px at (64, 6)”. That band is the title “Recent Monthly Mean CO₂ at Mauna Loa Observatory”. **Use this selection.** Extract screen: “Only the selected region: a 672 × 72 px crop… The rest of the image is not sent.” **Start extraction** disabled. Copy: “Unavailable: chart and PDF extraction is not configured on this server.” URL had `?source=` only. No dataset invented. Source still shown. Cancel of a live Gemini job was not possible without a configured key.
12. **375×812 landing.** Same empty-state copy and upload control. Limits wrap. Gemini and session notes still present below the fold.

## Export files (this pass)

| File | sha256 | bytes |
| --- | --- | --- |
| `…excerpt.csv` | `44138e6ce91a4af1fbef295815f4914334e85bb9b5d050ff06faaab197b9be35` | 28527 |
| `…excerpt.data.json` | `b48176053d3235ba7fae580939f1616e5bbb76cbbde38b2aa84ea7f5ebac791e` | 2442258 |
| `…excerpt.manifest.json` | `4bf6a925667ea00f8926990fe5f7a6606c2127108b1d10b50b61070b1f677085` | 2866035 |

CSV kept in `downloads/`. The two JSON files were hashed then deleted from the tree (2.4–2.8 MiB). CSV has UTF-8 BOM, header `year,month,decimal date,average,…`, first row `1974,5,1974.3750,333.19,330.22,13,0.31,0.16`, 629 data rows (630 lines including header). Manifest: `local_parser`, source sha256 matches the committed input, `skipLeadingRecords: 40`, `headerRecordCount: 1`, coverage `complete_selection`, exported v1 (`333.19` after undo). data.json first `average` cell: rawText/currentValue `"333.19"`, origin `parsed`, review `unreviewed`. No key or connection-string patterns in the export files.

## Refresh and failed extraction

Both were real. Refresh restored source+dataset IDs and the grid; it dropped the stored CSV selection from the Source panel. Failed extraction used a title-only crop of the committed NOAA PNG; Gemini was not configured, so the job never started. Cancel of a running job was not exercised.
