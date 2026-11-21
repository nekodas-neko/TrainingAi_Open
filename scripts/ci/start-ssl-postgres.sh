#!/usr/bin/env bash
# #3933. A throwaway Postgres 16 in Docker with SSL on, for the route smoke against a production
# build. `next start` runs with NODE_ENV=production, which turns pool SSL on
# (`lib/data/postgres/client.ts`), so the plain Postgres the dev smoke uses refuses it. The guard
# stays as it is; the database grows SSL instead. The certificate is self-signed and lives only as
# long as the container (the pool sets `rejectUnauthorized: false`, as on Railway).
#
#   PG_PORT       host port (default 5434, clear of the local dev database on 5433)
#   PG_DB         database name (default trainingai_smoke)
#   PG_CONTAINER  container name (default trainingai-ssl-postgres); an old one is replaced
#
#   scripts/ci/start-ssl-postgres.sh
#
# Prints the DATABASE_URL to use. Plain connections are still accepted, so `migrate.js` and `psql`
# work against it unchanged. Stop it with `docker rm -f "$PG_CONTAINER"`.
set -euo pipefail

PG_PORT="${PG_PORT:-5434}"
PG_DB="${PG_DB:-trainingai_smoke}"
PG_CONTAINER="${PG_CONTAINER:-trainingai-ssl-postgres}"

certs="$(mktemp -d)"
openssl req -new -x509 -days 2 -nodes -subj "/CN=localhost" \
  -keyout "$certs/server.key" -out "$certs/server.crt" 2>/dev/null
chmod 600 "$certs/server.key"

docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
# The key must be owned by the server's user and unreadable by others, or Postgres refuses to start.
# The image's entrypoint runs as root before it drops to `postgres`, so it copies and chowns here.
docker run -d --name "$PG_CONTAINER" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB="$PG_DB" \
  -p "$PG_PORT:5432" \
  -v "$certs:/certs:ro" \
  --entrypoint bash postgres:16 -c '
    install -o postgres -g postgres -m 600 /certs/server.key /var/lib/postgresql/server.key
    install -o postgres -g postgres -m 644 /certs/server.crt /var/lib/postgresql/server.crt
    exec docker-entrypoint.sh postgres -c ssl=on \
      -c ssl_cert_file=/var/lib/postgresql/server.crt -c ssl_key_file=/var/lib/postgresql/server.key
  ' >/dev/null

url="postgresql://postgres:postgres@localhost:$PG_PORT/$PG_DB"
for _ in $(seq 1 60); do
  # `sslmode=require` so "ready" means "ready over SSL", the way the production pool connects.
  if psql "$url?sslmode=require" -tAc 'SHOW ssl' 2>/dev/null | grep -qx on; then
    echo "$url"
    exit 0
  fi
  sleep 1
done
echo "Postgres with SSL did not come up within a minute" >&2
docker logs "$PG_CONTAINER" >&2 || true
exit 1
