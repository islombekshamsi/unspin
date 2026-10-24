# Evaluation inputs and references

Real, permitted inputs for UNSPIN tests and benchmark tasks. Nothing in this directory was generated to look like a published figure, and no value was invented or altered.

## Layout

| Path | Contents |
| --- | --- |
| `sources.json` | Manifest: one record per candidate input (schema below). |
| `inputs/` | Committed input files. Only files with an explicit reuse statement are committed. |
| `reference/` | Author-provided reference values copied verbatim from inputs by `scripts/extract-references.mjs`. |
| `fetch-inputs.sh` | Downloads non-committed inputs to `.data/qa/` (gitignored) and verifies sha256. |
| `PROTOCOL.md` | Comparison protocol: UNSPIN vs general AI workflow vs WebPlotDigitizer. |
| `results/TEMPLATE.csv` | Recording template for each task attempt. `results/` holds only measured runs. |

Setup: `bash evaluation/fetch-inputs.sh` (add `--include-permission-unknown` to also fetch the Treasury, Census, and co-branded NOAA files for local inspection only).

## `sources.json` record schema

| Field | Meaning |
| --- | --- |
| `id` | Stable manifest id cited by tests, results, and `docs/TEST_REPORT.md`. |
| `kind` | `chart_image`, `pdf_figure`, `csv`, `xlsx`, `xls_legacy`. |
| `role` | `easy_case`, `difficult_case`, `deterministic_path_and_reference`, `negative_case_unsupported_format`, `*_candidate` (not yet usable). |
| `domain` | `scientific` or `financial`. |
| `title`, `publisher`, `authors`, `versionOrDate` | Bibliographic identity. |
| `sourceUrl`, `liveUrlAlias`, `isLiveUrl` | Where the bytes came from. A live URL can change; the sha256 pins the version actually used. |
| `license.basis` | The statement or rule relied on, quoted where possible. |
| `license.redistributionPermitted` | `yes` / `no` / `unknown`. `unknown` means not committed. |
| `license.automatedOrModelProcessingPermitted` | `yes` / `no` / `unknown`. `unknown` means excluded from model evaluation. |
| `files[]` | `path`, `committed`, `sha256` of exact bytes, `byteSize`, and `derivation` for excerpts. |
| `selection` | Exact page/region/sheet/range used. PDF pages are one-indexed. |
| `chart` | Chart type, axes, series, and which series are scored. |
| `reference.origin` | `author_provided` (publisher's own numbers), `digitized` (someone else's estimate; must be disclosed), or `none`. |
| `reference.file`, `reference.derivation` | Where reference values live and how they were copied. |
| `units`, `timeRange` | Units/currency/percent representation and covered period. |
| `parserChallenges` | Real properties of the file a correct parser must handle. |
| `exclusions` | What is not scored and why. |
| `observedSourceIssues` | Genuine inconsistencies in the published source, recorded as observed. |

## Current inputs (accessed 2026-10-24)

| id | kind | role | redistribution | committed |
| --- | --- | --- | --- | --- |
| `noaa-co2-trend-mlo-2026-10` | chart_image | easy case, scientific | yes | yes |
| `noaa-co2-mm-mlo-csv-2026-10` | csv | deterministic + reference, scientific | yes (NOAA-era excerpt) | excerpt only |
| `noaa-co2-data-mlo-full-2026-10` | chart_image | difficult candidate | unknown | no; excluded |
| `eia-steo-2026-10-pdf-p15-wti` | pdf_figure | difficult case, financial | yes | no (7.2 MB; fetched) |
| `eia-steo-2026-10-xlsx` | xlsx | deterministic + reference, financial | yes | yes |
| `eia-pet-weekly-gasoline-xls` | xls_legacy | negative case (must be rejected) | yes | yes |
| `treasury-par-yield-2024-csv` | csv | deterministic candidate, financial | unknown | no |
| `census-mrts-sales-xlsx` | xlsx | difficult candidate, financial | unknown | no |

Not acquired: CBO and BLS (both returned HTTP 403 to automated requests) and a CC-BY journal figure with source data (not searched in phase 1).

## Rules

- Do not add an input without a manifest record. Do not commit an input whose redistribution is `unknown`.
- Do not score against `digitized` references without labelling them as such in results.
- Do not edit inputs. Excerpts must be byte-verbatim line subsets with the derivation command recorded.
- Synthetic byte strings in `tests/` exist only for protocol/edge cases (for example, a spreadsheet formula string or an oversized upload). They are never presented as real data or used for accuracy claims.
