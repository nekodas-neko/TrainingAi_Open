# BF-158 — a fitness test with no distance withholds its score instead of inventing one

**Branch:** `lane-a/bf158-fitness-test-distance-guard` · **Lane A** · one shared guard, one consumer,
one test file.

## What the owner asked

A pre-flight check before running the Cooper test for the first time. He nearly ran it on a
treadmill — the session immediately before was about single-speed treadmill walks.

## What the entry found, verified line by line

`cooperVo2max` is the only VO₂ equation in the file that is not clamped, so `distanceM = 0` writes
**−11.3** into `fitness_tests.vo2max_est` and the fitness snapshot. Confirmed against current `main`:
the intercept guarantees it, and `test-active.tsx` takes distance from `startGpsWatcher` and nothing
else — no treadmill toggle, no manual entry, unlike the guided walk. An indoor run therefore produces
a full-length, correctly-timed capture with a distance near zero.

## What the entry did NOT find, and it is worse

The entry named Cooper. **The 6MWT has the same defect wearing the clamp**, and its capture comes
from the same GPS-only screen. Measured at zero distance:

| protocol | scores | why it is bad |
|---|---|---|
| Cooper | **−11.3** | unclamped; announces itself |
| 6MWT (Ross) | **10.0** | clamped up from 4.9 — a floor presented as a reading |
| 6MWT (Burr) | **34.8** | *the owner's own profile*; the distance term contributes nothing |

**The Burr case is the one that would never have been caught.** A negative is obviously wrong; 34.8
is a completely plausible VO₂max for a 33-year-old, and nothing marks it invalid. It would have
entered the fitness snapshot as a real reading. This is exactly why the entry said *"clamping alone
is the wrong fix and would be worse than the bug"* — and the clamped sibling was already living that
outcome.

Found by the sibling-surface sweep, which BF-155 got wrong the day before.

## What shipped

The guard is on the **distance**, before any equation runs — because the Burr branch proves the
output cannot be trusted to reveal a bad input. `MIN_SCOREABLE_DISTANCE_M` is **derived, not
chosen**: for each protocol it is the distance at which that protocol's *distance-only* equation
reaches `clampVo2`'s existing floor of 10, so the two protocols agree on what counts as a reading.

- Cooper: `10 × 44.73 + 504.9` = **952.2 m** (4.8 km/h over 12 min)
- 6MWT: `(10 − 4.948) / 0.023` = **219.7 m** (2.2 km/h over 6 min), from the Ross fallback

Both sit below the worst genuine effort, so no real test is withheld — the owner's own 6MWT (603 m)
still scores 18.8, matching his stored `ross_2010` record exactly.

`test-result.tsx` gates on it the same way it already gates on `endedEarly`, withholds `method` along
with the score (a row claiming `cooper_1968` with a null VO₂max would say a method ran that did not),
and says why. `endedEarly` wins the wording when both are true: a truncated capture explains a short
distance, and naming the distance there would send the reader after a GPS fault.

**Not done, deliberately:** manual distance entry so a treadmill's readout can be typed in. The entry
calls it "worth considering alongside, not required — owner's call", and the safety half stands on
its own. The screen now says the test needs GPS rather than silently failing.

## Verification

| mutant | result |
|---|---|
| remove the guard from the result screen (the exact defect) | **killed** |
| clamp Cooper instead of guarding (the fix the entry rejected) | **killed** |
| derive the 6MWT threshold from something other than Ross | **killed** (4 assertions) |
| `>=` → `>` at the threshold | **killed** |
| control — `>=` → `!(<)` | **KILLED, and correctly so** |
| control — commute the addition in the Cooper derivation | **survived**, as it should |

**The first control was not equivalent and the test proved it.** `!(x < y)` looks like a pure
rewrite of `x >= y` and is not: for `NaN` the first is `true` and the second `false`, so that
"harmless" rewrite would have let a NaN distance through to be scored. The NaN assertion was written
on general principle and earned its keep within the hour. A second, genuinely equivalent control
(commuting `VO2_FLOOR * 44.73 + 504.9`) survived.

Gate: `pnpm check:rules` 74 of 74 · full suite by real exit code · lint 0 errors · `tsc --noEmit`
clean. Driven on `pnpm dev` signed in: `/health` and `/api/fitness-tests` both 200, no compile
errors.

**Not exercised:** the capture flow itself. A fitness test needs a real 6- or 12-minute GPS capture,
which the sandbox cannot produce, so the guard is verified by unit test and source assertion rather
than by running a protocol. **The owner's check:** run a protocol to full duration with GPS
unavailable and confirm no VO₂max is saved and the screen says why, and confirm an outdoor run is
unchanged.

## A queue defect found on the way in

BF-160 declared `Needs: BF-158` as ``- **`Needs:` BF-158**``. `next-item.js` parses
`\*{0,2}Needs:\*{0,2}` — asterisks, not backticks — so **BF-160 printed as READY #1 while the entry
it needs sat at #2.** Corrected in place; the `Needs:` count went 49 → 50, which is how the fix was
confirmed.

The same regex governs `Gate:`, and that is the case worth preventing: a backticked
``**`Gate: owner`**`` would park nothing, handing an agent owner-gated work as the top of its queue
with no sign anything was wrong. `Needs:` mis-orders; `Gate:` crosses a line the owner drew. Filed as
**LA-106** with the fix shape — fail CI on a field name that does not parse, rather than widening the
parser to accept backticks, which would reward the ambiguity.
