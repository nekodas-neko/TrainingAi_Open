# Shared by scripts/db-backup-verified.sh and scripts/db-restore.sh. Source it; don't run it.
#
# Expects PG_RESTORE, PSQL and WORK (a private temp directory) to be set by the caller.
# Backups are locked with one passphrase (the `BACKUP_PASSPHRASE` secret, also kept in the owner's
# password manager), so the restore workflow can open them without anyone at a keyboard (owner,
# 13 Oct 2026: "I just need you to be able to restore from backup if needed").

USER_TABLES_SQL="select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema')"

# Every write in these scripts that is not production lands in a database this has checked is empty,
# which is what stops a mis-set scratch URL from restoring on top of production.
require_empty_db() {
  local url="$1" name="$2"
  if [ "$("$PSQL" "$url" -XAtc "$USER_TABLES_SQL")" != "0" ]; then
    echo "::error::$name already has tables. Refusing to restore into it."
    return 1
  fi
}

require_passphrase() {
  if [ "${#PASSPHRASE}" -lt 20 ]; then
    echo "::error::BACKUP_PASSPHRASE must be at least 20 characters. Generate a long one in a password manager."
    return 1
  fi
  ( umask 077; printf '%s' "$PASSPHRASE" > "$WORK/passphrase" )
  export GNUPGHOME="$WORK/gnupg"
  [ -d "$GNUPGHOME" ] || mkdir -m 700 "$GNUPGHOME"
}

lock_file() {
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$WORK/passphrase" \
    --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 \
    --compress-algo none --output "$2" "$1"
}

# Fails on a wrong passphrase and on a file that was altered or cut short.
unlock_file() {
  if ! gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$WORK/passphrase" \
      --output "$2" --decrypt "$1" 2> "$WORK/gpg.log"; then
    echo "::error::The backup could not be opened: a wrong BACKUP_PASSPHRASE, or a damaged file."
    tail -3 "$WORK/gpg.log"
    return 1
  fi
}

# Restore a plaintext dump into an empty database and check it all came back. Owners and grants are
# left out because a scratch server has none of production's roles; whether the data returns is the
# question. Sets CHECK_TABLES, CHECK_ROWS and CHECK_MIGRATIONS.
restore_and_check() {
  local dump="$1" scratch="$2" expected_migrations="${3:-}"
  local dump_tables
  require_empty_db "$scratch" "The scratch database" || return 1
  # A table appears twice in the list, as `TABLE` (its definition) and `TABLE DATA` (its rows).
  dump_tables="$("$PG_RESTORE" --list "$dump" | awk '$4 == "TABLE" && $5 != "DATA"' | wc -l)"
  if ! "$PG_RESTORE" --no-owner --no-privileges --exit-on-error --dbname="$scratch" "$dump" \
      2> "$WORK/restore.log"; then
    echo "::error::The dump did not restore into an empty database, so it is not a usable backup."
    tail -20 "$WORK/restore.log"
    return 1
  fi
  CHECK_TABLES="$("$PSQL" "$scratch" -XAtc "$USER_TABLES_SQL")"
  CHECK_MIGRATIONS="$("$PSQL" "$scratch" -XAtc 'select count(*) from schema_migrations')"
  CHECK_ROWS="$("$PSQL" "$scratch" -XAtc "
    select coalesce(sum((xpath('/row/n/text()',
             query_to_xml(format('select count(*) as n from %I.%I', schemaname, tablename), false, true, '')
           ))[1]::text::bigint), 0)
    from pg_tables where schemaname not in ('pg_catalog', 'information_schema')")"

  local problems=()
  [ "$dump_tables" -gt 0 ] || problems+=("the dump lists no tables")
  [ "$CHECK_TABLES" = "$dump_tables" ] || problems+=("the dump lists $dump_tables tables but $CHECK_TABLES came back")
  if [ -n "$expected_migrations" ] && [ "$CHECK_MIGRATIONS" != "$expected_migrations" ]; then
    problems+=("schema_migrations has $expected_migrations rows at the source but $CHECK_MIGRATIONS came back")
  fi
  [ "$CHECK_ROWS" -gt 0 ] || problems+=("no rows came back")
  if [ "${#problems[@]}" -gt 0 ]; then
    for p in "${problems[@]}"; do echo "::error::Restore check failed: $p."; done
    return 1
  fi
}
