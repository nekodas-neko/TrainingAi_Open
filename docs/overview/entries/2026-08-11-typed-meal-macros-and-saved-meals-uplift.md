# 2026-08-11 — Typed meals get real macros, and Saved Meals gets a UI (Q-194, Q-195)

**Branch:** `feat/meal-plan-text-macro-lookup` · **Domain:** `nutrition`
**Follows:** [`2026-08-11-meal-plan-edit-and-your-own-meals.md`](2026-08-11-meal-plan-edit-and-your-own-meals.md)

> can we have it look up macros for the text - meals we normally eat?

> while doing this can we also update the UI of the saved meals. this will become an important part
> of the nutrition setting it needs a UI uplift. […] as well as confirmation for deleting /
> selectable and having a breakdown of ingredients / overall view should be more descriptive

## Typed meals stop being second-class

The previous session shipped "Meals you already eat" with two tiers: a library meal was kept
verbatim because it had macros, and typed text could only steer the model because it did not. That
split was real but the wrong side of it was doing most of the work — typing is how you actually
describe your current diet.

**No new AI route.** `POST /api/nutrition/scan` already does text → nutrition and already returns
the exact `NutritionIngredient` shape the plan's portion scaler works in. The picker calls it on
add; the row appears immediately and fills its macros in, so it is never blank while it waits.

A resolved meal gains a **Keep this meal exactly** toggle and counts against the keep limit. One
that fails to resolve stays a steer and says so — it does not silently claim macros it does not
have.

Measured: "200 g chicken with rice and broccoli" → *Chicken with rice and broccoli*, 267 kcal /
34P / 22C / 4F, three ingredients. Note the estimate ignored the stated 200 g and returned 100 g of
chicken. That is the scan route's own behaviour and it matters less here than elsewhere, because
the plan resizes every kept meal to its slot's target anyway — what the lookup has to get right is
the *ratio* and the densities, not the absolute portion.

## The prompt bug this exposed

The first end-to-end run put the kept meal in slot 0 **and generated it again in slot 1**. The
instruction said the kept meals were "FIXED — do not repeat or restate them", and the model repeated
them anyway.

The per-meal reroll route already had wording that measurably works, so the whole-plan route now
uses it: the plan *already contains* these, and everything returned must be genuinely different
food — different protein, different carb, different style. Re-measured: three distinct meals, and
the free-text steer ("something with salmon") landed correctly in one of them.

Worth remembering as a pattern: **"do not repeat X" is weaker than "X is already there, give me
something different"**, and the difference showed up only by reading a real generation.

## Saved Meals

The old row was a name, a totals line, and ingredient names with a bare `×1` — the multiplier being
the only per-ingredient number, and the least useful one, since it says nothing about how much food
that is. New `SavedMealCard`:

- **Overview**: calories, total weight, item count, and a macro split bar showing where the calories
  come from. The bar is energy share, not grams — grams would make fat look like a third of what it
  contributes. Numbers sit beside it, so nothing is carried by colour alone.
- **Tap to expand**: every ingredient with its weight, calories and its own P/C/F.
- **Delete asks first**, inline. It previously fired on the first tap of a small icon sitting
  between two other small icons, with a toast after the fact as the only feedback.
- **Select mode** for deleting several at once, with its own confirmation. Deletes run sequentially,
  not `Promise.all` — each one queues an outbox mutation and firing a dozen concurrently at the
  local store is how the push loop races itself.

The card is a `role="button"` div rather than a `<button>`, because it contains other controls and
Samsung's WebView strips the inner one.

## Verified / not verified

Full suite green, 17 custom rule checks, tsc and lint clean. Exercised live: the text lookup, and a
full generation with a typed kept meal plus a free-text steer. Rendered at the 412×915 S25 viewport:
the picker mid-lookup and resolved, and Saved Meals collapsed, expanded and in select mode.

**Not verified on device.** Safe-area insets read 0 in the sandbox. The bulk delete path writes
through the local store and outbox, which has no native SQLite here — deleting several meals offline
is the case worth watching, since that is where the sequential-vs-parallel decision above actually
matters.
