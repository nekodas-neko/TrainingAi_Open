# Implementation Agent (B) — baton

**Updated:** 2026-09-23 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-135 (LB-134 filed 2026-09-23). ⚠ The grep counts THIS LINE, so it reads one high —
check the journal too and take what the grep returns, not +1.

## Now

PR #1474 in flight (LB-133 detector rewrite + LB-134). Ten shipped today, latest #1467 (LB-132).

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** It has disagreed with my
own note FOUR times in one day: entries land mid-PR and the top changes within one CI cycle.

**LB-129 is part-diagnosed — read its entry, do not re-derive.** Seven candidates ruled out there,
including back-dismiss (`handlePop` only runs on `popstate`; `tab-shell.tsx:103` uses
`replaceState`, which emits none). One live hypothesis remains: `EndOfDayReview` is a second
`dynamic({ssr:false})` chunk nested in the tab's own. Instrument it; do not read more source.

**BF-177's plan (scratchpad) is AMENDED** — LB-128 shipped as #1456, so its premise that
`cachedFetch` gates `onError` on `cached === null` may no longer hold. Re-read `lib/sqlite/cache.ts`.

## Blocked / owed

- **LB-134 is the owner's and is NOT mine to action** — branch protection. Until he rules, read the
  `Tests` job CONCLUSION before every merge.
- Device checks are Device Verification's to RUN, mine only to RECORD. A FAILED check comes BACK
  as work. Owed: an e2e discriminating shell-teardown from shell-flip (RV-110), LB-129's cause.

## Claimed paths — none.

## Lessons that cost real time

- **⚠ THE MERGE CALL IS NOT A GATE HERE.** #1467 squash-merged with `Tests` FAILING and returned
  success; `main` took a red commit. CLAUDE.md's "attempting the merge is the reliable green test"
  is FALSE here (protection is not configured). Confirm the Tests conclusion first: `get_job_logs`
  + `failed_only:true`, empty list = green. The RUN stays `in_progress` ~31 min; E2E is advisory.
- **`main` is red more often than anyone notices** — twice on 2026-09-23, both a pinned snapshot not
  updated by the change that invalidated it. Run the FULL suite; when it fails, reproduce at
  `origin/main` in a worktree BEFORE assuming it is yours.
- **Another lane may be fixing the same thing right now** — two of mine were superseded mid-PR
  (#1472, keep-gate). Check `origin/main` before claiming a fix; correct the entry if you already did.
- **NEVER pipe merge or gate output through `tail`.** Bit three times in one day; once it hid a
  fourth conflict and `git add -A` staged markers into a test file. After any merge run
  `git grep -l "^<<<<<<< " -- .` across the WHOLE tree.
- **`npx tsc --noEmit` DOES NOT typecheck test files** — Build runs `check-test-typecheck.js`
  against its own baseline. A clean `tsc` says nothing about a spec (turned #1453 red).
- **Match a call/tag to its balanced close, never a line window.** Four false findings in one day,
  and it is also what made `check-invalidate-after-push.js` blind to five live sites (LB-133).
- **`total_count: 0` is a stale base or a conflicted PR, never slow CI.** Re-merge and push.
- **Fetch is ordinary again (LA-130):** `check:rules` was re-shallowing via `--depth=1`, now
  guarded. `--unshallow` FATALS on a complete repo — guard with `test -f .git/shallow`.
- `session-select-content.tsx` is a size-ratcheted hotspot: reasoning goes in a sibling.
