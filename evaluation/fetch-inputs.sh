#!/usr/bin/env bash
# Downloads evaluation inputs that are NOT committed (size or unknown redistribution
# permission) into .data/qa/ (gitignored) and verifies each against the sha256 in
# evaluation/sources.json. A mismatch means the publisher regenerated a live file:
# the new bytes are kept under *.mismatch and must not be scored against the
# recorded references until the manifest is updated.
#
# Usage: bash evaluation/fetch-inputs.sh [--include-permission-unknown]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/.data/qa"
UA="Mozilla/5.0 (UNSPIN QA evaluation fetch)"
INCLUDE_UNKNOWN=0
[ "${1:-}" = "--include-permission-unknown" ] && INCLUDE_UNKNOWN=1
mkdir -p "$DEST"

sha() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }

status=0
fetch() {
  local id="$1" url="$2" out="$3" expected="$4"
  local target="$DEST/$out"
  if [ -f "$target" ] && [ "$(sha "$target")" = "$expected" ]; then
    echo "ok       $id ($out already present)"
    return
  fi
  local tmp="$target.part"
  if ! curl -fsSL -A "$UA" --max-time 120 -o "$tmp" "$url"; then
    echo "FAILED   $id: download error ($url)"; rm -f "$tmp"; status=1; return
  fi
  local got; got="$(sha "$tmp")"
  if [ "$got" = "$expected" ]; then
    mv "$tmp" "$target"; echo "ok       $id -> .data/qa/$out"
  else
    mv "$tmp" "$target.mismatch"
    echo "MISMATCH $id: expected $expected got $got (kept as .data/qa/$out.mismatch; live file changed)"
    status=1
  fi
}

# Permitted, not committed (size or live-file reference copy).
fetch eia-steo-2026-10-pdf-p15-wti "https://www.eia.gov/outlooks/steo/archives/oct26.pdf" oct26.pdf \
  741d247cffcae488208ad0c5e03966405283eec3ff6b830d02285cbe25b44fe6
fetch noaa-co2-mm-mlo-csv-2026-10 "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv" co2_mm_mlo.csv \
  d895fb5b4a59fb5e4cd98e69b7667fe5bef595c6581f630852b12cb41c07f675

if [ "$INCLUDE_UNKNOWN" = "1" ]; then
  echo "note: fetching inputs whose redistribution/processing permission is 'unknown' for local inspection only."
  fetch noaa-co2-data-mlo-full-2026-10 "https://gml.noaa.gov/webdata/ccgg/trends/co2_data_mlo.png" co2_data_mlo.png \
    401aafb9bf9e7830cf6fce5588bd95e2c8564d205244f2f6ae094fd7156a410f
  fetch treasury-par-yield-2024-csv \
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2024/all?type=daily_treasury_yield_curve&field_tdr_date_value=2024&page&_format=csv" \
    treasury_par_yield_2024.csv 6775840b76cd7fd41121f61d6f6c60184eca6b2ba49954ec7372c463cbeef34d
  fetch census-mrts-sales-xlsx "https://www.census.gov/retail/mrts/www/mrtssales92-present.xlsx" mrtssales92-present.xlsx \
    190d718b853613163d3e9c3b5fe4444966ac3a7d908b60f0526df8692ccb6119
fi

# Committed inputs: verify integrity in place.
while read -r expected rel; do
  if [ "$(sha "$ROOT/$rel")" = "$expected" ]; then echo "ok       committed $rel"; else echo "CHANGED  committed $rel"; status=1; fi
done <<'EOF'
1f3bf74036f52d1b77068eb1a8fb143410297fb3a5848e3961a3b0247212d5af evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png
a653f1af074f08f25f7b51e97d4b93b2e5485269a10a11df167e73e5cd7e6fad evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv
54989362410da4aff5673580396380c3a8f4f111fa6d01c6d4fab05ef90efbf4 evaluation/inputs/eia-steo-2026-10-base.xlsx
28e286b42e8ac505a904906fea66660601e3626208b34eb16715abe44c6c5bf2 evaluation/inputs/eia-pet-weekly-retail-gasoline-EMM_EPMR_PTE_NUS_DPGw.xls
EOF

exit $status
