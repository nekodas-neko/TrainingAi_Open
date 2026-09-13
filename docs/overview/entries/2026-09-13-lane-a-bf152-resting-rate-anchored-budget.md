# 2026-09-13 — the calorie budget anchors to a rule, not to a number (BF-152)

**Branch:** `lane-a/bf152-budget-anchors-measured-rmr` · 1 shared formula, 1 service, 4 components,
2 new test files, 4 rewritten. No migration, no schema change, no APK.

## What changed

`budgetProvenance`'s zero-movement base was the user's **stored calorie target** (BF-150, yesterday).
It is now their **resting rate** — the clinically measured RMR re-scaled onto today's fat-free mass
when there is one, the predicted BMR otherwise. The earned half is untouched.

The owner's spec was a rule rather than a figure: *"Rmr+body metabolism as base — Calories burned per
day based on HR/exercise … It should start at 1350 - and as I walk/workout - move throughout the day
to 1600."* BF-150 gave him a number that happened to be close; this gives him the rule, which keeps
being right as the number moves.

## Why the stored target was the wrong anchor even though it fixed a real problem

BF-150 was escaping a resting base the maintenance estimator had inflated — it climbed 2,150 → 2,196
in a day and reached 1.44 × his Mifflin BMR in a field labelled *resting* (BF-137). That escape was
correct. What it cost was an anchor a human typed once, and his body is moving under it: **72.1 kg at
the RMR test on 2026-08-27, 70.2 kg on 2026-09-13.**

The number he asked for was already computed, one scope away. `energy-balance-service` derives `bmr`
as `personalRmr(measured, todaysFfm)`:

| | value |
|---|---|
| measured RMR (2026-08-27, 51.5 kg FFM) | 1,325 |
| Cunningham residual, `1325 − (51.5 × 21.6 + 370)` | −157 |
| FFM today (70.2 kg at 25.5%) | 52.3 kg |
| **re-scaled RMR today** | **1,342** |

His *"start at 1350"* is his own measured resting rate to within 8 kcal, and it tracks the weight loss
on its own. **`restingBaseKcal` is not that number and must not be mistaken for it** — on the
calibrated path it is `maintenance − avgActive`, so it carries exactly the inflation BF-150 fled. The
service passes `bmr`, and the mutant that passes `restingBaseKcal` instead is pinned by a test.

## What the entry got right, and the one thing it did not have to settle

Every arithmetic claim in BF-152 survived contact with the code, which is unusual here — the
Cunningham constant, the residual, the 1,342, the observation that the earned half needed no work.

Its one overrulable line was how to treat the residual: RMR excludes the **thermic effect of food**
(~10% of intake) and **non-step NEAT**. `bmr × 1.2` is **1,611** on his figures — his own *"1600"* —
and the entry recommended crediting that overhead through observed movement rather than asserting it
with a multiplier. Kept as specified: a multiplier asserts the overhead happened, the step credit
observes it, and modelling intake-linked TEF as an earned credit makes the budget grow as the user
eats. **That leaves the copy owing an explanation, which is filed as LA-102 (Lane B) rather than left
implicit.**

## Verified

- **Mutation pass: six mutants, all killed; two deliberately equivalent controls survived.** The one
  worth naming is M1 — the service handing `restingBaseKcal` instead of `bmr`, which every formula
  test passes through while the screen shows the inflated figure. BF-150's own service test existed
  because that shape survived its first pass, so this PR replaced it rather than deleting it. The
  surviving controls were `> 0` written `>= 1` (not equivalent in principle, equivalent for every
  reachable kcal) and a tautological re-spelling of the same guard.
- **Live on `pnpm dev`, both surfaces, one number.** `GET /api/nutrition/energy-balance` returns
  `restingRateKcal: 1815` for the seeded profile (no measured RMR, so the predicted path), and the
  rendered line reads `1,815 resting rate — no movement recorded yet today` on the Nutrition tab and
  on Home, where the donut reads `1,815` and the ring `1,815 kcal left today`. The pre-change budget
  for that fixture was `2069 + 300 = 2,369`.
- `pnpm check:rules` ran every Custom Rules step; full suite green with `DATABASE_URL` set.

**Not exercised:** no device, no APK — this is JS/server only, so Railway delivers it. The owner's own
figures (1,342 from a real measurement) are asserted in tests against production-read values but were
not observed on his account; the seeded profile exercises the *predicted* branch, and the measured
branch is covered by unit and service tests only.

## One thing worth carrying

**The E2E spec needed no edit, and that is the whole argument for LB-100's shape.** It asks
`budgetProvenance` for the budget instead of transcribing it, so re-anchoring the budget twice in two
days cost it nothing. The earlier version — `restingBase + targetNet + earned` — would have gone red
against a correct card for the second time in two days, and the reflex reading of that is "stale
fixture".
