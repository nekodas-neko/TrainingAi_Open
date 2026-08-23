# 2026-08-24 — the meal plan produces saved meals, and its write routes work again (Q-398)

**PR:** `feat/meal-plan-to-saved-meals` · **Lane B** (with a five-line Lane A fix, below)

## What shipped

Every meal of the active plan now carries **Save to My Meals**, with a **Save all N** beside the
list. A saved plan meal is an ordinary `saved_meals` row: it logs in one tap, prints a label with a
QR, and can be edited ingredient by ingredient. That is the whole point of the owner's framing —
*"the meal plan wont be used too much; it will be created - then likely not used again"* — a plan is
a **batch generator**, and what should outlive it is meals.

- `packages/shared/src/nutrition/save-plan-meal.ts` — `savePlanMealToLibrary` (one meal) and
  `savePlanMealsToLibrary` (a batch, stamping each result back onto its plan meal). Offline-first,
  with the Q-216 fall-through shape: the local write has its own catch and the API call sits outside
  it.
- `components/nutrition/plan-meal-row.tsx` — the plan card's meal row, extracted so the section did
  not grow a fourth action inline.
- `app/nutrition/use-plan-meal-saving.ts` — the UI state, mirroring `use-plan-meal-logging.ts`.
- `lib/hooks/use-plan-saved-meal-ids.ts` + a **From plan** tag on the My Meals row.

## Decisions worth not re-litigating

**No schema change, and none was needed.** Lane A's pre-check on this entry (2026-08-19) had already
established that `meal_plan_meals.saved_meal_id` exists, is `ON DELETE SET NULL`, and survives a
regenerate. That column is the idempotence key — better than the `(plan id, plan item id)` key the
entry proposed, because it is already preserved by `structure/route.ts`. Deleting the saved meal
clears the stamp through the FK, so the offer correctly comes back.

**Provenance is derived, not stored.** A saved meal is plan-derived exactly when some plan meal
points at it. A `from_plan` column would be a second copy of that fact and would go stale the moment
a plan was deleted.

**The conversion is shared with logging, not re-written.** `ingredientToEntry` in `log-plan-meal.ts`
was already the per-100g convention — a food item stored per 100 g with the weight carried in the
multiplier, so the library gains "Rolled Oats" rather than "Rolled Oats (250 g)". It is exported
rather than copied; two conversions would have drifted the first time either rounded differently.

**The setup sheet's own copy path is gone.** `saveTickedMealsToLibrary` was a second implementation
that created food items with a bare POST (no local store, no outbox, no `nutrition-food-items-all`
invalidation — the three gaps `createFoodItem` exists to close) and never stamped anything, so a meal
ticked at setup and then saved from the plan card produced **two copies of the same recipe**. Both
surfaces now call `savePlanMealsToLibrary`, and the setup path stamps against the persisted plan
rather than the draft, which has no ids to stamp.

**Not done, deliberately:** step 3 of the entry — deleting `meal-plan-section` and the staleness nag
— which the entry itself gates on owner confirmation. It stays open as its own question.

## The bug this uncovered: the meal plan could not be written to at all

While asserting that the copy stamps `saved_meal_id`, the PATCH silently did nothing. Five routes
had this shape:

```ts
let raw: unknown
const read = await readJsonLimited(req, MAX_BODY_BYTES)
if (!read.ok) { … }
const parsed = Schema.safeParse(raw)   // ← `raw` was never assigned
```

`raw` is `undefined`, every Zod object schema rejects it, and the route answers
`400 {"error":"Invalid input: expected object, received undefined"}` to **every** request. Confirmed
at runtime against the dev server, not inferred from reading: `POST /api/nutrition/meal-plans` with
a valid body returns exactly that.

Dead on `main`: creating a plan, renaming / activating / deleting one, restructuring it (meals per
day, training time, re-anchoring), editing a single meal, and saving dietary restrictions. TypeScript
was happy — `unknown` is what `safeParse` takes — and no test caught it, because the whole meal-plan
write surface has no route-level test.

These are `app/api/**`, which is Lane A's. Fixed here rather than handed over: it is a one-line
change per file, it blocks this entry's own stamp, and leaving a whole feature answering 400 while
the handover waited was the worse option. **`scripts/check-json-body-parsed.js`** now fails Custom
Rules on the class — for each `const <name> = await readJsonLimited(…)` it requires `<name>.body` to
be parsed. It reads the binding's own name because five healthy routes call it `result`. Custom Rules
went 52 → 53 steps.

## Verification

`e2e/plan-meal-to-saved-meal.spec.ts`, five tests: the copy's rows (a food item stored per 100 g, the
multiplier carrying the 250 g), the stamp, the kept state, "Save all 1" after one meal is already
kept, no duplicate of the first, and the From plan tag. **Assertions are on the copied rows, not on a
toast** — every button here reports success before its write resolves, so a control wired to nothing
produces the same screen.

Two fixture traps worth carrying: `saved_meals` has **no `deleted_at`** (hard delete), and
`createFoodItem` runs `sanitiseNutrition`, which recomputes calories from the macros once they
disagree by more than 40% — so a fixture with decorative macros asserts against the sanitiser rather
than against the copy.

Full local gate: 4,513 tests green, 53 of 53 Custom Rules, lint clean (0 errors), full e2e green.

**Not exercised:** the device path. The browser has no native SQLite, so `getLocalStore` returns null
and every run here took the web fallback — the local-store mirror and the outbox mutations are owed
an on-device check, as are the new controls' 48dp targets on the S25.
