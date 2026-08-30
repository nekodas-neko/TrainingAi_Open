# A logged food swipes to Delete, and Delete still asks (BF-45 ⑤)

**Branch:** `feat/food-log-swipe-delete` · **Lane B**

Owner: *"for logging food; we could possibly add the option to swipe and delete it (with
confirmation) like we do in the other screen."* The meal library has had the gesture since BF-29;
the diary — where a mistyped entry is most likely to need removing — had only the bin behind a tap.

## Shape

`DiaryRow` wraps its `FoodRow` in the existing `SwipeActions`, with **one** action rather than the
meal list's three: label and edit belong to a saved meal, and a logged row's edit is the tap it
already has. The tray routes to `requestDeleteLog`, which is the same confirmation dialog the edit
sheet's bin raises, and **the bin stays** — a swipe is an accelerator for a thumb that knows it is
there, never the only route to a destructive action. That is `SwipeActions`' own rule, and the third
test pins it.

## Two things the meal list did not need

**The screen already owned the horizontal axis, and both gestures ran from one touch.**
`nutrition-content.tsx`'s scroll container carries a `useDrag` that steps the *day*. A row swipe fed
it too, so revealing a Delete also moved the list out from under the thumb. `SwipeActions` now marks
its root `[data-swipe-actions]` and the day handler defers to it — the same shape as the exclusion
`tab-swipe-navigator.tsx` already applies to a carousel, and it covers every future call site rather
than this one.

**This is invisible on today.** The day handler refuses to step past today, so on the current day the
second gesture is a no-op and the bug does not exist. It reproduces on any past day. Both e2e tests
therefore run on *yesterday*, and the guard is proved both ways: with the deferral removed, the
tray-opens-without-stepping test fails.

**The row surface has to be opaque**, or the tray shows through its own text. `SwipeActions`
hardcoded `bg-card`, which suits the meal list — an unpainted container — and is two steps darker
than the `bg-muted/60` meal card the diary rows sit in, so it would have drawn a band around them.
The primitive takes a `surfaceClassName` now, defaulted to what it always did.

## What the harness cost, which is most of the time this took

Three failures that all read as "the feature is not wired" and were none of them that:

- **The row's natural position is under the bottom tab bar.** Every touch point landed on a nav icon;
  the tray never moved and the tap never opened the sheet. Printing `document.elementFromPoint` at
  the tap coordinate is what found it — the target was an `<svg>`. Both helpers centre the row first.
- **The Next.js dev overlay.** `<nextjs-portal>` sits over the bottom-left corner; a coordinate tap
  that clips it opens its Route/Turbopack menu, which then covers the screen. `fixtures.ts` already
  works around this portal intercepting `locator.tap()`; this spec hides it instead.
- **`deleteFoodLog` writes a tombstone.** `SELECT 1 FROM food_logs WHERE food_item_id = …` counts a
  deleted row forever, so a working delete read as a failure. The count is `deleted_at IS NULL`, and
  that is the interesting direction: written the other way round, the assertion would have *passed*
  on a broken delete.

## Verification

Three e2e tests in `e2e/food-log-swipe-delete.spec.ts`, driving a real CDP touch drag (the technique
`meal-detail-artboard-parity.spec.ts` established): the tray reveals Delete and Delete raises the
confirmation **with the row still in the database**; the drag does not step the day; and the bin
inside the edit sheet still reaches the same confirmation. Asserting on the database rather than on
the row disappearing is the point — this app removes the row optimistically before the request
resolves, so a tray wired straight to the delete would look identical for the first frame.

**Proved both ways, twice.** Remove the `SwipeActions` wrapper and the first test fails; remove the
`[data-swipe-actions]` deferral and the second does.

Full unit suite **5,612 passed** / 669 files. `pnpm check:rules` — **Ran 62 of 62**. Typecheck and
lint clean. The nutrition e2e set — this spec plus `nutrition-day-navigation`, `nutrition-tail-order`
and `food-logging-complete` — **12 passed** on the merged branch.

## Not exercised

- **The device, which is where this actually has to work.** The sandbox renders at desktop width with
  a mouse-driven touch emulation; a real thumb on a 6.9" screen is the only test of whether the drag
  competes with vertical scrolling. BF-45's remaining `Keep:` is that check.
- **The offline delete path.** `getLocalStore` returns null in `pnpm dev` and in Playwright, so the
  confirmation's local-store branch — and BF-47's fix behind it — took the web fallback here every
  time. That is why BF-45 and BF-47 are checked in one pass on the S25.
- **A row that is mid-swipe when the list re-renders.** `AnimatePresence` removes the row on delete
  and `SwipeActions` unregisters its closer on unmount, but nothing here forces that race.
