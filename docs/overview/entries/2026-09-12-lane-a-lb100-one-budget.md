# 2026-09-12 — LB-100: BF-150 left the Nutrition ring counting against the old budget

**Branch:** `lane-a/lb100-one-budget` · **Agent:** Implementation Lane A

## What happened, stated plainly

BF-150 (mine, merged earlier today) anchored the day's budget to the stored calorie goal in
`budgetProvenance`. It did **not** update `computeCalorieBalance`, whose `deviationKcal` was still
`net − targetNet` — that is, intake measured against `restingBase + active + goalDelta`, the old
expression. Everything the user reads about "left" and "over" comes off that deviation:
`remainingKcal`, the zone band, its label and its colour.

So Home's donut counted against `goal + earned` while the Nutrition ring's *"N kcal left"* counted
against the estimator — **469 kcal apart in the e2e fixture, ~336 for the owner**. That is the exact
defect Q-415/Q-417 fixed in v1.335.0, reintroduced.

**`e2e/one-calorie-budget.spec.ts` caught it on BF-150's own pre-merge run and I merged anyway.**
E2E is advisory rather than a required check, so nothing blocked the merge and nothing recorded that
it had gone red. Lane B found it on #1129's CI and filed LB-100.

## The entry named two candidate causes; it is the first

LB-100 deliberately refused to pick between "the surfaces disagree" (①) and "the spec is stale" (②),
and gave a discriminator. Reading the spec first suggested ②, and that reading was wrong — which is
why the entry's instruction to run it mattered:

- Reproduced locally on a tree containing BF-150: **1 failed, 4 passed**, matching the filing.
- The entry warned a `dialog "Morning Check-in"` might be occluding the donut. Probed directly: **no
  dialog was open**, so that explanation is ruled out rather than assumed away.
- `energy-card.tsx:83` is `const remaining = b ? b.remainingKcal : …`, and `remainingKcal` is
  `−deviationKcal`. That is the proof: the ring reads a number BF-150 never touched.

**Why the ring's own test kept passing** — the asymmetry the entry flagged — is that it asserts
`${earned} earned from movement`, a substring that survived the provenance rewording, and its
"kcal left" branch falls back to `Goal reached` when the figure goes non-positive. It agreed with the
stale expression by luck, not by measurement.

## The fix

`computeCalorieBalance` measures the deviation against `budgetProvenance(...).total` instead of
re-deriving a second expression. One budget, one formula — which is what Q-415/Q-417 concluded and
what got lost.

`expenditureKcal` and `netKcal` are untouched: they measure burn, not budget, and a test pins that.

## The spec had a second copy of the formula, and that is the deeper fault

`budgetFromRoute` transcribed `restingBase + targetNet + earned` rather than asking the shared
function. A second implementation cannot tell you which side is wrong when it drifts — it just goes
red and invites "the fixture is stale". It now calls `budgetProvenance`. Its discriminator assertion
was inverted for the same reason: it asserted the real budget must **differ** from
`BASE.calories + earned`, which anchoring made the correct answer, so it would have begun failing for
being right. It now separates from the pre-BF-150 expression instead.

## Verification

- The failing spec: **1 failed / 4 passed → 5 passed**.
- Six unit tests pinning the invariant in `packages/shared`, where they run on every commit rather
  than only when a browser job is green — including the 469 kcal drift as a named case, and a day
  that reads "over" against the real budget while the old expression called it "on target".
- **Mutation pass — 4 planted defects, 4 killed:** deviation reverted to `net − targetNet`; the
  anchor ignored; earned movement dropped from the budget; the sign flipped. The equivalent control
  (rounding intake via a local) survived.
- Full suite green (8,450 tests) with a `DATABASE_URL`; lint green.

## What I should have done differently

Merged on a green E2E rather than treating "not a required check" as "not a signal". The check run
was visibly red on my own PR before I merged it.

## Not exercised

No device run; server-computed and reaches the APK through Railway. The corrected "kcal left" figure
has not been seen on an S25.
