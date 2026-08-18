# RPE autoregulation — two thirds of every load cut the engine has ordered is a clamp artefact

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** calibration evidence, docs-only
**Filed as:** Q-514 · **Lane:** A implements (this proposes only)
**Scope note:** second review of the **workouts** pillar (after ACWR, Q-512/513). `RPE_DEAD_BAND`
drives real load changes and had never been checked against the owner's logged RPE.

**Headline: the dead band is well-placed and must not move. The input feeding it is biased.**
Excluding the biased sets cuts back-off triggers by **64%** while leaving the push arm **completely
unchanged** — so this is not a sensitivity reduction, it is removing a one-directional artefact.

---

## 1. The model is unbiased overall, and that hid the problem

Over **570 sets** with both a logged RPE and an `intensity_pct` (41 sessions, 27 exercises):

| | actual RPE | expected RPE |
|---|---|---|
| mean | 7.49 | 7.68 |
| sd | 0.87 | **1.34** |
| range | 6 – 10 | 5.0 – 10.0 |

Mean delta **−0.19**, median −0.11. On the whole dataset `expectedRpe` looks calibrated. It is not —
the aggregate hides two populations pulling opposite ways.

Note also `r(expected, actual) = +0.344` and that the model's sd (1.34) is **larger than reality's**
(0.87). The owner reports only integers 6–10, with **78% of all sets at 7 or 8**.

---

## 2. The floor clamp splits the data in two

`expectedRpe` clamps to the 5–10 slider range. The **ceiling never binds** — raw expected tops out at
exactly 10.0, 0 sets clamped. The **floor binds on 37 sets (6.5%)**, and the raw value it is hiding
goes as low as **−10.4**.

Those are not warm-ups. Their `intensity_pct` runs **49.6 – 66.7** (median 54.3) at **7–13 reps**
(median 10) — ordinary moderate-intensity accessory work. At 54.3% the formula puts reps-to-failure
near 19, so a 10-rep set has ~9 reps in reserve and a "true" expected RPE near 0.6. The model can only
say **5**. The owner reports **6.9**.

| population | n | mean delta |
|---|---|---|
| floor-clamped sets | 37 | **+1.89** |
| everything else | 533 | **−0.34** |

**A 2.2-point systematic offset**, in the direction the back-off arm reads as "RPE ran high".

---

## 3. What it costs: 64% of back-off triggers

Replaying the shipped grouping exactly — per exercise, over the trailing 3 sessions, requiring ≥3
sets, thresholded at `RPE_DEAD_BAND = 1.5` — across **377 per-exercise windows**:

| | shipped (all sets) | excluding floor-clamped sets |
|---|---|---|
| windows | 377 | 343 |
| mean delta | −0.05 | −0.25 |
| sd | 1.16 | **0.96** |
| **back-off (≥ +1.5)** | **39 (10.3%)** | **14 (4.1%)** |
| push (≤ −1.5) | 27 (7.2%) | **27 (7.9%)** |

**25 of 39 back-off triggers disappear — 64%.** The push arm is untouched at 27 windows, which is what
makes this a bias fix rather than a blunt de-sensitisation. **64% of back-off windows contain at least
one floor-clamped set.**

Each of those triggers is a **5–10% load cut** on that exercise (`BACKOFF_MIN_PCT`/`BACKOFF_MAX_PCT`).
So the engine has been cutting load on accessory work because the model could not express how easy the
set was *supposed* to feel — and then read the gap as the lifter struggling.

### 3.1 The app's own effort prescription disagrees, in the opposite direction

`ACCESSORY_SPEC` (`goal-ranges.ts`) prescribes accessory work to a **target RPE of 7.5–8.5** depending
on training goal — *"ALL genuinely challenging (>= RPE 7.5)"*, in its own words.

The floor-clamped sets report a mean actual RPE of **6.89**. That is below **every** accessory target
in that table, and below the dataset's own mean of 7.49. **By the app's other model of how hard these
sets should feel, they are easy** — while the autoregulation delta reads them at **+1.89**, "ran high",
and cuts the load.

Two models in the same codebase, disagreeing in *sign* about the same sets. That is independent
corroboration that the +1.89 is an artefact rather than a real difficulty signal.

**An attempted stronger version of this was abandoned as unsound**: grouping the sets by
`session_exercises.exercise_role` to show the clamped sets are specifically accessories. Exercise names
map to **more than one role** across programs (`Barbell Shrug` is both accessory and secondary, and 20+
others are similarly split), so a name-based join fans out and its per-role means cannot be trusted.
The claim above needs no role attribution and is made without it.

---

## 4. Why the dead band itself is fine

Sensitivity of the trigger rate to `RPE_DEAD_BAND`, shipped inputs:

| dead band | windows triggering |
|---|---|
| 0.5 | 48.3% |
| 1.0 | 29.4% |
| 1.25 | 20.7% |
| **1.5 (shipped)** | **17.5%** |
| 2.0 | 14.9% |

1.5 sits on a flat part of the curve — moving to 2.0 changes little, and the sharp drop is below 1.25.
The delta distribution is centred (mean −0.05) and 17.5% is a defensible autoregulation rate.

**So do not move it.** This is the third time this session the answer has been "the threshold is
right, the input is wrong" (Q-506's illness radar, Q-512's ACWR, and now this). Moving the dead band
to suppress the artefact would also suppress the 14 genuine back-offs.

---

## 5. Proposal

**Exclude sets whose raw (pre-clamp) expected RPE falls outside the slider range from the
autoregulation delta.** They carry no information: the model cannot state what it expects, so the
difference between that and what the lifter reported is not a measurement of anything.

This matches a principle the codebase already applies elsewhere — a contributor whose input is absent
returns neutral rather than a fabricated value, and `computeResilienceForDay` passes `null` rather
than inventing a 50. A clamped expectation is the same situation: an unrepresentable value, not a
low one.

Implementation is contained: `signals.ts` builds `perExRpeDelta` at one place (the loop at ~line 293),
and `expected-rpe.ts` would need to expose whether a given `(pct, reps)` is representable — one
predicate beside `expectedRpe`, not a change to the curve.

**Do not "fix" it by widening the clamp** to allow expected RPEs below 5. The 5–10 range is the
slider's, and an expected RPE of 0.6 compared against an owner who never reports below 6 produces a
delta of +6.3 — worse, not better. The set is unrepresentable either way; the fix is to not vote.

**Re-measure after the change.** With back-off at 4.1% and push at 7.9%, the arms become asymmetric in
the opposite direction, and whether *that* is right is the next question — but it must be asked
against unbiased input, not this one.

### 5.1 How much this actually costs, bounded honestly

The 64% is a ratio over windows clearing the **RPE gate**. A load cut additionally needs a second
signal — `rm1Trend === 'down'` **or** `repCompletionRate < 0.95`. Measured over the 196 sets carrying a
`planned_reps`:

| | sets | share |
|---|---|---|
| short of target | 14 | **7.1%** |
| exactly on target | 147 | 75.0% |
| over target | 35 | 17.9% |

mean completion **1.046** — the owner meets or beats the prescribed reps on 93% of sets. So
`missedReps` is rarely the corroborating signal, and most back-offs would have to come through a
falling 1RM.

**This bounds the finding and should be read with it: the number of load cuts actually issued is well
below 39, and the number prevented by the fix is well below 25.** The defect is real and
one-directional, but "64% of back-off *triggers*" is not "64% of load cuts on your training". The
ratio is the finding; the absolute impact is smaller and this review cannot size it without modelling
`rm1Trend`, which it does not.

---

## 6. What was not exercised

- **No code changed and no constant altered.**
- **The replay is a faithful port of `expectedRpe`/`maxRepsAtPct`/`repFactor` and of the shipped
  grouping**, but it was **not validated against a stored value — no RPE delta is persisted
  anywhere**, so there is nothing to reconcile against. The same limitation as Q-512's ACWR replay.
- **The back-off arm needs a second signal** (`rm1Trend === 'down'` OR missed reps) that this review
  does **not** model. So 39 and 14 are counts of windows that clear the *RPE* gate, not of load cuts
  actually issued — the true number of both is lower. **The 64% ratio is the finding**, not the
  absolute counts.
- **`repCompletionRate` is not modelled**, so the 5–10% cut sizing is untouched here.
- **Only sets carrying both `rpe` and `intensity_pct` are visible** (570 of 1,029 set logs). Whether
  the unlogged remainder differs systematically is unknown.
- **Nothing on-device**; no owner-reported symptom prompted this.
- Every figure is **the owner's** (`claude_ro` is row-scoped), 41 sessions, 27 exercises.

### 6.1 Also measured, and clean: prescription adherence

Comparing logged work against what was prescribed, over the 275 sets carrying a `planned_pct`:
mean actual **73.6%** against mean planned **73.1%** (delta **−0.47**), and mean reps **+0.25** over
target. The owner follows the prescription closely, so `INTENSITY_ZONES` is being *realised* rather
than merely written — which is why this review does not attempt to calibrate those zones. They are
prescriptive textbook periodisation, the program was generated from them, and checking them against
work they produced would be circular. **Adherence is the non-circular question, and it is clean.**

## 7. Recorded, not filed

`calcAmrap1RM` and `amrapScaleFactor` (the 1.0/0.97/0.93/0.88/0.82 rep-band table) have **no
production call site** — they appear only in `packages/shared/src/__tests__/1rm.test.ts`. They were on
this review's list as hand-tuned constants worth validating; calibrating a function nothing calls
would be wasted, so they were skipped. Whether the table is *correct* is unknown and unimportant while
it is unreachable. Removing it is a Review-lane call, not Tuning's.
