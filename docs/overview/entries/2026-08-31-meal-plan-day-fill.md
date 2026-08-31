# 2026-08-31 — the meal plan can fill the day, and it stops at the current hour

**Branch:** `feat/meal-plan-day-fill` · **Entry:** Q-187 (step 4) · **Lane:** B · **Version:** v1.412.0

## What was left

Q-187's plan ran in four steps. Three had shipped: the `plan_meal_answers` table with its full sync
path, a one-tap *"I ate this"* per meal, and a per-meal decline. The fourth was the automatic half,
held back deliberately, with its own recommendation attached:

> Only then consider whether prefill should be automatic on day open, or an explicit "fill my day"
> action. **Recommend explicit first** — an automatic prefill that guesses wrong trains the owner to
> ignore it, and the button is one tap.

## What shipped

**`components/nutrition/plan-day-fill.ts`** — a pure module answering *which planned meals a one-tap
log should write*, and holding the one decision that mattered.

**The action is bounded by the clock, and that is the whole design.** The property Q-187 protects is
that the day's totals never count food nobody ate — which is why unconfirmed prefills stay out of
`food_logs` entirely rather than being filtered out of 24 readers. A button that logs the *whole*
day would hand that property straight back: press it at 9am and the macro bars report a full day
eaten, dinner included. The tap is a confirmation, and you cannot confirm a meal you have not had.

So `fillableMeals()` offers, on **today**, only the meals whose hour has come; on a **past** day all
of them, which is the retrospective case; on a **future** day none. It also skips what is already
logged, what was declined, and what has no ingredients to write (plans made before Q-192 stored
names and macros only). An empty result hides the control rather than disabling it.

`planMealHour()` resolves when a meal is meant to happen — `suggestedTime` first, because it is the
more specific answer to *when*, then the meal type's start hour. A meal it cannot place is **not**
offered on today: unlike a past day there is no way to establish it has happened, and the cost of
guessing is logging food nobody ate.

**`app/nutrition/use-plan-meal-logging.ts`** gained `logMeals()`. It is **sequential on purpose**,
which is the opposite of the standing "never await POSTs in a loop" rule and is right here: on the
canonical runtime `logPlanMeal` makes no network call at all — it writes SQLite, queues the outbox
and fires `pushThenRevalidate` behind itself. Running the meals concurrently would interleave those
writes on one connection and start N pushes and N invalidations for no gain. The user waits on none
of it: the button flips synchronously and each meal's rows appear as it lands. One failing meal does
not strand the rest, and the count that failed is reported rather than swallowed. The in-flight
guard is a **ref**, not the state beside it — two taps inside one render both read the old `false`,
which is how this app once turned 5 taps into 4 POSTs.

**`components/nutrition/active-plan-card.tsx`** (new) — the plan card plus the two hooks that drive
it, lifted out of `nutrition-content.tsx`. That orchestrator was at 796 lines and this feature took
it to 813, over the 800-line gate. The seam is a real one rather than a size dodge: logging a planned
meal, declining one and copying one into My Meals are the plan's concerns, and the tab never reads
any of that state. The orchestrator ended at **787 lines — smaller than before the feature.**

## Decisions made here

- **Which meals are fillable is computed inside `MealPlanSection`, not by its caller.** A split plan
  has two variants and `pickVariant` chooses between them; deriving the list outside would let the
  button offer a meal the list below is not showing.
- **An unreadable clock offers nothing on today, rather than everything.** `hourFromTzDatetime`
  returns null on a shape it does not recognise, and the card passes `-1`. A `NaN` would compare
  false against every hour and produce the same outcome by accident; this produces it on purpose.
- **The label says which claim it is making** — *"Log the 3 meals so far"* on today, *"Log all 3
  meals"* otherwise. Only the first is reachable from today's one call site, because the plan card
  renders on today only; the second is the component's honest contract if that gate ever moves.

## Verification

- **Full unit suite green.** `pnpm check:rules` **Ran 65 of 65 Custom Rules steps**, all passed —
  including `check-component-size` (which is what forced the extraction) and
  `check-memo-prop-stability` (91 memoised components, no new defeated call site).
- **19 unit tests** over the selector, and **every guard mutation-checked — 10 mutations, all
  killed**: the future-day guard, the past-day shortcut, the clock bound, the unresolvable-hour
  exclusion, the logged/declined/empty filters, `suggestedTime` winning over the bucket, the bucket
  fallback, and the hour-range check.
- **`e2e/plan-day-fill.spec.ts`** stubs a plan with one meal an hour behind the clock and one an
  hour ahead, then asserts the offer says *one* meal, that pressing it writes that meal and not the
  other, and that the offer then disappears rather than re-proposing it. **Both mutation-checked.**
  The food write is real — `getLocalStore` is null on web, so it took the
  `POST /api/nutrition/food-logs` fallback and the rows landed in the dev database.

**Two things the spec had to be taught, both worth keeping.**

1. **`locator.click()` does nothing on this screen.** The button did not fire — no toast, no
   request, no error. That is **Q-354**, open and measured since 2026-08-17: the date-swipe `useDrag`
   on the Nutrition scroll container swallows mouse input, and mouse is what Playwright sends.
   `tap()` works, and is the faithful input anyway since the canonical runtime is touch-only. The
   backlog entry now records that a spec not looking for this walked into it, because the practical
   cost of leaving it open is a trap for the next spec author, not a user-facing bug.
2. **The spec's meal names are unique per run.** Which planned meals are already logged is derived by
   matching ingredient names against the day's food, and this spec writes real rows — so a second run
   on the same day would find run one's food and correctly offer nothing, failing for a reason that
   has nothing to do with the code. CI provisions a fresh database and would never have shown it.

**Not exercised:** native SQLite and the outbox (`getLocalStore` returns null on web, so the whole
device write path — including the `plan_meal_answers` decline that suppresses a meal from the offer —
went through the API fallback here), safe-area insets, and Samsung's WebView. The new button sits
inside an existing card and anchors nothing, but it has not been seen on the S25.

## Also in this diff

Selecting this item meant applying the path rule to everything above it in Lane B's queue, and five
entries turned out to be Lane A: **Q-275**, **Q-272**, **Q-278**, **Q-279**, **Q-283**. Each now
records its lane and the one-line derivation, which takes Lane B's READY list from 39 to 34. That is
LB-12's problem in miniature — the bulk sweep is still the Orchestrator's, but an entry whose lane
was derived to select against it should not make the next session derive it again.
