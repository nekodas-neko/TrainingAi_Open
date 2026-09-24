# 2026-09-24 — the training-load column is empty because the producer and the model disagree about NaN

Tuning session, fifth entry of the day, and the one that closes the thread. Docs-only.

## What TN-79 left open, and what this settles

TN-79 (merged earlier today) established that the training-stress route runs, persists
`insufficient_met` on 21 straight days, and does so on days whose MET data comfortably clears both of
the gate's stated floors. It explicitly did not identify the cause.

The cause is an input-contract disagreement, and the label was hiding it.

`computeTrainingStress` maps **every** null from `runTrainingStressScore` to
`reason: 'insufficient_met'`. That model returns null down seven paths, only two about MET length. The
one that fires is its validator: **`validate()` rejects the input if any `mets` value is NaN when
`noOts === 0`**. The model's own type comment states the contract — *"validated: no NaN when noOts=0,
≥720 long"*.

And the route deliberately supplies NaNs. `metGridFromDaytimeSamples` leaves a null in every minute
without a sample — its comment says non-wear and charger gaps *"become nulls the OTS core cleans"* —
and `computeTrainingStress` converts those to NaN before passing `noOts: 0`.

The arithmetic agrees: ~1,100 MET values across a ~1,375-minute span is about 275 gap minutes a day,
and the validator returns on the first one. A ring that power-gates when worn-idle guarantees gaps, so
no real day can pass. That is the 21-of-21 pattern.

The intent was sound and the ordering defeats it: `cleanMets` exists to turn sub-threshold readings
into NaN for the windowed mean, so the downstream maths is NaN-aware — but `validate` runs first and
forbids exactly what `cleanMets` handles.

## The correction that matters most

`activity-goal-calibration.md` §11 and Q-204 both concluded from the empty column that direction B
has "no head start" and needs a from-scratch derivation. Wrong, and in the expensive direction:
`runTrainingStressScore` is a complete ported OTS model, 195 lines, wired end to end. **B is one
input-contract bug away from producing values.** Q-204's entry now says so and points at TN-79.

## Three fixes, and the cheap one is a trap

Passing `noOts: 1` dodges the NaN check in one character, but that flag also changes the length test,
so it ships a quietly different model — recorded as "do not". Recommended is filling the grid with a
documented imputation rule plus an explicit coverage floor, because it satisfies the contract rather
than evading it. Making the model NaN-tolerant is the smallest correct diff but edits ported code
pinned to a test vector, so only with a re-pin. Whichever is chosen, the overloaded label must be
split: a validator failure must not report as `insufficient_met`.

## Honest limit

**The route was still not run.** This is a strong inference from the code plus agreeing arithmetic,
not an observation. The confirming step is one log line — `validate(input)`'s return code for
2026-09-22; a `2` settles it. I also have not checked whether some other caller passes a dense series
and therefore works, which would be the contrast case and is worth finding before changing anything.

## Not exercised

Docs-only; nothing ran. No test written, no route invoked, no device involved. One user, one ring.
