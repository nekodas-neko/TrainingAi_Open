# Two thirds of the engine's load cuts were an artefact of a clamp

**Date:** 2026-08-18 · **Branch:** `tuning/acwr-calibration` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-514

Second review of the workouts pillar, after ACWR. `RPE_DEAD_BAND` drives real load changes and had
never been checked against the owner's logged RPE.

## The aggregate looked fine, and that hid it

Over 570 sets carrying both an RPE and an `intensity_pct`, the mean delta between reported and
expected RPE is **−0.19**. On that number `expectedRpe` looks calibrated.

It is not. Two populations pull opposite ways, and the split is the clamp.

`expectedRpe` clamps to the 5–10 slider range. The **ceiling never binds** — raw expected tops out at
exactly 10.0, zero sets clamped. The **floor binds on 37 of 570 sets**, hiding raw values as low as
**−10.4**. Those are not warm-ups: 50–67% of 1RM at 7–13 reps, ordinary accessory work. At 54% the
formula puts reps-to-failure near 19, so a 10-rep set has ~9 in reserve and a true expected RPE near
0.6. The model can only say 5. The owner reports 6.9.

Floor-clamped sets carry a mean delta of **+1.89**. Everything else carries **−0.34**. A 2.2-point
offset, pointing exactly where the back-off arm reads "RPE ran high".

## What it cost

Replaying the shipped grouping — per exercise, trailing 3 sessions, ≥3 sets, threshold 1.5 — across
377 windows:

| | shipped | excluding floor-clamped |
|---|---|---|
| back-off (≥ +1.5) | **39 (10.3%)** | **14 (4.1%)** |
| push (≤ −1.5) | 27 (7.2%) | **27 (7.9%)** |

**25 of 39 back-off triggers vanish — 64% — while the push arm is untouched.** That asymmetry is the
whole argument: a blunt de-sensitisation would move both arms. Each trigger is a 5–10% load cut, so
the engine has been cutting load on accessory work because the model could not express how easy the
set was supposed to feel, then read the gap as the lifter struggling.

## The dead band is fine and must not move

Sensitivity: 1.25 → 20.7%, **1.5 → 17.5%**, 2.0 → 14.9%. It sits on a flat part of the curve and the
delta distribution is centred. Raising it to suppress the artefact would also suppress the 14 genuine
back-offs.

**That is the third time today the answer has been "the threshold is right, the input is wrong"** —
the illness radar, ACWR, and now this. It is worth stating as a habit rather than three coincidences:
check the input's distribution before touching a constant.

## The fix, and the fix not to make

Exclude sets whose **raw, pre-clamp** expected RPE falls outside the slider range. They carry no
information — the model cannot state its expectation, so the gap to what was reported measures
nothing. That matches what the codebase already does elsewhere, passing `null` rather than fabricating
a neutral value.

**Do not widen the clamp** to allow expected RPEs below 5. An expectation of 0.6 against an owner who
never reports below 6 gives a delta of +6.3 — worse. The set is unrepresentable either way; the fix is
to not let it vote.

## Not exercised

No code changed. The replay is a faithful port but **could not be validated against a stored value —
no RPE delta is persisted anywhere**, the same limitation as the ACWR replay. **The back-off arm needs
a second signal (a falling 1RM or missed reps) that this review does not model**, so 39 and 14 count
windows clearing the *RPE* gate, not cuts actually issued — the true numbers are lower and **the 64%
ratio is the finding, not the absolute counts**. Only sets carrying both an RPE and an `intensity_pct`
are visible, 570 of 1,029. Nothing on-device, and no owner-reported symptom prompted this.

## Recorded, not filed

`calcAmrap1RM` and `amrapScaleFactor` — the 1.0/0.97/0.93/0.88/0.82 rep-band table — have **no
production call site**; they appear only in tests. They were on this review's list as hand-tuned
constants worth validating, and calibrating a function nothing calls would be wasted. Whether the
table is correct is unknown and unimportant while it is unreachable.

## Also measured, and clean: Foster monotony

`HIGH_MONOTONY = 2.0` softens a prescribed hard run when the week's load has been too samey. Over 102
rolling 7-day windows the owner's monotony reads mean **1.29**, median 1.34, sd 0.31, range 0.41–2.32,
and crosses 2.0 on **one window (1.0%)** — the right rate for a risk flag. Nothing to change.

Worth recording *why* it works: `assemble-plan-context` seeds all seven days at zero before adding
session volume, so rest days count toward the standard deviation. That is the correct Foster
definition, and it is what makes the 2.0 threshold meaningful — computing monotony over training days
only would roughly halve the SD and push most weeks over the line. Do not "optimise" that seeding away.

## A measurement I abandoned

I tried to strengthen the accessory argument by grouping sets on `session_exercises.exercise_role`.
Exercise names map to **more than one role** across programs — `Barbell Shrug` is both accessory and
secondary, and twenty-odd others are similarly split — so a name-based join fans out and its per-role
means are unsound. The 6.89-vs-7.5 comparison in the review needs no role attribution, so it is stated
without one.
