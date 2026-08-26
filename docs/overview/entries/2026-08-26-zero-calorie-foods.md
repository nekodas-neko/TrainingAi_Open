# 2026-08-26 — a calorie-free food can be logged

**Branch:** `fix/zero-calorie-foods` · **Entry:** LA-30 · **Filed:** LB-15 · **Lane:** B

## What was wrong

`review-step.tsx:159` gated the primary action on `value.calories > 0`, so **every genuinely
calorie-free item was refused**: supplements, water, black coffee, plain tea, diet soft drink,
sugar-free gum, sweetener, most spices and herbs. The owner hit it on a ZMA scan the AI had read
correctly as *"It is calorie-free"* — and the only feedback was a greyed-out **Next**.

**The server never agreed with the gate.** `FoodItemFieldsSchema` is `calories: z.number().min(0)`;
the log being refused would have been accepted. Zero is a value, not a missing one.

All three of the entry's claims verified unchanged against `main` before anything was written.

## What changed

- `review-step.tsx` — a name is the only field that must be present, and **the disabled state now
  says what it wants**. That was half the bug: the report was *"it wouldn't let me log it"*, not
  *"it told me why"*, and a greyed-out primary action with no reason is indistinguishable from a
  broken app.
- `ingredient-picker.tsx:154` — the sibling surface. `!(scan.calories > 0)` classified a
  zero-calorie scan as a **failed** scan and toasted *"Could not work out the macros"*. It now tests
  that the scan *returned* — `typeof scan.calories !== 'number'` — which is what the entry suggested
  and what the rule actually is.

## The sweep found a third site, and it is Lane A's

`grep` for the same predicate across `components`, `app`, `lib` and `packages` returned four more
hits. Exactly one is the same defect:

- **`packages/shared/src/nutrition/open-food-facts.ts:58`** — `if (!(calories > 0)) return null`,
  where `null` is how the caller learns the **barcode did not resolve**. So scanning a Coke Zero
  reports an unknown barcode. Filed as **LB-15** for Lane A, because the lane rule is the path and
  this sits below both client predicates — LA-30's fix does not reach it.

The other three are **not** this defect, checked and recorded on LB-15 so nobody "fixes" them:
`macroCalorieDisagreement` returns `null` at zero because a percentage deviation against zero is
undefined (its contract), and `sanitiseNutrition` recomputes from macros when `calories === 0`,
which for a truly calorie-free item yields zero again. Both correct.

## The specs fail against the old gate

Verified by stashing the two component changes and re-running: `toBeEnabled()` fails on the
zero-calorie review step, and the missing-name message is absent. The scan route is stubbed —
what is under test is the client's handling of a zero-calorie result, not the model's ability to
produce one.

**One harness note worth carrying:** the capture tiles are a grid, and a coordinate tap that misses
`Describe it` opens **History** instead, which is a Food Library dialog with its own textbox — close
enough to the describe field that the spec filled the wrong box and failed three assertions later.
The opener now waits for the describe pane's own copy before touching anything in it.

## Gates

`pnpm check:rules` — **Ran 58 of 58**. New e2e 2 of 2, and proven to fail without the fix.

## Not verified

**Device.** The two paths are a scan review and a free-text estimate, neither of which is native —
but both are reached through sheets, and the new message is a line of copy inside one. No
`Gate: device` beyond the ordinary smoke pass.

**Not exercised:** a real zero-calorie *barcode*, which is LB-15's and needs Open Food Facts.
