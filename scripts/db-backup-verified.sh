#!/usr/bin/env bash
# Take one backup of DATABASE_URL, prove it restores, and encrypt it. Run by
# .github/workflows/db-backup.yml before every release and once a week (#2867); restoring one is in
# docs/runbooks/db-backup-restore.md.
#
#   DATABASE_URL  the database to back up. Only read: pg_dump and one count.
#   SCRATCH_URL   an EMPTY throwaway database the dump is restored into as the check
#   RECIPIENTS    one or more age public keys (age1…), one per line
#   OUT_DIR       where the encrypted file is written
#   LABEL         names the file: a release version, "weekly" or "manual"
#   PG_BIN        optional: the directory holding the client tools of the server's major version
#
# A backup nobody has restored is a file, not a backup, so the plaintext dump is restored into
# SCRATCH_URL before anything else happens to it and a failed or empty restore fails the run. Only
# the encrypted copy leaves this machine: the repository is public, so anyone signed in to GitHub
# can download its workflow artifacts, and only the holder of a recipient's private key can open one.
set -euo pipefail
: "${DATABASE_URL:?}" "${SCRATCH_URL:?}" "${RECIPIENTS:?}" "${OUT_DIR:?}" "${LABEL:?}"

tool() { if [ -n "${PG_BIN:-}" ]; then echo "$PG_BIN/$1"; else echo "$1"; fi; }
PG_DUMP="$(tool pg_dump)"; PG_RESTORE="$(tool pg_restore)"; PSQL="$(tool psql)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAMP="$(date -u +%Y%m%dT%H%MZ)"
NAME="trainingai-$LABEL-$STAMP.dump.age"

# Checked here so a pasted typo reads as a sentence, not as an age stack trace.
printf '%s\n' "$RECIPIENTS" | sed 's/[[:space:]]//g' | grep -v '^$' > "$WORK/recipients" || true
if [ ! -s "$WORK/recipients" ] || grep -qvE '^age1[0-9a-z]{58}$' "$WORK/recipients"; then
  echo "::error::BACKUP_AGE_RECIPIENT must be one or more age public keys (age1…, 62 characters), one per line."
  exit 1
fi

# The restore writes, so it must only ever land in an empty database. This is what stops a
# mis-set SCRATCH_URL from restoring on top of production.
if [ "$SCRATCH_URL" = "$DATABASE_URL" ]; then
  echo "::error::SCRATCH_URL is the database being backed up. It must be an empty throwaway database."
  exit 1
fi
USER_TABLES="select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema')"
if [ "$("$PSQL" "$SCRATCH_URL" -XAtc "$USER_TABLES")" != "0" ]; then
  echo "::error::SCRATCH_URL already has tables. Refusing to restore into it."
  exit 1
fi

echo "Taking the dump…"
"$PG_DUMP" --format=custom --file="$WORK/backup.dump" "$DATABASE_URL"
DUMP_BYTES="$(stat -c %s "$WORK/backup.dump")"
# A table appears twice in the list, as `TABLE` (its definition) and `TABLE DATA` (its rows).
DUMP_TABLES="$("$PG_RESTORE" --list "$WORK/backup.dump" | awk '$4 == "TABLE" && $5 != "DATA"' | wc -l)"
SOURCE_MIGRATIONS="$("$PSQL" "$DATABASE_URL" -XAtc 'select count(*) from schema_migrations')"

echo "Restoring it into the scratch database…"
# Owners and grants are left out: the scratch server has none of production's roles, and whether
# the data comes back is the question. They stay in the dump for a real restore.
if ! "$PG_RESTORE" --no-owner --no-privileges --exit-on-error --dbname="$SCRATCH_URL" \
    "$WORK/backup.dump" 2> "$WORK/restore.log"; then
  echo "::error::The dump did not restore into an empty database, so it is not a usable backup."
  tail -20 "$WORK/restore.log"
  exit 1
fi

RESTORED_TABLES="$("$PSQL" "$SCRATCH_URL" -XAtc "$USER_TABLES")"
RESTORED_MIGRATIONS="$("$PSQL" "$SCRATCH_URL" -XAtc 'select count(*) from schema_migrations')"
RESTORED_ROWS="$("$PSQL" "$SCRATCH_URL" -XAtc "
  select coalesce(sum((xpath('/row/n/text()',
           query_to_xml(format('select count(*) as n from %I.%I', schemaname, tablename), false, true, '')
         ))[1]::text::bigint), 0)
  from pg_tables where schemaname not in ('pg_catalog', 'information_schema')")"

problems=()
[ "$DUMP_TABLES" -gt 0 ] || problems+=("the dump lists no tables")
[ "$RESTORED_TABLES" = "$DUMP_TABLES" ] || problems+=("the dump lists $DUMP_TABLES tables but $RESTORED_TABLES came back")
[ "$RESTORED_MIGRATIONS" = "$SOURCE_MIGRATIONS" ] || problems+=("schema_migrations has $SOURCE_MIGRATIONS rows at the source but $RESTORED_MIGRATIONS came back")
[ "$RESTORED_ROWS" -gt 0 ] || problems+=("no rows came back")
if [ "${#problems[@]}" -gt 0 ]; then
  for p in "${problems[@]}"; do echo "::error::Restore check failed: $p."; done
  exit 1
fi

mkdir -p "$OUT_DIR"
age --encrypt --recipients-file "$WORK/recipients" --output "$OUT_DIR/$NAME" "$WORK/backup.dump"

SUMMARY="Backup \`$NAME\`: $DUMP_TABLES tables and $RESTORED_ROWS rows restored cleanly into an empty database; dump $(numfmt --to=iec "$DUMP_BYTES")B, encrypted to $(wc -l < "$WORK/recipients") key(s)."
echo "$SUMMARY"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "name=$NAME" >> "$GITHUB_OUTPUT"; fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$SUMMARY" >> "$GITHUB_STEP_SUMMARY"; fi
