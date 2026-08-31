# 2026-08-31 — a re-scanned label is recognised instead of copied again

**Branch:** `fix/shared-label-rescan-duplicate` · **Entry:** LB-34 · **Lane:** B · **Version:** v1.413.1

## The bug

`saveSharedMealToLibrary` minted a new `saved_meals` row on every scan. A label is a physical
object that gets scanned by whoever picks it up — a partner checking the fridge on Tuesday and
again on Friday ended up with two identical meals, and nothing marked either as the copy. Filed
while building BF-57 rather than folded into it, because the fix is a product question and that PR
was already large.

## What shipped

**`sharedMealTotals()`** (`components/nutrition/save-shared-meal.ts`) — the payload's whole-recipe
macros, which is what `findDuplicateMeal` compares. Summed directly rather than through
`sumIngredients`: that helper takes the per-100 g `NutritionIngredient` shape, and a
`SharedMealIngredient` already carries its macros for its own weight, so routing them through it
would convert twice to arrive back where they started.

**The scan path now asks before it writes.** `findDuplicateMeal` is the same test a save already
uses — a normalised name match **and** macros within `DUPLICATE_MAX_FIT_DISTANCE`, both required —
so two genuinely different recipes that share a name still both save. That two-test shape is why
this was small: no new threshold was invented.

## Three decisions

**The library read is local-first and never touches the network.** A shared label's whole point is
that it works in a kitchen with no signal; a duplicate check that needed a fetch would trade the
feature's main property for a nicety. With no local store and no warm cache the scan just saves —
under-matching is the documented preference here, because a duplicate is a nuisance and a
wrongly-suppressed save is a lost recipe.

**An action, not an Undo — and this departs from what the entry proposed.** LB-34 guessed a toast
with Undo, by analogy with BF-74's photo remove. That analogy holds for an action that already
happened; here nothing has been written, so there is nothing to undo. The toast says the meal is
already saved and offers **Save a copy**, which is the thing a user might still want: two friends
can genuinely cook the same-named dish, and they are the one who knows.

**The duplicate branch returns before the save.** A check that found the duplicate and saved anyway
is the bug with extra steps, so that early return is what the guard below actually asserts.

## Verification

- `pnpm check:rules` **Ran 65 of 65 Custom Rules steps**, all passed. Full unit suite green.
- **Five unit tests** on `sharedMealTotals`, **all four guards mutation-checked**: the NaN guard,
  the calorie rounding, the 1 dp macro rounding, and that the totals are whole-recipe rather than
  per-serving (dividing by `servings` fails).
- **A source-level guard** in `shared-meal-scan-path.test.ts`, **mutation-checked four ways**:
  removing the check, removing the early return so it saves anyway, turning the local read into a
  `fetch`, and removing the escape hatch each fail it. Source-level because both vitest projects run
  `environment: 'node'` — nothing renders — and the branch is reached only from a camera.
- It strips comments before matching. The handler explains the check in prose naming both helpers,
  and a bare-word assertion would pass on the comment documenting its own fix — the shape that has
  slipped through three times in this repo.

**Not exercised:** the scan itself. It needs a camera — the Capacitor plugin on device,
`getUserMedia` on web — so no run of this has decoded a real label. The local-store branch is also
unexercised: `getLocalStore` returns null off-device, so every path here took the cache-seed read
rather than the SQLite one a real scan takes.

## Also in this diff

Two findings, filed rather than folded in.

**LB-37 — `tsc` typechecks nothing under `__tests__`.** Found by noticing that a spec I had just
written used two types it never imported and still passed. `tsconfig.json` excludes
`**/__tests__/**`; appending `const deliberateTypeError: number = "not a number"` to a spec produces
**zero** errors. Every session treats a clean `tsc` as its first gate and CI's Build job runs the
same project, so across ~700 unit-test files a spec can reference a type that does not exist or
assert against an interface that has changed shape, and nothing says so. `e2e/` is not excluded and
is typechecked normally. The entry says to measure what the exclusion is hiding before deleting it.

**LB-38 — the share-code e2e decode fails intermittently on `main`.** It went red on #700, which
does not touch the label renderer, and reproduces on a clean checkout. The entry carries what is
established (six null decodes; failing runs 2.8 min against 50 s passing; the passing canvas decodes
under all four decoder configurations tried), **one hypothesis already falsified** so nobody
re-derives it, and the current unverified one with the single measurement that would settle it.
