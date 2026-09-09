# 2026-09-09 — the macro targets and the calorie budget are two denominators, and the card now says so (BF-134)

**PR:** `fix/macro-budget-anchor-label` · **Lane B** · `components/nutrition/energy-card.tsx`,
`components/nutrition/macro-budget-gap.ts` (new).

The owner, on the Nutrition tab: *"is this the right number? looks like its took 200 off the base
then 200 off again?"* BF-134 had already established that the reported symptom is **not** a defect —
`1,453 base − 200 for your goal` is one subtraction, not two — and that the real defect is one line
higher: macro targets of 150 P / 141 C / 55 F sum to **1,659 kcal** beside a **1,253** budget on the
same card.

## What shipped

Two pieces of copy, both on `EnergyCard`, and a tested helper behind the first.

- **`macroBudgetGap(targets, budget)`** adds up the gram targets *already on the card* and compares
  them with the budget *already on the card*. It is not a fourth number: nothing here composes a
  calorie figure from parts, which is the discipline three separate findings (Q-401, Q-417, Q-323)
  put on this component. Null below a 100 kcal gap, null on an incomplete macro target — a profile
  with protein set and carbs blank would otherwise have its unfinished state reported as a
  disagreement.
- **The card line**, whenever the gap clears that floor: what the grams add up to, how far that sits
  from the budget, and that the grams come from the stored daily goal while the budget is built from
  resting burn + goal adjustment + movement recorded. *"Two different denominators, not a
  miscalculation."*
- **The ⓘ detail** gains the sentence that closes the reported symptom: the resting burn already has
  habitual daily movement taken out of it, which is why it sits below maintenance, and that is what
  lets recorded movement be added once rather than twice — *not* a second deduction for the goal.

## The entry's own arithmetic was wrong, and correcting it is the reason a label is the right fix

BF-134 says the two numbers *"converge only once ~406 kcal is earned"*. **They never converge.**
`scaleMacrosForEarnedKcal` puts the whole earned addend into carbs and fat, so the gram targets grow
by `earned` at exactly the moment `budgetProvenance` grows the budget by `earned`. The addend
cancels. What is left is a constant `storedGoal − (restingBase + goalDelta)` — 406 kcal at every hour
of every day, and earning precisely 406 moves *both* numbers.

`components/nutrition/__tests__/macro-budget-gap.test.ts` pins it at 0 / 100 / 406 / 550 / 1200 kcal
earned. This strengthens the entry's recommendation rather than weakening it: there is nothing to
wait for, so the card has to say it out loud.

## And the surface the entry proposed could not have carried it

BF-134 recommends extending `TdeeAdaptationCard`'s `Why two numbers` block, on the grounds that the
mechanism already exists. It does — but that block is gated on `maintenance.source === 'formula'`
**and** the stored goal drifting from its recommendation, neither of which has anything to do with
the macro/budget gap. It would have explained the macros for a formula-maintenance account with a
drifting goal and stayed silent for every other, the owner's calibrated case included. The copy went
where the two numbers actually sit together.

## Sibling-surface sweep

`DaySummaryCard` (the end-of-day review) shows the same pairing — a calorie target beside macro gram
targets — and needs nothing: it is passed the **raw stored** `targets`, so its 1,660 kcal and its
1,659 kcal of grams are one anchor and agree by construction. `EnergyCard` is the only surface that
mixes the burn-aware budget with the earned-scaled grams, which is exactly why it is the only one
that disagrees. Home's nutrition card shows no macro targets at all.

## What is deliberately not done

**The anchor decision.** Whether the grams and the budget *should* share a denominator reaches
`lib/health/energy-balance-service.ts` (Lane A) and TN-29 protects the stored 1,660 kcal target. The
entry stays in the queue with `Lane: A`, `Gate: owner` and a `Keep:` line naming only that.

**Scaling the grams down to the budget was not attempted**, per the entry: a morning protein target
near 113 g that climbs through the day invites under-eating protein on a rest day, which is the worst
day to.

## Verification

`pnpm dev` on the local non-prod database, rendered at the 412 px viewport through the Playwright
harness: the card line reads correctly in **both** directions — the seeded account carries a `+300`
surplus goal and shows the macros *463 below* the budget, which is what caught an earlier draft whose
wording explained only the deficit direction. The ⓘ panel was opened and its new sentence checked
against the numbers beside it (resting burn 2,063 against maintenance 2,172).

`e2e/one-calorie-budget.spec.ts` and `e2e/macro-calorie-warning.spec.ts` — the two specs covering
this card — pass. Full unit suite 875 files / 8,225 tests green; `pnpm check:rules` **Ran 71 of 71**.

**Not exercised:** the S25 APK. This is a WebView copy change with no native or offline-first path,
so a Railway deploy delivers it, but the wrapped line lengths at real device metrics are unverified —
the paragraph is three lines at 412 px in the harness.
