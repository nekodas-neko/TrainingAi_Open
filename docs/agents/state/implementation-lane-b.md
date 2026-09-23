# Implementation Agent (B) — baton

**Updated:** 2026-09-23 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-136 (LB-135 filed 2026-09-23). ⚠ The grep counts THIS LINE, so it reads one high —
check the journal too and take what the grep returns, not +1.

## Now

Handing the IA mockup back to Orchestrator (LB-135). Six PRs merged today; #1481 was the last.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** Read it on `main`; do
not cut a branch until there is something to commit, or the stop-hook flags a scratch branch.

**⚠ RV-117 and RV-118 (`health-ia-merge`) CARRY THE SAME BROKEN GATE as RV-119 — see LB-135.** All
three say "Owner gate SATISFIED … mockup shown at 384 px dark … Build to it", and the mockup is not
in the repo. Do not invent the layout and do not re-ask what he already answered: re-make the
mockup, SAVE IT under `docs/design/`, get the yes. Read the gate line before planning either.

**BF-177's plan (scratchpad) is AMENDED** — LB-128 shipped as #1456, so its premise that
`cachedFetch` gates `onError` on `cached === null` may no longer hold. Re-read `lib/sqlite/cache.ts`.

## Blocked / owed

- **LB-134 is the owner's** — branch protection. Until he rules, read the `Tests` job CONCLUSION
  before every merge.
- **LB-129 shipped an UNPROVEN fix** (`Gate: device`). Do not reopen it here: `pnpm dev` compiles
  cold chunks on demand and `next start` cannot reach the local Postgres, so the harness provably
  cannot discriminate. The entry has the measurement.
- Device checks are DV's to RUN, mine to RECORD. A FAILED check comes BACK as work.

## Claimed paths — none.

## Lessons that cost real time

- **⚠ THE MERGE CALL IS NOT A GATE HERE.** #1467 squash-merged with `Tests` FAILING and returned
  success. Confirm run completed+success, or `list_workflow_jobs` once for the five required jobs.
  `get_job_logs failed_only:true` returning 0 only rules OUT failure. E2E is advisory (~31 min).
- **⚠ AFTER ANY BACKLOG MERGE, DIFF THE FULL HEADING SET** — #1481's merge silently deleted RV-117
  and RV-118; I checked only the three headings I had edited and shipped the loss. Every line of
  `diff <(git show origin/main:docs/implementation-backlog.md|grep '^### '|sort) <(grep '^### '
  docs/implementation-backlog.md|sort)` must be an add or remove you INTENDED.
- **READ THE ENTRY BEFORE ACTING ON ITS TITLE.** I told the owner the IA batches needed mockups; the
  entries already recorded the gate as satisfied. One read would have saved re-asking him.
- **`main` is red more often than anyone notices** — twice on 2026-09-23, both a pinned snapshot
  stale against its change. Reproduce at `origin/main` in a worktree before assuming it is yours.
- **A gate's exit code must be read DIRECTLY — not through a `tail` pipe, not via `$?` after a
  pipe, not via `&&` into `git commit` (an intervening `echo` succeeds, so a RED gate still
  commits).** All three shipped a red push today. Gates to a file, read the code, THEN commit.
- **A spec that passes with AND without the fix is worse than none** — delete it. Always control-run.
- **`npx tsc --noEmit` DOES NOT typecheck test files** — Build runs `check-test-typecheck.js`.
- **Match a call/tag to its balanced close, never a line window** — four false findings in one day.
- **`total_count: 0` is a stale base or a conflicted PR, never slow CI.** Re-merge and push.
