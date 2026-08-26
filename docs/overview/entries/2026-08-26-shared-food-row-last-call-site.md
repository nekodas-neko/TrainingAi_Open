# 2026-08-26 — The shared food row's last call site, and the warning that had nowhere to go (Q-406)

**PR:** `docs/device-queue-all-gated` · **v1.383.5** · **Lane B** · **Gate: device**

## What was blocked

Three of `FoodRow`'s four call sites converted over the preceding days. The fourth — the external
food-database result in `ingredient-search.tsx` — stayed a bespoke `<button>`, blocked on a design
question rather than on effort.

The decided treatment (option A) was an amber icon before the calorie column, with the explanatory
sentence moved **to the food's detail**. That destination does not exist here: tapping the row runs
`addExternalFood` → `createFoodItem` + `accept()`, which adds the food outright with no inspect step
in between. Building A would have deleted the only visible explanation on a warning whose whole
purpose is to be read *before* use.

## The owner's answer, and what it costs

Asked between three ways forward, the owner chose **keep the sentence in the row**. It is what
already shipped, so there is no regression, and option B's losing reason — that it *replaced* the
serving line — does not apply to keeping it *alongside*.

**That knowingly overrides one bullet of the old design, and it is worth saying so plainly.** The
design said *"do not add a warning slot to `FoodRow`"*, written on the assumption the sentence was
leaving the row. It is not. So a slot is what keeping it costs: **one optional
`warning?: string | null`**, which three call sites omit exactly as they omit the six other optional
props already on that component. The alternative was leaving the fourth row bespoke forever, which
is the thing this entry existed to end.

## What the conversion dropped, and why nothing was lost

The bespoke row had a trailing `+` and a per-row spinner. Both are gone. `SearchResultRow`, sitting
directly above it and drawing `FoodRow` since v1.338.0, has had neither: **the tap adds the food**,
and an add affordance on top of that is precisely the per-screen difference converting these rows
exists to remove. The tapped row still identifies itself, through the `highlighted` prop that
already existed.

That check mattered — this entry's own history includes a conversion that had to wait until a delete
had been moved somewhere else first, so that no capability was dropped.

## Also

- **A hex literal went with it** — `#f59e0b` became `var(--accent-amber)`, so
  `check-hex-literals.js` drops that file's baseline row. 427 across 85 files now.
- **The row had no e2e cover at all**, which is why it survived bespoke: its search reaches Open
  Food Facts, so a live test would be non-deterministic and offline-fragile.
  `e2e/food-row-shared.spec.ts` now **stubs the route** and asserts the shared shape (calories in
  their own column), the sentence, and that the macros stay readable beside it.

## Not exercised

- **The S25.** The amber caution line is new markup inside a list, and the row lost an affordance.
  Carried as `Gate: device` and written into the device queue as N7: search the food database for a
  product whose macros disagree, confirm the sentence renders, and confirm a tap still adds.
- Real Open Food Facts responses — the spec stubs them by design, so the *presentation* is covered
  and the *matching* is not.
