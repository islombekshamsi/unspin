# Prepared demo guide

The landing page now has an **Import mode** selector above the upload dropzone. Pick a mode first, then upload the exact supplied file:

- **Finance** → `g19.pdf`: seven tables from all three pages of the Federal Reserve consumer-credit release, plus seven prepared findings. Covers seasonally adjusted growth/flows/balances, commercial-bank APRs, finance-company auto-loan terms, and unadjusted balances/flows by holder.
- **Academic / student life** → `FI-Supporting-Materials-07-17-25.pdf`: five student-life tables and seven prepared findings. Pages 54, 63, 66, 67 and 69 cover University Park tuition, student-initiated fees, residence/apartment rates and room/meal-package history. Other sections of the 70-page packet are not included.
- **Research** → `penguins.csv`: all 344 rows and eight fields, plus six prepared findings (species counts, missingness, species-specific means, and pairwise-complete flipper/mass correlation). Numeric measurements retain mm/g; NA stays missing. Species-specific saved views are included. The initial chart is a flipper-length/body-mass scatter plot.
- **Live import** keeps the normal workflow for any supported file. It does not substitute prepared data.

## What to show

1. Select a mode and upload the matching file. File contents are checked with SHA-256, not just the filename. Another file is rejected for that prepared mode; choose Live import instead.
2. The Overview opens the prepared report. Use **Prepared table** to switch datasets. Chart axes/series start with compatible comparisons and remain editable.
3. Click **Inspect source evidence**. PDF findings open the relevant page/boxes; CSV findings retain record/line/field references. Findings always point to their original prepared snapshot, including after edits.
4. Use Data to inspect/edit values; corrections use the existing version/history/undo path. Source bytes remain in private durable storage.
5. For the PDF demos, acknowledge the declared table subset before using data/graph export. Preparation does not pretend to cover the entire source page/document.
6. Optional live Gemini analysis is still separate and requires its normal external-processing confirmation. Prepared findings are labelled **not live AI**.

Finance: August is preliminary; several preceding observations are revised. Annual, quarterly and monthly observations, annualized growth/flows, seasonally adjusted and unadjusted values stay separate. The release is the uploaded August 2026 publication, not a live market update or personalized financial advice.

Academic: the July 2025 packet labels 2026–27 values proposed/projected. Do not present them as current approved tuition or payable bills. Keep annual, semester, per-credit and per-person rates distinct. Repeated program labels include residency and undergraduate/graduate context.

Research: sample counts are not population estimates. Pearson r = 0.8712 uses 342 pairwise-complete records; pooled correlation does not establish causation. No numeric score is invented for categorical fields.

## Verification

- `scripts/prepare-demo-data.py` reads the three local sources and generates server-only manifests. It is offline preparation, not live extraction. App use does not depend on the original Downloads paths; users upload the matching file.
- `scripts/audit-demo-data.py` independently checks source hashes, PDF numeric source boxes/strings, numeric normalization, missing markers, every CSV field, and distinct tuition categories.
- Audit: finance **741** cells/markers, **76** missing; academic **578**, **6** missing; research **2,752** fields, **19** missing. **Zero numeric mismatches** against the uploaded sources' embedded text/CSV within these selected tables. This does not measure Gemini accuracy, or verify the publications' underlying truth. See `evaluation/results/prepared-demo/source-audit.json`.
- Focused suites: **77 passing tests** (prepared manifests, incorrect-file/source-blob rejection, ownership, ingestion, dataset operations, stored chart settings).
- Browser: exact uploads accepted in the corresponding modes; finance source evidence opened July/August values; academic cross-table evidence opened the student-fee schedule on page 63; research opened a numeric scatter plot and Adelie filtering retained its axes, with 151 nonmissing plotted observations.
- Repeated preparation returned the same final dataset IDs in the development database. Prepared tables retain independent original snapshots and normal edit/export behavior.

No Auth0, deployment, cloud storage, public access, or paid services were enabled for these demos. No live-model speed/accuracy improvement is claimed.

## Numeric typing outside prepared mode

Generic CSV/XLSX imports now recognize columns containing canonical numbers, safe whitespace/plus/leading-decimal notation, and numeric NA/N/A markers. Exact decimal strings and original raw text remain separate. Leading-zero identifiers, currency/percent/ambiguous locale formats, and genuinely mixed text columns are not silently coerced. An all-NA column has insufficient evidence to infer a numeric type. Existing saved datasets are not retroactively rewritten; reimport or explicitly parse a selected column in Review.

### Build status

TypeScript and focused ESLint checks pass for the added demo code. The production build was attempted with both bundled compilers: Turbopack fails starting a CSS helper (`Operation not permitted` binding a local port), and the supported Webpack fallback reaches compilation but fails on the existing `pdfjs-dist/build/pdf.worker.min.mjs` ESM/external-package configuration in `pdf-client.ts`. Neither production build is recorded as passed. The running :3000 development app and browser demo flows were verified. The existing worker was restarted with the existing .env.local configuration to load generic numeric inference changes; no credentials were printed or changed.
