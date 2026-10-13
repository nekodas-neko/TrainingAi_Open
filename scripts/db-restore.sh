#!/usr/bin/env bash
# Open a backup made by scripts/db-backup-verified.sh and restore it. Run by
# .github/workflows/db-restore.yml; the runbook is docs/runbooks/db-backup-restore.md.
#
#   BACKUP_FILE      the locked backup (trainingai-….dump.gpg)
#   PASSPHRASE       the BACKUP_PASSPHRASE secret
#   TARGET           "check" or "production"
#   SCRATCH_URL      an EMPTY throwaway database. `check` restores into it; `production` uses it
#                    to check the backup first
#   PRE_SCRATCH_URL  production only: a second empty database, for the pre-restore backup's check
#   DATABASE_URL     production only: the live database, backed up first and then replaced
#   CONFIRM          production only: must be exactly "restore production"
#   OUT_DIR          production only: where the pre-restore backup is written
#   PG_BIN           optional: the directory holding the client tools of the server's major version
#
# `check` touches nothing but the scratch database. `production` replaces the live data with the
# backup's: everything written since that backup was taken is lost, including ring data the ring
# will not send again. That makes it confirm-first, every time, on the owner's say-so (CLAUDE.md),
# and it is why production is backed up again just before it is overwritten.
set -euo pipefail
: "${BACKUP_FILE:?}" "${PASSPHRASE:?}" "${TARGET:?}" "${SCRATCH_URL:?}"

tool() { if [ -n "${PG_BIN:-}" ]; then echo "$PG_BIN/$1"; else echo "$1"; fi; }
PG_RESTORE="$(tool pg_restore)"; PSQL="$(tool psql)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# shellcheck source=scripts/db-backup-lib.sh
. "$(dirname "$0")/db-backup-lib.sh"

summary() {
  echo "$1"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$1" >> "$GITHUB_STEP_SUMMARY"; fi
}

case "$TARGET" in
  check) ;;
  production)
    : "${DATABASE_URL:?}" "${PRE_SCRATCH_URL:?}" "${OUT_DIR:?}"
    if [ "${CONFIRM:-}" != "restore production" ]; then
      echo "::error::Replacing production needs confirm set to exactly: restore production"
      exit 1
    fi
    for url in "$SCRATCH_URL" "$PRE_SCRATCH_URL"; do
      if [ "$url" = "$DATABASE_URL" ]; then
        echo "::error::A scratch database is the live one. Refusing."
        exit 1
      fi
    done
    ;;
  *) echo "::error::TARGET must be check or production, not '$TARGET'."; exit 1 ;;
esac

require_passphrase
NAME="$(basename "$BACKUP_FILE")"
unlock_file "$BACKUP_FILE" "$WORK/backup.dump"

echo "Restoring $NAME into the scratch database…"
restore_and_check "$WORK/backup.dump" "$SCRATCH_URL"
AS_OF="$("$PSQL" "$SCRATCH_URL" -XAtc "select coalesce(max(applied_at)::text, 'unknown') from schema_migrations")"
summary "Check: \`$NAME\` opens and restores: $CHECK_TABLES tables, $CHECK_ROWS rows, $CHECK_MIGRATIONS migrations (newest applied $AS_OF)."
[ "$TARGET" = production ] || exit 0

echo "Backing up production as it is now, so this restore can be undone…"
DATABASE_URL="$DATABASE_URL" SCRATCH_URL="$PRE_SCRATCH_URL" PASSPHRASE="$PASSPHRASE" \
  OUT_DIR="$OUT_DIR" LABEL=pre-restore GITHUB_OUTPUT='' GITHUB_STEP_SUMMARY='' \
  "$(dirname "$0")/db-backup-verified.sh"

echo "Replacing production with $NAME…"
# One transaction: if any statement fails, or the job is cancelled or times out, production is left
# exactly as it was. It waits for the app's in-flight queries, and the app's requests wait for it.
# (A lock_timeout can't shorten that wait: every dump opens with `SET lock_timeout = 0`.)
if ! "$PG_RESTORE" --clean --if-exists --single-transaction \
    --exit-on-error --dbname="$DATABASE_URL" "$WORK/backup.dump" 2> "$WORK/prod-restore.log"; then
  echo "::error::The restore into production failed and was rolled back; production is unchanged."
  tail -20 "$WORK/prod-restore.log"
  exit 1
fi
LIVE_MIGRATIONS="$("$PSQL" "$DATABASE_URL" -XAtc 'select count(*) from schema_migrations')"
summary "Production now holds \`$NAME\` ($LIVE_MIGRATIONS migrations recorded). The backup taken just before is the \`trainingai-pre-restore-…\` artifact on this run. Restart the app next: Release with rollback_to set to the current tag."
