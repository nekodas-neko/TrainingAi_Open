# Implementation Agent (B) — baton

**Updated:** 2026-09-23 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-135 (LB-134 filed 2026-09-23). ⚠ The grep counts THIS LINE, so it reads one high —
check the journal too and take what the grep returns, not +1.

## Now

RV-114 in flight (route transitions). Twelve shipped today; latest merged #1477 (LB-129).

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** It has disagreed with my
own note FOUR times in one day: entries land mid-PR and the top changes within one CI cycle.

After RV-114 the queue head is RV-115, then two batches (`home-ia-merge`, `health-ia-merge`) that
ship as ONE PR each.

**BF-177's plan (scratchpad) is AMENDED** — LB-128 shipped as #1456, so its premise that
`cachedFetch` gates `onError` on `cached === null` may no longer hold. Re-read `lib/sqlite/cache.ts`.

## Blocked / owed

- **LB-134 is the owner's, NOT mine** — branch protection. Until he rules, read the `Tests` job
  CONCLUSION before every merge.
- **LB-129 shipped an UNPROVEN fix** (`Gate: device`). Do not reopen it in the sandbox: the harness
  drives `pnpm dev`, which compiles cold chunks on demand, and `next start` cannot reach the local
  Postgres — so it provably cannot tell the bug from a dev artefact. The entry has the measurement.
- Device checks are DV's to RUN, mine to RECORD. A FAILED check comes BACK as work.

## Claimed paths — none.

## Lessons that cost real time

- **⚠ THE MERGE CALL IS NOT A GATE HERE.** #1467 squash-merged with `Tests` FAILING and returned
  success; `main` took a red commit. Confirm the conclusion first: run completed+success, or
  `list_workflow_jobs` once for the five required jobs. `get_job_logs failed_only:true` returning 0
  only rules OUT failure — an unfinished job also has none. E2E is advisory (~31 min).
- **`main` is red more often than anyone notices** — twice on 2026-09-23, both a pinned snapshot not
  updated by the change that invalidated it. When the suite fails, reproduce at `origin/main` in a
  worktree BEFORE assuming it is yours.
- **Another lane may be fixing the same thing right now** — three of mine were superseded mid-PR.
  Read `origin/main`'s version before claiming a fix; correct the entry if you already did.
- **NEVER pipe merge or gate output through `tail`, and never read `$?` through a pipe** — the pipe's
  status is not the script's. Both hid real failures today, one staging conflict markers into a test
  file. After any merge: `git grep -l "^<<<<<<< " -- .` across the WHOLE tree.
- **A spec that passes with AND without the fix is worse than none** — delete it. Always control-run.
- **`npx tsc --noEmit` DOES NOT typecheck test files** — Build runs `check-test-typecheck.js`.
- **Match a call/tag to its balanced close, never a line window.** Four false findings in one day,
  and it is what made `check-invalidate-after-push.js` blind to five live sites (LB-133).
- **`total_count: 0` is a stale base or a conflicted PR, never slow CI.** Re-merge and push.
- `session-select-content.tsx` is a size-ratcheted hotspot: reasoning goes in a sibling.
