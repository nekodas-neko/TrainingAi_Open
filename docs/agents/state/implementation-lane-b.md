# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-08-26 · **By:** the thirteenth Lane B run · **Next ID:** `LB-18`

## Now
Merged this run: **#540** (Q-395c one food list + **LB-17** back-dismiss at three layers), **#547**
(**BF-34** the sibling dialog), **#550** (**BF-36** the journal limit's targeting). All three owe a
device press and nothing else; the presses are folded into ONE `projectOverview.md` row, since they
are one screen and one pass.

**The queue's top is BF-28, which is the parity MAP, not work — skip it.** LB-16 is next and has
just been re-scoped (below).

## The finding that should change how you start
**Re-verify every entry's premise before writing code. Nine for nine last run; four for four this
one.** BF-34 asserted two things that were false — that its own one-line "share the flag" fix would
work (it has an ordering trap: `absorb` is registered by the *closing* sheet, so it runs before the
opening one's handler and clears a shared boolean too early), and implicitly that LB-17 had not
already touched that guard. LB-16 understates its own size by a whole component. And **I asserted a
web reproduction of BF-34 that I did not have** — the bin is not actionable in Chromium at all
(`locator.tap()` times out), so a coordinate tap landed on the overlay, closed the sheet and never
called `onDelete`. The dialog never mounting reads *exactly* like the bug. A `MutationObserver`
installed before the tap is what settled it. **Measure, then claim.**

## Next
`node scripts/next-item.js --lane B` first.
- **LB-16** — the capture screen. **Its entry and its plan now BOTH carry a measured re-scope and a
  recommended structure; read them before code.** In short: the `My Foods` tab drags 13 props, 24
  `useState`s and four nested sheets out of a 696-line file. Recommended: **invert** — put the
  capture screen inside `saved-meals-sheet.tsx`, which already owns all of it, rather than extracting
  a panel. Decide before writing, not during.
- **BF-11c / BF-11f** — the meal creator chain, untouched this run.

## Do not re-litigate
- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**` are Lane A** whatever the edit
  looks like. The rule is the **path**, not the nature of the edit.
- **Back-dismissal's decision logic is [`lib/hooks/sheet-back-stack.ts`](../../../lib/hooks/sheet-back-stack.ts) now**, with
  the hook reduced to React wiring. All three failures it has carried (LB-10, LB-17, BF-34) were in
  *when to close*, and none was reachable from a test while it sat inside an effect. Two mechanisms,
  both load-bearing: **depth** (a surface closes only on arriving somewhere shallower) and a
  **module-level self-pop counter** (a sheet closing and a dialog opening in one tick are different
  instances). Reverting either fails its own tests. Never call `useSheetBackDismiss` at a call site.

## Owed (device / physical)
**Nothing this run is device-verified.** One row in `projectOverview.md` carries all of it —
*"One back-dismiss primitive, three failures…"*: tap a diary row and the bin (**the confirm dialog
must STAY open and be tappable**, Cancel must cancel); back must unwind the nest **one layer per
press** (meal → My Foods → Log Food → page); the swipe tray must not open while scrolling; a 92vh
sheet's action row must clear the gesture bar. Carried from before: Q-406, Q-467, Q-499, Q-538,
Q-305 at S25 width, Q-477 across local midnight, BF-10, LB-5, Q-328/Q-321/Q-486, Q-389, a TalkBack
pass, Q-450/Q-418 (needs a Polar H10). **Q-315 needs a DESKTOP.**

## Claimed paths
None held.

## Gotchas worth carrying
- **E2E takes ~16 min and the base WILL drift under it.** #547 went fully green twice and lost the
  merge to conflicts both times (#546, then #548). **Merge on the five REQUIRED checks (~4 min) when
  E2E cannot be informative** — a docs/scripts change, or a re-push whose diff against an
  already-E2E-green head is version/changelog only. Do not spend a 16-minute window you do not need.
- **Rebuild `package.json`/`changelog.ts` from `git show origin/main:...`; never splice a hunk** — a
  splice drops the other PR's entry. The version is stamped in FIVE places once a Known-Issues row
  and a backlog heading name it. Main took two patch numbers out from under one PR in one hour.
- **`git fetch origin main` RE-SHALLOWS this clone** — `test -f .git/shallow && git fetch --unshallow origin` before every merge.
- **After every merge `grep -c '^### .*<your-id>'` the backlog** — the two-deletions trap auto-merges
  with no conflict markers.
- **`Lane:` and `Gate:` are FIELDS** — each needs its own bullet at line start or `next-item.js`
  ignores it and keeps serving a parked entry.
- **`projectOverview.md` sits ON its ratchet.** Delete whole lines; rewording lands line-neutral.
  Normalising a wrapped note to the file's dominant single-long-line style reclaims 2–4 at a time.
- **Never run a local e2e suite while editing the tree or merging** — the dev server hot-reloads,
  prints `Parsing ecmascript source code failed`, and tests fail at **0ms**. That is an aborted run,
  not a result. Committing mid-run is safe; git only writes `.git`.
- **`e2e/fixtures.ts` `openSavedMeal` re-measures inside a retry** — the merged list re-sorts
  asynchronously and photo tiles decode late, so a box measured once and tapped once lands on
  whatever slid into that spot. Any new spec tapping a row by coordinate must do the same, and must
  `scrollIntoViewIfNeeded()` first or the tap hits the overlay.
- **`meal-label.spec.ts:111` exceeds its 180 s timeout in this sandbox on `main` too** — not yours.
