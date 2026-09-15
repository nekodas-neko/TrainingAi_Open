# 2026-09-15 — inferred contributors, and what a pillar actually requires

**Tuning.** Docs-only. TN-38 task C changed shape twice in one day against owner pushback, and
landed somewhere better than either starting point.

## Two rejected shapes, both kept in the entry

**A core capped at ~92** — proposed in the morning, retracted by the afternoon. The objection is one
line and unanswerable: a permanent ceiling for not owning hardware is a penalty, not honesty.

**Filling missing contributors with the population-typical pattern** — the owner's own first
formulation, *"nothing good or bad, just the commonly seen one"* — **measured to fail**, and that
measurement is the most useful thing in this entry. A phone-only user has 38 of sleep's 110 points
measured and 72 inferred, so a fixed fill dominates:

| night | today | unconditional fill | conditional fill |
|---|---:|---:|---:|
| textbook — 8 h, consistent | 100 | **80** | 92 |
| poor — 6 h, erratic | 57 | **66** | 52 |

It collapses the scale to 14 points **and inverts the ranking**. "Use the average where you don't
know" sounds obviously safe, which is exactly why it is written down as tested rather than argued.

## Where it landed

**Every contributor always carries a value — measured where possible, conditionally inferred where
not.** That escapes the trilemma (reaches 100 / means the same for everyone / stable across a
hardware change — every other design gets two of three) by removing its cause: a score with holes in
it. Conditioning on observables is what makes it work; eight consistent hours predicts
better-than-average stages, not average, because the population average includes every six-hour
night.

Three rules ship with it: a `measured | inferred` flag **and** an uncertainty on every value; an
inferred value may **never** trigger an action; and inference needs a prior to infer from —
`personal-baseline.ts` already maintains one for six metrics, but a user who never owned the sensor
has none, and a population prior cannot be fitted from one account.

**Gated on TN-39**, because the app already infers — daytime stress guesses HRV from heart rate and
temperature — and nobody has checked whether that guess works. Validate the technique where ground
truth exists before extending it into scoring. The interim is today's behaviour plus a label:
*"82, from 3 of 10 signals."*

## The contract

Six inputs carry the whole app: **bed/wake times, steps, body weight, logged workouts, logged food,
daily check-in** — all from a phone and a person. Sleep and Readiness measure 35% of themselves from
that floor, Activity 63%, and Workouts, Body and Nutrition essentially all of themselves.

**Cardio is the one exception: no manual floor, nothing to infer from, 0%.** It should be hidden for
a user with no heart-rate source rather than scored at zero.

## Not exercised

Docs-only; no code changed, nothing run on device. The score tables are worked examples run through
the real weights in `sleep-score.ts`, not logged nights. The conditional-fill column assumes an
inference model that does not exist yet — its sub-scores are plausible stand-ins chosen to show the
range surviving, and **the actual figures will differ once a real estimator is fitted**. What the
table establishes is the direction of the two fills, not their values.
