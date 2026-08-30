# Handoff — 2026-08-31 · the diary's nested meal rows, and the swipe tray's first tap

_Domain: `nutrition` (also touches `app-shell`, `platform`) · Branch: `feat/nutrition-batch-bf60-63` · PR: **#659 open**; **#647 and #653 merged**_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/nutrition/README.md`](domains/nutrition/README.md), then
> `docs/implementation-backlog.md`. This file covers only what *this* session did and leaves behind.

## Goal

Clear the nutrition cluster at the top of Lane B: ship BF-39's held render half, then the four
reports the owner filed from one device pass (BF-60/61/62/63). Two platform items came out of the
work itself (LB-28, LB-30).

## Current status

- **Build/test:** `pnpm test` **5,661 passed** / 674 files; `pnpm check:rules` **Ran 62 of 62** (63
  once #653 landed); `npx tsc --noEmit` clean; lint 0 errors. E2E run locally per change, and green
  in CI on #647 and #653.
- **`pnpm dev` was not run as a manual pass.** The e2e harness drives the same dev server and
  exercised every changed surface, which is stronger for these changes than clicking through.
- **Device-verified: NO — nothing in this session.** Three backlog entries stay queued for exactly
  that (below). The harness drives the **web** build, where `getLocalStore` returns null, so
  `useSavedMealSummaries`'s local-first branch has **never run in any test**.

## What shipped

| PR | What |
|---|---|
| **#647** | **BF-39** — a logged meal draws as one diary row (name + photo), opening to its ingredients. Grouped on `meal_group_id`, never `saved_meal_id`. **LB-30** filed. `swipeRowLeft` extracted to `e2e/fixtures.ts` with a rect-stability wait. |
| **#653** | **LB-28** — Custom Rules refuses `savePreference` inside a `useEffect`. Scanner in `scripts/lib/save-preference-in-effect.js`, 10 fixture tests, gate now **63 of 63**. |
| **#659** | **BF-61** tray stacks above the row while open · **BF-62** `bottomInset="takeover"` on `SheetContent`/`SheetFooter`, five sheets · **BF-60** tab → `Search` · **BF-63** barcode scan in the meal builder. v1.404.0. |

## The finding that mattered most

**BF-39 was held for a week on a conclusion that was wrong in every part.** The entry recorded *"a
subscriber re-rendering a sibling subtree drops an in-flight `useDrag`"* and asked the next session
to establish re-render vs remount. Instrumented, the answer is neither:

- `SwipeActions` **mounts once** and never unmounts.
- The drag handler is **never invoked at all** — not one `first: true`.
- `notifyInvalidated` logged **nothing**; no `saved-meals` invalidation ever fired.

Every touch landed on the sheet's scroll container *beneath* the row, because the row was still
moving: `toBeVisible()` passes the instant the sheet mounts, `boundingBox()` read **y=605**, and the
row sat at **y=503** by the time the CDP touch arrived. `getAnimations()` on the dialog:
`["enter:running"]`.

**`Input.dispatchTouchEvent` performs none of the actionability checks `locator.tap()` does**,
stability included, and `toBeInViewport()` is satisfied ~400 ms before a sheet lands. BF-39 never
touched the gesture; it added enough work behind the sheet that the animation had not settled. That
is also why disabling the summaries hook "fixed" it, why moving it into a memoised child fixed one
spec and not the other, and why both specs passed when run alone — **each of those four measurements
was real, and each changed the one variable the failure was actually sensitive to.**

## Deliberately NOT done

- **`components/activity/exercise-review-sheet.tsx`** (`h-[85vh]`) did not get `bottomInset` — no
  bottom-anchored action row, another domain, nothing reported.
- **BF-63 does not store the scanned code.** `barcode` is NULL on every `food_items` row in
  production including the three already marked `'barcode'`; the route does not return what it
  looked up and `NewFoodItem` has no field for it. That chain is **Lane A** and is BF-38's.
- **LB-30's sweep** — 46 other `boundingBox()` reads across 27 spec files carry the same race. Filed,
  not swept: only the ones feeding a coordinate tap are exposed, and they fail loudly.
- **`projectOverview.md`'s Current Status** was repaired (three duplicated `**Version:**` lines and a
  stray `v1.398.0` block, merge debris) but not compacted — that is Orchestrator's sweep.

## Key decisions (with rationale)

- **BF-39's name/photo comes from a local-first hook on the shared `saved-meals` key**, not a
  food-log join (Lane A) and not a seed-only read (goes stale, the Q-260 shape). One file, one
  consumer, cheapest to reverse.
- **BF-62 was fixed differently from what its entry proposed**, and the entry keeps the wrong
  hypothesis on purpose. `92vh` was never involved: `SheetContent side="bottom"` bakes
  `.pb-safe-action`, whose floor is 0.75rem, while under edge-to-edge the inset reports the nav
  bar's **own height** — so the padding equals the bar. The measurement was already in `globals.css`
  beside `.pb-safe-action-lg`.
- **The `bottomInset` class is chosen, not appended.** tailwind-merge cannot see these custom
  classes, so appending would stack the two paddings — the same fact CLAUDE.md records about `p-0`.
- **LB-28 exempts two sites, against its own entry's claim of none.** `usePersistedPreference` *is*
  an effect calling `savePreference` (the mechanism), and Home's section-order reconciliation returns
  early unless the order changed. The grep behind "none today" wanted both tokens on one line.

## Gotchas / what did NOT work

- **A pipeline hides an exit code.** `pnpm check:rules | tail -2` exits with `tail`'s status, so a
  failing gate reported success and a commit with **conflict markers in it** got pushed to #647.
  Check `node scripts/check-conflict-markers.js` by its exit code directly.
- **`git fetch origin main` re-shallows this clone.** The tell is `fatal: refusing to merge unrelated
  histories`; `git fetch --unshallow origin` fixes it. Hit three times in one session.
- **BF-61's regression test was a false green twice**, and the shapes that do *not* reproduce it are
  the valuable part: a long drag overshoots the resting offset and animates back **rightwards**,
  never covering the tray (measured −97 px against a −64 px rest); a CDP-paced flick falls under
  `FLICK_VELOCITY` so the row snaps **closed** (`trayHidden=true`); and a tap at the tray's **centre**
  is uncovered within a frame, because the tray uncovers from its right edge first. What works: a
  36 px drag, a tap 52 px in, and the transition stretched to 6 s so the window exceeds one protocol
  round-trip.
- **Six PRs landed under this session's open ones**, so `doc-size/*.size` and
  `doc-size-baseline-history.md` conflicted on nearly every merge. Re-derive the `.size` numbers from
  the merged documents; the history file is append-only, so keep **both** notes chronologically.

## Files to look at

- `components/ui/swipe-actions.tsx` — the tray's `z-10`-while-open, and why shortening the animation is not the fix.
- `components/ui/sheet.tsx` — `bottomInset`, and the reason the class is chosen rather than appended.
- `e2e/fixtures.ts` — `swipeRowLeft`: the rect-stability wait (LB-30) and the `steps` option (BF-61).
- `e2e/food-log-swipe-delete.spec.ts` — the BF-61 case, with the three non-reproducing shapes documented.
- `lib/hooks/use-saved-meal-summaries.ts` — BF-39's read; its local-first branch is untested.
- `scripts/lib/save-preference-in-effect.js` — LB-28's scanner, and why it blanks comments and strings.

## Open questions / blockers

- **The S25 device pass is the binding constraint for this lane.** It unblocks BF-24, BF-45, BF-46,
  BF-51 ①②④ **and now BF-61, BF-62, BF-63**. BF-62 needs **both** navigation modes — the inset differs
  by mode, and checking one is what lets this class through. BF-61 needs the fast tap on **both**
  trays; BF-29's 2026-08-30 pass was the meal list, tapped slowly.
- **LB-29** (a preference chosen and then reloaded can be overwritten by the server's older copy) —
  recommendation on record: a dirty mark that re-PATCHes. Seed-if-absent cannot clobber but gives up
  cross-device updates. **They promise different things**, so it is the owner's call.
- **BF-51 ③** (`Recently used` as a tab) — recommendation: fold into BF-52's planning session.
- **LB-27** — one extra request in the launch burst strands several past 60 s; mechanism still
  unexplained, and it is **Lane A**.

## Pickup prompt

```
You are the Implementation Agent for Lane B on nekodas-neko/TrainingAi_Open. Rename this session so
its title is exactly `🚧 Implementation Agent (B) 🟢` (get_session with session_id omitted, then
set_session_title).

Read, in order: docs/agents/README.md and docs/agents/state/implementation-lane-b.md (your baton),
then projectOverview.md, then docs/domains/nutrition/README.md, then
docs/handoff-2026-08-31-nutrition-diary-and-swipe-tray.md.

First concrete action: check whether PR #659 (feat/nutrition-batch-bf60-63) merged. If it is still
open, merge it once its five required checks are green — Lint, Tests, Build, Custom Rules, Migration
Check; E2E is not required. If it conflicts, merge origin/main locally, re-derive the docs/doc-size
.size numbers from the merged documents, keep BOTH notes in docs/doc-size-baseline-history.md
chronologically, and rebuild package.json / packages/shared/src/changelog.ts from
`git show origin/main:...` rather than splicing a conflict hunk.

Then run `node scripts/next-item.js --lane B` and work the queue top-down. Do NOT hand-scan the
backlog — most READY rows print no lane and the path rule puts almost all of them in Lane A.

Constraints you would otherwise rediscover:
- `git fetch origin main` RE-SHALLOWS this clone. When a merge says "refusing to merge unrelated
  histories", run `git fetch --unshallow origin`.
- Never check a gate through a pipe: `pnpm check:rules | tail` exits with tail's status, and that
  already let a commit with conflict markers reach a PR.
- Quote `pnpm check:rules`'s "Ran N of N" count, never the word "pass".
- Nothing from the last four runs is device-verified. BF-45, BF-46, BF-51, BF-61, BF-62 and BF-63 all
  owe the same S25 pass and nothing else; do not start new UI work in that area expecting to verify it.
- Three things are blocked on the owner with written recommendations — LB-29, BF-51 ③, and the device
  pass. Do not decide them yourself and do not build past them.
```
