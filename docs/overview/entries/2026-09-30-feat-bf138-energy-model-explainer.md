# 2026-09-30 — BF-138: say where the calorie numbers come from

**Branch:** `feat/bf138-energy-model-explainer` · v1.486.3. **No calculation is touched.**

Owner, after four screens showed four figures: *"I thought it was eat to 1350 + excercise amount
right? im getting confused- can we have a central idea of everything"*.

## Re-verifying the entry found most of it already built

BF-138's recommendation is *"one explainer, reachable from every number it explains … not a tooltip
per surface — that is how three surfaces came to describe the same model in three vocabularies"*.

**That explainer exists.** `components/nutrition/energy-explainer.tsx` is one shared component
rendered by both surfaces that show these figures, and its own docstring records that it was created
because `energy-card.tsx` and `calorie-balance-bar.tsx` each held the same paragraphs inline and had
already drifted. It postdates the entry. **Building a fresh explainer would have produced a third
copy of the thing the entry complains about.**

So the work was the three things it did not yet say — all from values already passed to it.

## What was added

**① The chain from the number he knows to the number on screen.** He knows his own measured resting
rate, saw a different base, and reasonably suspected an error; every step between was sound and
stated nowhere. Now stated endpoint to endpoint — `restingRateKcal` → `restingBaseKcal` — with the
steps between in words. **Deliberately not as figures:** the ×1.2 multiplier and the step credit are
intermediates this payload does not carry, and deriving them client-side would be the second
implementation of a calculation this entry forbids touching.

**② "Why two numbers", generalised.** BF-134 added that block to `tdee-adaptation-card` behind
`source === 'formula' && drifts`, so the reconciliation was missing from the surfaces where the
numbers actually appear. It now names the saved goal beside today's budget wherever they differ by
≥100 kcal, and **states the relationship rather than picking a winner** — which is right is a
calibration question `BF-137` and `TN-29` own, and this entry must not answer it.

**③ What is actually measured.** The entry's sharpest point: *"the most useful sentence available to
this owner is not any estimate — it is 'your weight was flat across 29 days'"*. That now closes the
panel, distinguishing the one observation from the estimates above it.

## The browser test earned its place three times over

All three paragraphs are conditional, and `BF-220` the previous day showed what that costs: copy
mounted where it cannot be seen is the same defect as no copy, and no unit test finds it. So each is
asserted present when its guard holds and **absent when it does not**, the absent case anchored on a
line that is not conditional so it cannot pass by having failed to open the panel.

Three things the run taught that reading the source did not:

- **Without `ensureEnergyBalanceProfile()` the panel never mounts.** The route answers
  `balance: null` for the seeded user, who is missing only a date of birth, and the card renders
  *"Add your date of birth in Profile"*. `fixtures.ts` already records this as why `Q-402`'s fix could
  not be driven end to end.
- **⚠ Two controls share the accessible name `"How energy balance is calculated"`** —
  `energy-card.tsx:218` and `calorie-balance-bar.tsx:75` — and the tab shell keeps both trees
  mounted. A document-wide `.first()` clicked the **off-screen** one for 60 seconds while
  `aria-expanded` stayed `false`, which reads as a dead button and is a mis-aimed one: the class
  `tapInView` exists for. **Filed as `LB-189`, not fixed here** — renaming a control is a product
  change outside this entry's scope.
- **The panel's open state is local to a card that revalidates in the background**, so one click
  followed by an assertion is a race; the retry waits on `aria-expanded` rather than sleeping.

## Verified

`e2e/bf138-energy-model-explainer.spec.ts` — **2 passing**: one test on the guards-on payload, one on
the guards-off one. `npx tsc --noEmit` · `pnpm check:rules` **Ran 84 of 84** · `pnpm test`
**11,044 passed** · size gate clean.

> **Corrected 2026-09-30 (LB-189).** This said **"4 passing (2 tests × the guards-on and guards-off
> payloads)"** and the file holds **two** `test()` blocks, one payload each. The 4 was Playwright's
> run total, which counts the `auth.setup.ts` and `zero-data.setup.ts` projects alongside the specs —
> so every spec run in this repo reports two more than it has. `grep -c '^test('` is the count to
> quote. The same slip is corrected in `2026-09-29-chore-bf220-rpe-reaches-nothing.md`.

## Not exercised, and one thing deliberately not done

- **The device.** This is an ⓘ panel of dense small text; whether five paragraphs plus three new ones
  still reads on the S25 is a look, and no container can answer it.
- **The real numbers.** The spec overlays the payload, so the paragraphs were proven to render from
  *given* values. The owner's actual figures come from his own profile.
- **The file sits below RV-209's 11px type floor throughout** (`text-[10px]`, on every paragraph).
  That guard only scans `components/workout/`, so nothing stopped me matching it — and matching it is
  what I did, because converting the panel is a visible restyle of a screen he uses and smuggling it
  into a copy-only PR is the wrong way to make that change. It wants its own entry or to ride with
  the next deliberate pass over this surface.
