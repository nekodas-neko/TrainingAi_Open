#!/usr/bin/env bash
# Datestamped pg_dump of DATABASE_URL. See docs/runbooks/db-backup-restore.md.
# Usage: DATABASE_URL=... ./scripts/db-backup.sh [output-dir]
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set." >&2
  exit 1
fi

OUT_DIR="${1:-.}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT_FILE="$OUT_DIR/trainingai-backup-$STAMP.dump"

pg_dump --format=custom --file="$OUT_FILE" "$DATABASE_URL"
echo "Backup written to $OUT_FILE"
