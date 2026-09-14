# 2026-09-14 — two things the nutrition surface knew and did not say (LA-102 + TN-28)

**Branch:** `feat/nutrition-budget-honesty` · **Lane B** · v1.456.4 · batched

Batched because one verification pass covers both: same screen, same payload, and the fixture that
renders the nudge card also opens the ⓘ panel.

## LA-102 — what the base leaves out

Owner, on the resting-rate-anchored budget: *"1350 doesnt count some basic metabolic needs".*

He is right. RMR excludes the **thermic effect of food** (~10% of intake) and **non-step NEAT** —
standing, fidgeting, housework. BF-152 chose not to model either, and that decision is sound: a
multiplier *asserts* the overhead happened where the step credit *observes* it, and treating
intake-linked digestion as an earned credit makes the budget grow as you eat, a feedback loop the
card would then have to explain for a number inside food-logging error.

So the fix is copy. The ⓘ panel now carries a paragraph naming both omissions and saying the true
burn runs a little above the shown base on a still day. It is deliberately separate from the
paragraph above it: that one is about not *double-counting* movement that does get added, and these
two are never added by anything.

## TN-28 — the card that writes your goal

`TdeeAdaptationCard` renders the maintenance figure with a one-tap **Use 2,045** that writes straight
into the calorie goal — and it was the only surface omitting the confidence qualifier.
`energy-card.tsx` and `calorie-balance-bar.tsx` both already printed *"(low confidence, 10 of 14 days
logged)"* from the same payload fields. The estimate behind the owner's screenshot carried
`confidence: 'low'` with a 95% interval of **[1,990 – 2,500] kcal**: a 510 kcal band presented as one
number with a button under it.

Now it prints the siblings' exact wording. The action is **not** gated on confidence — that is
TN-27's trade, and this entry says so explicitly.

## The third finding: the ⓘ copy existed twice, and had drifted

Neither entry mentions this. Doing them together surfaced it.

`energy-card.tsx` and `calorie-balance-bar.tsx` each held the same three paragraphs inline — and the
card had grown a fourth (BF-134's resting-burn explanation) that the bar never got. So the same
figure came with different explanations depending on which screen you opened it from. Adding
LA-102's sentence to both would have made it three paragraphs out of step instead of one.

`calorie-zone-bar.tsx`'s own comment names the class: *"two hand-maintained copies of this scale is
the drift class that put two different calorie budgets on one screen."*

Both now render one `components/nutrition/energy-explainer.tsx`.

**A pre-existing guard caught the extraction, and it was right to.**
`movement-breakdown.test.ts` asserted that *both* files contain `every step you take` — a
source-text check that existed because the copy was duplicated. It is repointed at the single
explainer, plus a new sibling check that neither host re-states the copy, which is what stops the
drift returning. The invariant survives and can no longer be half-satisfied.

## Verification

`e2e/nutrition-budget-honesty.spec.ts` stubs a calibrated, low-confidence, drifting payload — the
estimator is not what is under test, the two sentences are, and building a real calibration means a
fortnight of logged intake against a weight trend. **Both tests fail against unpatched
`components/`.**

`pnpm check:rules` **Ran 74 of 74** · `npx tsc --noEmit` clean · `pnpm lint` 0 errors · `vitest`
817 passed · `bf154-budget-breakdown-reconciles` and `calorie-progress-bar` still green.

**Three drafts of the LA-102 test failed for three separate reasons, none of them the app:**

1. Clicked every `aria-expanded="false"` button on the page rather than the ⓘ — opened meal
   accordions and never touched the panel. Its accessible name is *"How energy balance is
   calculated"*.
2. `locator.click()` does not reach controls on the Nutrition tab. This is a standing gotcha in the
   lane's own baton and it still cost a run; `el.evaluate(e => e.click())` works. The test now
   asserts `aria-expanded` flipped, so a silent no-op fails at the click rather than downstream.
3. `getByText` resolved to the emphasised `<span>` inside the paragraph — four words, none of the
   substance — so `toContainText(/digest/)` could never pass. Scoped to the `<p>`.

## What was NOT exercised

- **No device.** 412 dp in Chromium. Two paragraphs were added to a panel that is already dense;
  how it reads on the S25 is unchecked.
- **The panel was only opened from one host.** Both render the same component, so the bar's copy is
  covered by construction — but the bar's ⓘ was never clicked, and it is the surface that just
  gained BF-134's paragraph it never had.
- **No real calibrated maintenance.** The nudge card has only been seen against a stub, so the
  qualifier has never been rendered from a figure the estimator actually produced.
