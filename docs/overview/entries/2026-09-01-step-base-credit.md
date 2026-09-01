# 2026-09-01 · Lane A — steps count from the first one (BF-88)

Branch `lane-a/step-base-credit`. v1.418.0. No migration, no native change — this reaches the device
through a Railway deploy.

## The owner's question, and the version of it that works

*"is it possible to get rid of the baseline; and have it reference steps + exercise only?"* — and
then, once the first answer came back as no: *"cant we remove some calories for the base 3000 and
have it start from 0 steps?"* That second one is the shape that works, and it is what shipped.

The difference is conservation. Dropping the multiplier to 1.0 and counting every step removes
265 kcal of base and hands back 106 — a **lower** burn on **124 of 124** of the owner's days, mean
−177. Removing exactly what you hand back removes nothing: the first 3,000 steps' energy comes out
of the resting base, and the same 3,000 steps are then counted.

## What it changes, measured

| steps | 0 | 1,196 | 2,000 | 3,000 | 5,000 | 10,000 | 15,000 |
|---|---|---|---|---|---|---|---|
| delta | −110 | −66 | −37 | **0** | **0** | −1 | **0** |

Identical at and above 3,000. Below it the day drops, which is the intent: a day with no walking
should not be paid for incidental walking that did not happen. Reproduced on the dev server against
the real route — at 3,000 steps `restingBase 2087 + active 110 = 2197`, which is exactly what the
base alone read before.

## Three things that had to be got right, and one that nearly was not

**The credit is computed, never a constant.** 110 kcal for one profile, 102 for the owner's,
different again for anyone lighter. `stepEnergyKcal` in `daily-energy.ts` is the single conversion,
so the amount subtracted from the base is by construction the amount `computeActiveEnergy` adds
back. Two MET calls with different arguments would leave a silent per-day drift that no test of
either half alone would catch.

**Formula path only.** On the calibrated path the base is `maintenance − avgActiveKcal` and
`maintenance` is measured, so lowering the step floor raises `avgActiveKcal` and the subtraction
happens by itself. Applying the credit there too double-subtracts it. **That mutation survived every
test in the file** until a calibrated-path case existed — the entry warned about it in as many
words, and the warning alone did not catch it.

**And `formulaBaseline` has two consumers, which the entry does not say.** It is the resting base
*and* the uncalibrated maintenance estimate. Subtracting the credit there would move both, cutting
the user's recommended intake by ~100 kcal a day — a different change from the one that was
approved. Every relative assertion still passes under that version, including
`maintenance − restingBase === activeKcal`, because both sides shift together. Only an anchor the
mutation cannot move catches it, so the test recomputes the expected maintenance from the same
inputs with the same function rather than pinning a figure that would go stale.

## The rename was the mechanism, not decoration

`STEP_BASELINE` → `STEP_BASE_CREDIT`. The value stays 3,000 and its meaning inverts: it was steps to
skip, it is now steps whose energy is credited out of the base. **A test pinning `3000` cannot
notice a change of meaning**, so the rename is what broke every consumer on purpose and made the
compiler produce the list — including the three copy sites that would otherwise have gone quietly
false.

## The copy BF-87 shipped that day, now retired

BF-87 merged hours earlier and put a threshold into three sentences — *"steps count above
3,000/day"*. There is no threshold any more, so all three are rewritten here rather than left as a
follow-up: the two *"calories out"* explainers say **every step you take**, and the zero-state line
means what it now can mean — *"no movement recorded yet today"*. The case BF-87's line explained,
steps on screen earning nothing, cannot arise.

Its test moved with it. The assertion that a short day earns **zero** is now the assertion that it
earns **something**.

## Deliberately not done

A TEF term from logged intake is the genuinely more accurate version and is unusable at current
logging density — 45 of 124 days carry a plausible intake, so it would vanish on two-thirds of days
and make burn swing on whether food was logged.

`SEDENTARY_MULTIPLIER` is a Mifflin **BMR** activity factor applied to a **measured RMR** since
BF-42. Those are different quantities and the factors were never validated against the second. For
this owner measured (1,325) sits below predicted (1,481), so the direction is not clearly an
over-count; filed as a known imprecision, not touched here.

## Verification

Full suite **717 files / 6,118 tests** green; `pnpm check:rules` **Ran 67 of 67**. Five mutations,
all killed: no credit applied, credit hardcoded, credit taken off maintenance too, credit applied on
the calibrated path, and the step threshold restored. Exercised on `pnpm dev` across 0 / 1,196 /
3,000 / 10,000 steps with the target unchanged at every one, and no stale copy served on
`/nutrition` or `/health`.

**Not exercised:** the APK. Nothing native changed and no offline-first write path is touched, but
the cards themselves have only been seen in a browser.
