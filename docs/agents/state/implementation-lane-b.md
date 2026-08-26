# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-08-26 · **By:** the fourteenth Lane B run · **Next ID:** `LB-21`

## Now
Merged this run: **#540** (Q-395c one food list + **LB-17**), **#547** (**BF-34** the sibling
dialog), **#550** (**BF-36**), **#551** (LB-16 re-scope), **#559** (**Q-406** the last food row +
the rewritten device queue). Open: **the LB-16 + BF-37 PR** — Log Food collapsed onto one screen,
and the merged list split into two tabs.

Everything above owes a device press and nothing else. They are one screen and one pass, and
[`docs/device-verification-queue.md`](../../device-verification-queue.md) is now grouped so that one
pass clears them — **start at N4**, which is the rebuilt Log Food screen; several other Nutrition
items are reached *through* it.

## The finding that should change how you start
**Re-verify every entry's premise before writing code.** Nine for nine two runs ago; four for four
last run; **and this run the ground moved under an entry while I was building on it.** LB-16's
recommended structure ("invert into `SavedMealsSheet` — nothing has to move") is right and
incomplete: that sheet is *stacked on* `FoodLoggerSheet`, so the inversion alone would have left an
empty sheet rendering behind the list — a second scrim and a wasted back press, on the entry whose
title is *six entry points become one*. And **BF-37 was filed by the BugFix agent the same morning,
reversing the merge LB-16 was built on.** I found it by looking at `git fetch`'s branch list, not by
any process. **Look at the open PRs before starting an entry, not only the queue.**

## Next
`node scripts/next-item.js --lane B` first.
- **BF-11c / BF-11f** — the meal creator chain. Untouched for three runs; premises unverified.
- **Q-395** is startable at last (every phase has shipped) but it is a *parity sweep* — **wait for
  the LB-16/BF-37 device pass**, or you are signing a drawing off against a screenshot nobody took.
- **LB-18 / LB-19** are both parked deliberately: LB-18 wants the owner's read on whether `Recent`
  should be global, LB-19 wants CI's verdict on two specs.

## Do not re-litigate
- **`lib/coach/**`, `packages/shared/**`, `app/api/**`, `lib/data/**` are Lane A** whatever the edit
  looks like. The rule is the **path**, not the nature of the edit. This is why `Recent` reads a meal
  bucket (LB-18): a global recent-items query is a route and a local-store method, both A's.
- **Back-dismissal's decision logic is [`lib/hooks/sheet-back-stack.ts`](../../../lib/hooks/sheet-back-stack.ts)**,
  with the hook reduced to React wiring. All three failures it has carried (LB-10, LB-17, BF-34) were
  in *when to close*. Two mechanisms, both load-bearing: **depth** and a **module-level self-pop
  counter**. Reverting either fails its own tests. Never call `useSheetBackDismiss` at a call site.
  **Its three-deep case is now covered ONLY by those unit tests** — LB-16 removed the app's only
  three-layer path, so no e2e spec reaches that depth any more.
- **Log Food is one sheet per screen.** `FoodLoggerSheet` renders **no sheet of its own** at
  `capture`; `SavedMealsSheet` is the screen. Re-opening a second sheet there re-introduces the
  wasted back layer LB-16 removed.

## Owed (device / physical)
**Nothing this run is device-verified.** [`device-verification-queue.md`](../../device-verification-queue.md)
holds all 27 of Lane B's `Gate: device` entries, grouped by screen — work a section, not an entry.
`projectOverview.md`'s *"One back-dismiss primitive, three failures…"* row is the narrative half.
**The nest is TWO presses now, not three** — that row and N2 both say so; a successor reading an
older note will count wrong. Carried from before: Q-467, Q-499, Q-538, Q-305 at S25 width, Q-477
across local midnight, BF-10, LB-5, Q-328/Q-321/Q-486, Q-389, a TalkBack pass, Q-450/Q-418 (needs a
Polar H10). **Q-315 needs a DESKTOP.**

## Claimed paths
None held.

## Gotchas worth carrying
- **`get_check_runs` returning `total_count: 0` has THREE causes, not one.** CLAUDE.md names a stale
  base; the others are a runner backlog and a **wedged run**. A run that has not started creates no
  check runs at all, so the zero says nothing on its own — read `actions_list`/`get_workflow_run` for
  the branch before concluding anything, and never re-push on the strength of the zero.
- **A run can wedge in a state GitHub will neither cancel nor re-run.** Measured 2026-08-26 on #565:
  `get_workflow_run` reported `status: queued` for **five hours** with zero jobs and an `updated_at`
  that never moved off creation. `rerun_workflow_run` → **403 "This workflow is already running"**;
  `cancel_workflow_run` → **409 "Cannot cancel a workflow run that has not been queued yet"**. Those
  two together are the signature: the API says queued, GitHub's own scheduler says it never was.
  There is no dispatch trigger on `ci.yml` (`pull_request` only), so the only way out is a **new
  commit** — and `concurrency: cancel-in-progress` on `ci-${{ github.ref }}` makes that supersede the
  wedged run by design. **Push real content, never an empty commit**: fold in a docs correction the PR
  already owes rather than manufacturing a no-op.
- **E2E takes 16–40 min and the base WILL drift under it.** #547 went green twice and lost the merge
  to conflicts both times. **Merge on the five REQUIRED checks when E2E cannot be informative** — a
  docs/scripts change, or a re-push whose diff against an already-E2E-green head is
  version/changelog only. #559 was merged on the five after E2E ran 40 minutes without reporting;
  say so plainly when you do that.
- **Rebuild `package.json`/`changelog.ts` from `git show origin/main:...`; never splice a hunk.**
- **`git fetch origin main` RE-SHALLOWS this clone** — `test -f .git/shallow && git fetch --unshallow origin` before every merge.
- **After every merge `grep -c '^### .*<your-id>'` the backlog** — the two-deletions trap auto-merges
  with no conflict markers.
- **`Lane:` and `Gate:` are FIELDS** — each needs its own bullet at line start.
- **`projectOverview.md` sits ON its ratchet.** Delete whole lines; rewording lands line-neutral.
- **Never merge `main` or edit the tree while a local e2e run is live.** I did it twice in two runs.
  The tell is `Parsing ecmascript source code failed` and tests at **0ms** — an aborted run, not a
  result. Committing mid-run is safe; git only writes `.git`.
- **`SegmentedTabs` renders `role="tab"`, not `role="button"`.** A `getByRole('button')` query for a
  tab label finds nothing and reports "element not found" on a screen that is working.
- **A retry that re-taps a button the open sheet aria-hides finds NOTHING.** Guard every
  open-the-sheet retry with `if (await page.getByRole('dialog').count() === 0)`. Six specs carry it;
  `plan-meal-to-saved-meal` did not and failed exactly this way once the list paint went over 3 s.
- **`e2e/fixtures.ts` `openSavedMeal` re-measures inside a retry** — lists re-sort asynchronously and
  photo tiles decode late. Any new spec tapping a row by coordinate must do the same, and must
  `scrollIntoViewIfNeeded()` first or the tap hits the overlay.
- **`meal-label.spec.ts:111` and `goal-invalidation.spec.ts:57` fail in this sandbox on `main` too** —
  verified by running them on a detached `origin/main` checkout. **LB-19** carries it. Do not spend a
  session on them; check whether CI agrees first.
