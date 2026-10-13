#!/usr/bin/env bash
# Take one backup of DATABASE_URL, prove it restores, and lock it. Run by
# .github/workflows/db-backup.yml before every release and once a week (#2867); restoring one is
# scripts/db-restore.sh, through .github/workflows/db-restore.yml.
#
#   DATABASE_URL  the database to back up. Only read: pg_dump and one count.
#   SCRATCH_URL   an EMPTY throwaway database the dump is restored into as the check
#   PASSPHRASE    locks the file (the BACKUP_PASSPHRASE secret)
#   OUT_DIR       where the locked file is written
#   LABEL         names the file: a release version, "weekly", "manual" or "pre-restore"
#   PG_BIN        optional: the directory holding the client tools of the server's major version
#
# A backup nobody has restored is a file, not a backup, so the plaintext dump is restored into
# SCRATCH_URL before anything else happens to it, and a failed or empty restore fails the run. Only
# the locked copy leaves this machine: the repository is public, so anyone signed in to GitHub can
# download its workflow artifacts.
set -euo pipefail
: "${DATABASE_URL:?}" "${SCRATCH_URL:?}" "${PASSPHRASE:?}" "${OUT_DIR:?}" "${LABEL:?}"

tool() { if [ -n "${PG_BIN:-}" ]; then echo "$PG_BIN/$1"; else echo "$1"; fi; }
PG_DUMP="$(tool pg_dump)"; PG_RESTORE="$(tool pg_restore)"; PSQL="$(tool psql)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# shellcheck source=scripts/db-backup-lib.sh
. "$(dirname "$0")/db-backup-lib.sh"

NAME="trainingai-$LABEL-$(date -u +%Y%m%dT%H%MZ).dump.gpg"

require_passphrase
if [ "$SCRATCH_URL" = "$DATABASE_URL" ]; then
  echo "::error::SCRATCH_URL is the database being backed up. It must be an empty throwaway database."
  exit 1
fi
require_empty_db "$SCRATCH_URL" "SCRATCH_URL"

echo "Taking the dump…"
"$PG_DUMP" --format=custom --file="$WORK/backup.dump" "$DATABASE_URL"
DUMP_BYTES="$(stat -c %s "$WORK/backup.dump")"
SOURCE_MIGRATIONS="$("$PSQL" "$DATABASE_URL" -XAtc 'select count(*) from schema_migrations')"

echo "Restoring it into the scratch database…"
restore_and_check "$WORK/backup.dump" "$SCRATCH_URL" "$SOURCE_MIGRATIONS"

mkdir -p "$OUT_DIR"
lock_file "$WORK/backup.dump" "$OUT_DIR/$NAME"

SUMMARY="Backup \`$NAME\`: $CHECK_TABLES tables and $CHECK_ROWS rows restored cleanly into an empty database; dump $(numfmt --to=iec "$DUMP_BYTES")B."
echo "$SUMMARY"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "name=$NAME" >> "$GITHUB_OUTPUT"; fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$SUMMARY" >> "$GITHUB_STEP_SUMMARY"; fi
