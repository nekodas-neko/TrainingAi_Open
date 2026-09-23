# Implementation Agent (B) — baton

**Updated:** 2026-09-23 · **Session title:** `🚧 Implementation Agent (B) 🟢`
**Next ID:** LB-131 (LB-130 filed 2026-09-23). ⚠ The prescribed grep counts THIS LINE, so it reads
one high whenever the baton names the next id — check the journal too, and take the number the
grep returns rather than +1.

## Now

DV-11 in flight. Eight shipped today, latest #1458 (LB-131 + DV-9).

## Next

**`node scripts/next-item.js --lane B` — run it, do not trust this line.** It has disagreed with my
own note THREE times in one day: entries land mid-PR and the top changes within a single CI cycle.

**LB-129 is part-diagnosed — read its entry, do not re-derive.** Five candidates are ruled out
there (param delivery, empty steps, an early return, a Sheet mount gate, effect-only reading). It
needs instrumentation of `EndOfDayReview`'s nested dynamic import, not more source reading.

**BF-177's plan (scratchpad) is AMENDED** — LB-128 shipped as #1456, so its premise that
`cachedFetch` gates `onError` on `cached === null` may no longer hold. Re-read `lib/sqlite/cache.ts`
and `fetch-with-retry.ts` first.

## Blocked / owed

- Device checks are Device Verification's to RUN, mine only to RECORD — `Verify: device` + a `Keep:`
  naming it keeps an entry out of READY without deleting it. A FAILED check comes BACK as work.
- Owed: an e2e discriminating shell-teardown from shell-flip (RV-110), and LB-129's cause.

## Claimed paths — none.

## Lessons that cost real time

- **`npx tsc --noEmit` DOES NOT typecheck test files.** Build runs
  `node scripts/check-test-typecheck.js` against `tsconfig.tests.json` (its own per-file baseline).
  A clean `tsc` says nothing about a spec — that turned #1453 red. Run it beside `check:rules`.
- **Two fetch traps.** `--unshallow` does NOT update `origin/main` on an already-unshallowed repo
  (merge says "Already up to date" against a stale ref while GitHub refuses) — always ALSO
  `git fetch origin main` and confirm the sha moved. Any plain fetch RE-GRAFTS, after which the
  AHEAD count is nonsense ("0 1437" on a branch one ahead); trust BEHIND.
- **Match a call/tag to its balanced close, never a line at a time.** Two false findings in one day:
  a "bare" 3-line call that passed its arg on line 3, and 26-of-28 unnamed switches that were 17/25.
- **Run the FULL vitest suite, never scoped to the dirs you changed** — a source-shape test asserting
  on your file can live anywhere (#1431).
- **Never pipe a gate through a short `tail`.** Hid a second conflict marker; run gates to a file and
  echo `$?`.
- **`total_count: 0` is a CONFLICTED PR, not slow CI** (no workflow run at all — check
  `mergeable_state`). Conversely the endpoint LAGS: #1458 showed two jobs running that had
  finished. Attempting the merge is the reliable green test.
- **Never hand-merge two journal folds.** #1447 and #1453 collided add/add on the same
  `history-<date>-folded-N.md`; take one side whole and re-run `fold-journal-entries.js`.
- `session-select-content.tsx` is a size-ratcheted hotspot: put reasoning in a sibling and leave a
  one-line pointer.
