#!/bin/bash
set -euo pipefail

# Only needed in Claude Code on the web — local dev environments already have
# their own dependencies and Postgres setup.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

if [ ! -d node_modules ] || [ ! -d node_modules/.pnpm ]; then
  pnpm install
fi

bash scripts/local-db/setup.sh

# The container pre-sets DATABASE_URL/DATABASE_SSL to the production Railway
# values. process.env takes priority over .env.local in Next.js, so these
# must be unset for the dev server to pick up the local DB instead.
{
  echo "unset DATABASE_URL"
  echo "unset DATABASE_SSL"
} >> "$CLAUDE_ENV_FILE"
