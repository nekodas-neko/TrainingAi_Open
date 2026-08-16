#!/usr/bin/env bash
# Sets up (or starts) a local Postgres 16 instance for development/testing,
# applies all migrations, and seeds it with fake data on first run.
#
# Idempotent — safe to run on every session start.
set -euo pipefail

PGDATA=/var/lib/postgresql/local-dev
PGPORT=5433
DBNAME=trainingai_dev
LOGFILE=/var/log/postgresql/local-dev.log
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

mkdir -p "$(dirname "$LOGFILE")"
chown postgres:postgres "$(dirname "$LOGFILE")"

if [ ! -d "$PGDATA" ]; then
  echo "[local-db] Initializing new Postgres cluster at $PGDATA..."
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA --auth=trust" >/dev/null
fi

if ! su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA status" >/dev/null 2>&1; then
  echo "[local-db] Starting Postgres on port $PGPORT..."
  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -l $LOGFILE -o '-p $PGPORT -k /tmp' start" >/dev/null
fi

# Wait for readiness
for i in $(seq 1 20); do
  if su postgres -c "/usr/lib/postgresql/16/bin/pg_isready -p $PGPORT -h /tmp" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! su postgres -c "/usr/lib/postgresql/16/bin/psql -p $PGPORT -h /tmp -lqt" | cut -d'|' -f1 | grep -qw "$DBNAME"; then
  echo "[local-db] Creating database $DBNAME..."
  su postgres -c "/usr/lib/postgresql/16/bin/createdb -p $PGPORT -h /tmp $DBNAME"
  su postgres -c "/usr/lib/postgresql/16/bin/psql -p $PGPORT -h /tmp -c \"ALTER USER postgres PASSWORD 'postgres';\"" >/dev/null
fi

LOCAL_DATABASE_URL="postgresql://postgres:postgres@/$DBNAME?host=/tmp&port=$PGPORT"

echo "[local-db] Applying migrations..."
DATABASE_URL="$LOCAL_DATABASE_URL" node "$REPO_ROOT/scripts/local-db/migrate.js"

USER_COUNT=$(su postgres -c "/usr/lib/postgresql/16/bin/psql -p $PGPORT -h /tmp -d $DBNAME -tAc 'SELECT count(*) FROM users'" 2>/dev/null || echo 0)
if [ "$USER_COUNT" = "0" ]; then
  echo "[local-db] Seeding fake data..."
  su postgres -c "/usr/lib/postgresql/16/bin/psql -p $PGPORT -h /tmp -d $DBNAME -f $REPO_ROOT/scripts/local-db/seed.sql" >/dev/null
fi

# Write/update .env.local with the local DB connection string
ENV_FILE="$REPO_ROOT/.env.local"
touch "$ENV_FILE"
if grep -q "^DATABASE_URL=" "$ENV_FILE" 2>/dev/null; then
  ESCAPED_URL=$(printf '%s' "$LOCAL_DATABASE_URL" | sed 's/[&|]/\\&/g')
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$ESCAPED_URL|" "$ENV_FILE"
else
  echo "DATABASE_URL=$LOCAL_DATABASE_URL" >> "$ENV_FILE"
fi

echo "[local-db] Ready. DATABASE_URL=$LOCAL_DATABASE_URL"
