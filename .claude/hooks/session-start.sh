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

# LA-130: the container clones at a truncated depth, and a shallow clone costs a
# session silently. A fetch cannot deepen one, so `git merge origin/main` fails
# with "refusing to merge unrelated histories", GitHub reads the resulting PR as
# conflicted, and a conflicted PR is never given a workflow run — the symptom is
# `get_check_runs` returning `total_count: 0` forever while CI runs normally for
# every other branch. Four PRs were abandoned to that before the cause was found.
#
# One unshallow immunises the clone for good: measured, later fetches of tips it
# has never seen leave it whole. `--unshallow` fatals on an already-complete
# repository, hence the guard. Last and non-fatal on purpose — a slow or refused
# fetch must not cost the dependency install or the dev database above.
if [ -f .git/shallow ]; then
  git fetch --unshallow origin \
    || echo "session-start: unshallow failed — run 'git fetch --unshallow origin' before branching" >&2
fi
