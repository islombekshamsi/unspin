#!/usr/bin/env bash
# Nightly UNSPIN backup: PostgreSQL dump + filesystem blob archive, 14-day local retention.
# Usage (root cron): 15 3 * * * /opt/unspin/app/deployment/scripts/backup.sh
# Reads DATABASE_URL and UNSPIN_STORAGE_ROOT from /etc/unspin/unspin.env. Copy the output
# directory off-instance with your own tooling; a backup on the same disk is not a backup.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/unspin/unspin.env}"
OUT="${BACKUP_DIR:-/var/backups/unspin}"
KEEP_DAYS="${KEEP_DAYS:-14}"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${DATABASE_URL:?DATABASE_URL is not set}"
umask 077
mkdir -p "$OUT"
ts="$(date -u +%Y%m%dT%H%M%SZ)"

pg_dump --format=custom --no-owner --file="$OUT/db-$ts.dump" "$DATABASE_URL"

if [ "${UNSPIN_STORAGE_MODE:-filesystem}" = "filesystem" ] && [ -n "${UNSPIN_STORAGE_ROOT:-}" ]; then
  root="$(realpath "$UNSPIN_STORAGE_ROOT")"
  tar -C "$(dirname "$root")" -czf "$OUT/blobs-$ts.tar.gz" "$(basename "$root")"
fi

find "$OUT" -type f \( -name 'db-*.dump' -o -name 'blobs-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "backup ok $ts"
