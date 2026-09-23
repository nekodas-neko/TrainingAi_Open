# Implementation Agent (B) — baton

**Updated:** 2026-09-23 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-138 (LB-137 filed 2026-09-23) — ⚠ the grep counts THIS LINE, so take what it returns, not +1.

## Now

RV-120 shipped — deleted the `aiVolume` card, already superseded server-side. 7 PRs merged today.

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** Read it on `main`; do
not cut a branch until there is something to commit, or the stop-hook flags a scratch branch.

**RV-117/118/119 are `Lane: O` — leave them.** Their owner gate IS satisfied; the mockup lives in
the Orchestrator's chat and it is exporting it to `docs/design/`. Do not take them back, do not
re-ask him, do not re-make the mockup.

**BF-177's plan (scratchpad) is AMENDED** — LB-128 shipped as #1456, so its premise that
`cachedFetch` gates `onError` on `cached === null` may no longer hold. Re-read `lib/sqlite/cache.ts`.

## Blocked / owed

- **LB-134 is the owner's** — branch protection. Until he rules, read the `Tests` job CONCLUSION
  before every merge.
- **LB-129 shipped an UNPROVEN fix** (`Gate: device`) — do not reopen here; the harness provably
  cannot discriminate (dev compiles cold chunks; `next start` can't reach local PG). Entry has it.
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
- **A `docs/overview/` conflict is TWO FOLDS on one `history-<date>-folded-N.md`, and the archive
  PRE-EXISTS, so it conflicts as ordinary appended content.** Never splice: take origin/main's
  `docs/overview/` whole, then re-run `fold-journal-entries.js` once over the merged tree.
- **READ THE ENTRY BEFORE ACTING ON ITS TITLE, and the CODE before acting on the entry.** I told
  the owner the IA batches needed mockups (they did not), and RV-120's own comment promised a merge
  that `weekly-muscle-sets/route.ts` had already shipped. Both were one read away.
- **A gate's exit code must be read DIRECTLY — not through a `tail` pipe, not via `$?` after a
  pipe, not via `&&` into `git commit` (an intervening `echo` succeeds, so a RED gate still
  commits).** All three shipped a red push today. Gates to a file, read the code, THEN commit.
- **An auth-gated page never compiles from a dev-server GET** — `curl -L /health` follows to
  `/sign-in`, so only that compiles. `pnpm build` is what exercises the change; say so honestly.
- **A spec that passes with AND without the fix is worse than none** — delete it. Always control-run.
- **`npx tsc --noEmit` DOES NOT typecheck test files** — Build runs `check-test-typecheck.js`.
- **`total_count: 0` is a stale base or a conflicted PR, never slow CI.** Re-merge and push.
