# 2026-08-26 — a calorie-free product is not a missing one (LB-15)

**Branch:** `fix/zero-calorie-barcode` · **Lane A** · v1.383.1

## The defect

`offProductToNutrition` returning `null` is how the barcode and search routes learn that **a barcode
did not resolve**. Its guard was:

```ts
const calories = Math.round(perServing(n['energy-kcal_serving'], n['energy-kcal_100g']))
if (!(calories > 0)) return null
```

`perServing` returns `0` for a missing field, so **zero and absent were indistinguishable**. A
genuinely calorie-free product — sparkling water, Coke Zero, sugar-free gum, most supplements — came
back identical to an unknown barcode, and the app told the owner their real, scannable product was
"not found".

## The fix

Ask whether the product *carried* an energy value, rather than what the value was:

```ts
if (kcalServing == null && kcal100g == null) return null
const calories = Math.round(perServing(kcalServing, kcal100g))
if (calories < 0) return null
```

**The negative guard is deliberate, not incidental.** The old `> 0` test rejected a negative energy
as a side effect. A negative is corrupt data rather than a calorie-free food, so that behaviour is
kept explicitly instead of being lost along with the zero case.

## Lane, and why the letter is misleading

Filed as `LB-15` from LA-30's sibling sweep, so its letter is Lane B's — but the letter records who
*found* an item, never who ships it, and the ownership rule is the **path**:
`packages/shared/**` is Lane A. The entry says so itself.

**LA-30 did not fix this.** That cleared the two client-side predicates; this sits below both, so the
barcode path stayed broken after it. `app/api/nutrition/food-search` shares the same mapper and gets
the fix for free.

## Sibling sweep

Four other `calories > 0` guards exist and **all four are correct**, checked rather than assumed:

| site | why it is right |
|---|---|
| `scan-totals.ts:106` (`macroCalorieDisagreement`) | a percentage deviation against zero is undefined — its contract |
| `scan-totals.ts:142–143` (`sanitiseNutrition`) | recomputes from macros at zero; for a truly calorie-free item that yields zero again |
| `goal-recommendation.ts:112` (`reconcileDailyMacros`) | a daily calorie *target* of zero is meaningless; the guard means "don't reconcile against nothing" |
| `review-step.tsx:162` | already carries LA-30's comment explaining the same fix at the client layer |

## Verification

Five new fixtures, exactly the two the entry asked for plus the edges: energy present-and-zero
resolves (per 100 g **and** per serving), absent still returns null, an ordinary product still
resolves with its real value, and a negative still returns null.

**Mutation-tested with applied-proof**, including restoring the original buggy guard verbatim — it
fails two tests, which is the regression proof. Dropping either half of the new guard fails its own
test. Full suite, `pnpm check:rules`, `tsc --noEmit`, lint.

## Not exercised

**No live Open Food Facts access from here**, which is why the entry was filed "read from source, not
reproduced" and why it stays partly that way: the fixtures encode what an OFF product *looks like*,
so this proves the guard's logic rather than that a real Coke Zero barcode now resolves. That check
is item 1 on `docs/device-verification-queue.md` and needs the phone. Also not exercised: native
SQLite, safe-area, Samsung WebView.
