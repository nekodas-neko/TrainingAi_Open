# 2026-09-24 — the failure breaking the load column is asserted by a passing test

Tuning session, sixth and final entry of the day. Docs-only, and short: it discharges one caveat.

## The loose end

TN-79's root-cause amendment identified the mechanism by reading code — the OTS validator rejects any
NaN in the MET series when `noOts === 0`, and the route deliberately supplies NaNs for non-wear gaps —
but said plainly that the route had not been run, so it was inference. The named loose end was whether
any *other* caller passes a dense series and therefore works, which would be the contrast case.

## Answered, and it closes the diagnosis without running anything

**There is exactly one production caller.** `runTrainingStressScore` is called from
`packages/shared/src/health/training-stress.ts` and nowhere else; every other reference is the test
file. So there is no working contrast case — the model has never produced a value from real data in
this app, only from a fixture.

**And a passing test asserts precisely the failure.** `ots.test.ts` contains a case named *"rejects a
NaN-containing MET series (validator error 2)"*: it copies the golden vector, sets `bad[10] = NaN` —
one NaN in 1,440 minutes — and asserts null. The route supplies roughly 275 per day. It is written as
`it` rather than the `itVendor` its neighbours use, because, per the file's own comment, the validator
case is decided before any threshold is consulted and so needs no vendor constants. It therefore runs
green on every CI pass.

**The golden vector is dense.** `bad[10] = NaN` is a mutation applied to make it invalid, so the
fixture contains none — which is exactly why parity passes while production gates.

So the mechanism is no longer an inference. It is the documented, tested contract of the model,
violated by its only caller, with the violation asserted green on every run.

## What it adds to Q-204

A risk its cost estimate did not carry, and not a reason against direction B: the "complete ported
model" has been exercised end to end against a fixture and nothing else. Parity with the TorchScript
reference is real and is not the same as having ever scored one of the owner's days. Q-204 now says to
scope B expecting the first real run to surface something.

## The test that should ship with the fix

One that feeds the route's own grid shape — a realistic series *with gaps* — through
`computeTrainingStress` and asserts non-null. Its absence is why a green suite and a dead column
coexisted for five weeks.

## Not exercised

Docs-only; nothing ran. I did not execute the test suite or the route — the test's source and the
single-caller grep are the evidence, and both are reads. One user, one ring.
