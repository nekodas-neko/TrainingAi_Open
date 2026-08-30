# 2026-08-31 — a logged meal is one diary row, and the hold was the spec (BF-39, LB-30)

**Branch:** `feat/diary-nested-meal-rows` · **Lane B**

## What shipped

BF-39's render half, unchanged from the version built on 2026-08-30 and held that evening: a food
log carrying a `meal_group_id` whose meal still resolves draws as **one row** headed by the meal's
name and picture, and opens to its ingredient rows. Two helpings of the same meal on one day stay
two rows — they share the meal and not the group. Rows logged before the columns existed, and a
deleted meal's rows, stay loose, because nothing back-fills and heading them *Meal* would invent a
name the app does not have. A one-row group is not nested at all.

The meal's name and photo come from `useSavedMealSummaries`, a local-first read on the shared
`saved-meals` key. That was the open question the hold left — a join into the food-log read would
have been Lane A's, and a seed-only read goes stale (the Q-260 shape). The hook is the Lane B
answer and the cheapest to reverse: one file, one consumer.

## Why it was held, and what it actually was

The hold was real: the meal library's swipe tray stopped opening, deterministically, on both CI
attempts and locally, and four measurements narrowed it without closing it. The entry recorded the
conclusion as *"something in opening a meal invalidates `saved-meals`, and a subscriber re-rendering
a sibling subtree drops an in-flight `useDrag`"*, and set the next session's task as establishing
**re-render versus remount**.

**It is neither.** Instrumenting `SwipeActions` with mount/unmount/render logging and the drag
handler with a per-event log, and running the failing pair:

- `SwipeActions` **mounts once** (twice, with StrictMode's discard) and never unmounts. Not a remount.
- The drag handler is **never invoked at all** — not one `first: true`. There is no in-flight gesture
  to drop.
- `notifyInvalidated` logged **nothing** for the whole run. No `saved-meals` invalidation ever fired.

A document-level touch listener showed every `touchstart`/`touchmove`/`touchend` landing on
`DIV.flex-1 overflow-y-auto` — the sheet's scroll container, **beneath** the row. Sampling the row's
rect every frame explained why: it was still moving. `toBeVisible()` passes the instant the sheet
mounts, `boundingBox()` returned **y=605**, and by the time the CDP touch was dispatched the row sat
at **y=503**. `getAnimations({ subtree: true })` on the dialog at that moment: `["enter:running"]`.

So BF-39 never touched the gesture. It added enough work behind the sheet that its open animation
had not settled by the time the spec measured — which is also why disabling the summaries hook
"fixed" it, why moving the hook into a memoised child fixed one spec and not the other, and why both
specs passed when run alone. **Every one of the four measurements was real and every conclusion
drawn from them was wrong**, because each of them changed how much work the page did, and that is
the variable the failure was actually sensitive to.

## The fix, and the rule it produces

`swipeRowLeft` moved into `e2e/fixtures.ts` and now waits for two `boundingBox()` reads a frame
apart to agree before it measures. The three specs that hand-rolled a CDP swipe —
`meal-detail-artboard-parity`, `my-meals-artboard-parity`, `food-log-swipe-delete` — all go through
it; the third copy is what the extraction rule exists to prevent, and it had already been written.

**`Input.dispatchTouchEvent` does none of the actionability checks `locator.tap()` does**, stability
included. That is the whole rule. `toBeInViewport()` — which `openSavedMeal` uses — does not cover
it either: it is satisfied the moment a pixel of the sheet crosses the fold, several hundred
milliseconds before it lands.

Verified twice, in full, with the grouping shipped: 13/13 across the four spec files, including the
pair that had failed together on every previous attempt.

## Not done

- **LB-30** — 46 `boundingBox()` reads across 27 spec files have the same latent race. Only the ones
  feeding a coordinate tap are exposed, and they fail loudly rather than passing silently, so it is
  filed rather than swept.
- **Not device-verified.** The grouped diary row and the swipe tray have not been exercised on the
  S25; the e2e harness drives the web build, where `getLocalStore` returns null and
  `useSavedMealSummaries` takes its API fallback. The local-first branch of that hook has therefore
  **never run** in any test.
- `projectOverview.md`'s Current Status carried three duplicated `**Version:**` lines and a stray
  `v1.398.0` block mid-section — merge debris from parallel PRs, collapsed here.
