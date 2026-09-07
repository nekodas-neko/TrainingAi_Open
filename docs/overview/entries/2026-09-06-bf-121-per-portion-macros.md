# 2026-09-06 — BF-121: the meal builder divided the calories and not the macros

**Branch:** `fix/bf-121-per-portion-macros` · **Lane B** · v1.436.25

The owner: *"for the meal creator when adding in serving size it would be good to see the macros per
serve."* His screenshot — *Protein Pancakes*, 4 portions — read
`BATCH 983 kcal · 52 P · 103 C · 39 F` and, at the far right, `246 / portion`.

## One row, two denominators, one of them labelled

`Math.round(batchKcal / servings)` produced the `246`. The three macros beside it printed raw batch
figures. So a reader dividing 52 P by 4 in their head was doing arithmetic the footer already did for
the number next to it.

**And the same meal's detail sheet reads the other way round**, which makes this a consistency bug
rather than a missing feature: `meal-detail-sheet.tsx` states outright that its *"macro columns are
per portion — that is what `Log this meal` writes."* The builder's own body text was the third voice:
*"Logging this meal… takes one portion — 246 kcal of the 983 below."*

## Both denominators, each labelled

Two lines — `Batch` and `Per portion` — rendered through **one** `MacroLine` component. Two
instances rather than two copies, because two copies drifting apart in format is the shape of the bug
being fixed.

**A second line, not six more numbers on the first.** That row already carried a label, a kcal figure
and three macros. The entry flags width as the real constraint and names the precedent: **BF-116**,
one screen over, where Home's header chips overflowed into the action buttons once a third chip
arrived. Squeezing is how that happened.

The batch total stays. It is what the ingredient list sums to and is the useful figure while a whole
tray is being entered, so replacing it would trade one confusion for another.

## Divide, then round

`perPortion` divides and the render rounds. Rounding first would make the footer disagree with the
diary row the log later writes, which is the number the owner actually compares against.

Dividing the batch sum is **exact**, not an approximation of the canonical path: `oneServingItems`
scales each ingredient's `quantityMultiplier` by `1 / servings`, and the totals are a linear sum of
those, so `batch / servings` and `sum(perPortionRows)` are the same real number. A test drives both
routes over the same fixture and compares them rather than asserting that from the comment.

`servings` of 0 or less falls back to the batch — the same guard `oneServingItems` uses.

## Verified

Ten unit cases: the owner's own figures (983/4 → 246 kcal, 13 P, 26 C, 10 F), that the calorie number
already on screen does not move, that dividing precedes rounding, the one-portion and
cannot-divide fallbacks, and the equality with `oneServingItems` above. Three source guards: the
inline `batchKcal / servings` is gone, both lines are labelled, and `MacroLine` is defined once.

`tsc` clean · lint clean · `pnpm check:rules` **Ran 68 of 68** · full unit suite green.

**CI's Build failed first, and the reason is worth carrying.** `npx tsc --noEmit` was clean and said
nothing, because `tsconfig.json` excludes `**/__tests__/**` — the whole point of LB-37 and of
`scripts/check-test-typecheck.js`, which runs inside the Build job. A **new** spec is checked
immediately rather than baselined, and this one had five errors in one hand-written `reduce`
callback. Local `next build` passed too, since the typecheck is a separate step after it.
**The gate to run before pushing a new test file is `node scripts/check-test-typecheck.js`, not
`tsc`** — and the fix was to type the fixture as `SavedMeal` rather than `any`, so a shape that
drifts from the real type fails here instead of passing by being untyped.

## The width question, answered — by a spec that already existed

**`e2e/edit-meal-batch-footer.spec.ts` covers this footer**, and it was asserting the old one-row
form: `${BATCH_KCAL / 2} / portion`. So this change broke a spec, and the repo-wide E2E redness would
have hidden that — which is the trap in treating a red job as uniformly not-mine.

Updating it turned the gap into coverage. It now runs at **412 × 915** and asserts, after scrolling
the ingredient list to its end, that **both** `Batch` and `Per portion` are `toBeInViewport()` along
with the Save button, that each macro letter appears exactly **twice** with the batch and per-portion
values both visible (`59 P` and `30 P`, `48 C` and `24 C`, `13 F` and `7 F`), and that the old
one-row form is gone. A second line that wrapped or pushed the Save button off screen fails it. **4
passed.**

That is the width check this entry warned about, and it is now permanent rather than a screenshot.

## What learning to drive this surface cost

`page.touchscreen.tap` on a bounding box inside a `toPass` loop (`empty-meal-library.spec.ts`), not
`.click()`; the harness and its stored session cookie belong to port **3100**
(`playwright.config.ts:23`), not 3000; a cold route needs 30–60 s, not the 8 s an ad-hoc script tends
to allow. All three were mistaken for application defects earlier today before being run down — one
published as a wrong cause and retracted. **The lesson is to reach for the existing spec rather than
an ad-hoc script**: the harness solves all three, and it did here.

## Not exercised

**Not verified on the device.** The emulated viewport is the layout check; the S25 is still the
canonical runtime, and the per-portion figures should be read against the detail sheet and a logged
portion in the diary there.
