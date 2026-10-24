# Demo (about two minutes)

Use a production server (`nvm use` then `npm run build` && `npm run start`). This walkthrough was rehearsed on 2026-10-24 against `http://localhost:3108` with the committed NOAA monthly CO₂ CSV. It is not a student study and not an accuracy claim.

## 0:00–0:15 — the inconvenient file

Open the app. The heading is: **Turn charts and spreadsheets into data you can inspect, correct, and reuse.** Drop `evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv` (29.1 KB). Spreadsheets stay on this server; they are not sent to a model.

## 0:15–0:40 — choose the data, not the comments

The preview reports 670 records, 8 columns, UTF-8. Suggested: comma, **skip 40 leading `#` records**, header on record 41. First data row is `1974, 5, 1974.3750, 333.19, …`. Use this selection, then **Import data**. The workspace opens at 629 rows × 8 columns. Source line 42 is record 1.

If you instead show a previously imported file, say so. Do not present a cached Gemini result as a live extraction.

## 0:40–1:20 — inspect, correct, watch the chart

The default chart is a **line of `average` against `decimal date`**, Y fitted around 322–438 ppm, not every numeric column against year from zero. The note states that decimal date is the file’s own column, not a newly computed date.

Select the first `average` cell (`333.19`). The source panel marks record 1, line 42. Edit to `333.20`, preview, save (version 2). The grid shows the edit; the source text stays `333.19`. The chart point updates. Undo last change; version 1 is current again with `333.19`.

## 1:20–1:50 — export the version you see

Export CSV, exact JSON, and the provenance manifest. After undo, the CSV first row is `1974,5,1974.3750,333.19,…` (sha256 `44138e6ce91a4af1fbef295815f4914334e85bb9b5d050ff06faaab197b9be35`). Refresh the same `?source=&dataset=` URL: the skipped-comment selection and the one-series chart return.

## 1:50–2:00 — what this is not

Work is session-only unless PostgreSQL durability is actually configured and tested. Chart extraction is a separate, slower path (165.9 s on this NOAA figure; 73/136 points within 0.2 ppm of the publisher file — see `docs/EVALUATION.md`). There is no public URL, no account wall, and no quota. Do not claim scientific validation from one image.

## Track evidence (same product)

| Track | What this demo actually shows |
| --- | --- |
| Data reuse | A government CSV becomes a versioned table + export with locators |
| Financial / research understanding | Values stay linked to the source line; edits are reversible and labelled |
| AI for science | Not this two-minute CSV path. A separate consented Gemini run on the NOAA Mauna Loa chart is scored in `docs/EVALUATION.md` (one image; 73/136 within 0.2 ppm) |
