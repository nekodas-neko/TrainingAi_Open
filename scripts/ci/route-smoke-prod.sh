#!/usr/bin/env bash
# #3933. The route smoke (`scripts/ci/route-smoke.mjs`, #3919) against a production build: `next
# build` + `next start`, not `pnpm dev`. The two bundlers differ, and #3911's bug ("getRepository is
# not a function") was only ever seen on the dev one, so the dev smoke alone cannot say whether a
# production build has it. Run by the "Route smoke (production build)" workflow on pushes to `main`,
# and by the release test on the owner's machine (`docs/agents/prompts/release-test.md`).
#
# Needs, already in place:
#   DATABASE_URL  a Postgres that accepts SSL, with every migration applied and the seed loaded
#                 (`scripts/ci/start-ssl-postgres.sh`, `node scripts/local-db/migrate.js`,
#                 `psql "$DATABASE_URL" -f scripts/local-db/seed.sql`). NEVER production.
# Optional:
#   PORT          default 3200
#   AUTH_SECRET   default a throwaway: it signs cookies for a server that lives for this run only
#   SKIP_BUILD=1  reuse the `.next/` already built from this commit
#
# The model constants: production never falls back to the committed fixtures
# (`lib/oura-models/constants-delivery.ts`), so the fixtures are copied into the directory the
# loader reads at boot (`.oura-constants/`, where a deploy keeps its downloaded set) and removed
# again on exit. The guard is left as it is.
#
# Do not run this while `pnpm dev` is running on the same machine: `next build` alongside it runs
# out of memory.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point at an SSL-enabled, migrated and seeded local Postgres}"
case "$DATABASE_URL" in
  *localhost*|*127.0.0.1*|*host=/*) ;;
  *) echo "route-smoke-prod: DATABASE_URL is not a local database; refusing" >&2; exit 1 ;;
esac
PORT="${PORT:-3200}"
export AUTH_SECRET="${AUTH_SECRET:-route-smoke-prod-throwaway-secret}"
# 0 Gemini calls: no key, and the dev call budget at 0 (`lib/ai/dev-call-budget.ts`).
export GOOGLE_GENERATIVE_AI_API_KEY=''
export AI_DEV_DAILY_CALL_LIMIT=0
export NEXT_TELEMETRY_DISABLED=1

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
log="$(mktemp -t route-smoke-prod.XXXXXX.log)"
server_pid=""
copied_constants=""

cleanup() {
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  if [ -n "$copied_constants" ]; then rm -rf .oura-constants; fi
}
trap cleanup EXIT

if [ ! -f .oura-constants/MANIFEST.json ]; then
  mkdir -p .oura-constants
  cp lib/oura-models/__fixtures__/constants/* .oura-constants/
  copied_constants=1
  echo "copied $(ls .oura-constants | wc -l | tr -d ' ') fixture constant file(s) into .oura-constants/"
fi

if [ "${SKIP_BUILD:-}" != "1" ]; then
  pnpm build
fi

# `next start` sets NODE_ENV=production itself: pool SSL on, no fixture fallback, prod boot checks.
nohup pnpm start --port "$PORT" > "$log" 2>&1 &
server_pid=$!
started=$(date +%s)
up=""
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null --max-time 30 "http://localhost:$PORT/api/version"; then up=1; break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
  sleep 2
done
if [ -z "$up" ]; then
  echo "the production server did not answer /api/version"
  tail -80 "$log"
  exit 1
fi
echo "production server answered /api/version after $(( $(date +%s) - started ))s"

status=0
BASE_URL="http://localhost:$PORT" SERVER_LOG="$log" \
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci/route-smoke.mjs || status=$?
if [ "$status" -ne 0 ]; then
  echo
  echo "--- the production server's log (last 200 lines) ---"
  tail -200 "$log"
fi
exit "$status"
