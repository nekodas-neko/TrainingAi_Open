# 2026-08-30 — Q-211: the baseline exemption took two guards, not the one the entry named

**Branch:** `fix/baseline-exempt-from-deload` · **Lane:** A · **Domain:** workouts

## The bug

A confirmed deload week reduced a **baseline** lift to 50% / 2 sets — and then the logging path
recorded the result as a genuine max test. `estimateOneRm` is called with `deloaded:
exerciseDeloaded === true || (isAnyDeload && !isBaseline)` and `shouldCountTowardPr` returns
`!args.isAnyDeload || args.isBaseline`, both commented as *"a baseline test is a genuine max-effort
attempt even during an otherwise-active deload window"*.

So the app prescribed half weight and filed the outcome as a real max. **Every baseline taken in a
deload week understated the athlete permanently, in `personal_records`.**

## The entry's stated fix does not work, and that is the finding

Q-211 says: *"add `&& !isBaselinePhase` to that `else if`"*. Applied on its own and measured,
`deloaded` still came back **`true`**.

There are **two** deload branches in `session-data.ts`. Exempting the prescribed one hands the
exercise straight to the un-prescribed one (Q-185), which picks it up and deloads it anyway.

That branch carried a comment saying a `!isBaselinePhase` clause there was **unreachable**:

> *"A baseline phase sets `progressionStyle` to null, so an un-prescribed exercise is stopped by the
> length check; and a PRESCRIBED one has already been deloaded by the AI branch above, so
> `!deloaded` stops it. Verified by mutation — deleting such a clause failed zero tests."*

Every word of that was **true when written** and the second clause is **false the moment the first
exemption lands** — the fix itself is what removes the guarantee the comment rests on. The comment
now says so, and warns that a clause proven unreachable is only unreachable against the code that
proved it.

## The audit the entry asked for, answered

Q-211 asks whether the automatic per-exercise engine (`p.deloaded`) needs the same exemption.
**It does not**, and the reason is in `shouldCountTowardPr`'s own comment:

> *"a per-exercise deload excludes just that exercise — and unlike the session flag it has no
> baseline exception, since the exercise itself was cut."*

`if (args.exerciseDeloaded) return false` — that set never reaches `personal_records`, baseline or
not, and `estimateOneRm` takes `exerciseDeloaded === true` first. Both sides already agree for that
flag: reduce the load, keep the result out of the records. There is no contradiction to fix, and
exempting it would *create* one — the coach cuts a specific exercise for soreness or injury, and
overriding that to make someone max out on it is a safety decision, not bookkeeping.

Pinned as a test so the audit is not re-derived.

## Files

- `packages/shared/src/workout/session-data.ts` — both guards, and the corrected comment.
- `packages/shared/src/workout/__tests__/session-data-manual-deload.test.ts` — the Q-211 test flipped
  from asserting the wrong behaviour to asserting the right one, plus the per-exercise audit case.
- `package.json` / `changelog.ts` — v1.402.1.

## Verification

`pnpm check:rules` **Ran 62 of 62**, `tsc --noEmit` clean, full suite green.

**Mutation-verified, each guard independently:** removing *either* one alone fails the Q-211 case.
That is the proof the one-line fix was insufficient, rather than an argument that it was.

**One test was written and deleted for not discriminating.** A separate case for the un-prescribed
branch (`aiPrescription: null`) could not fail: with no prescription a baseline has
`progressionStyle` null, so the length check stops it regardless. The scenario that reaches both
branches is the prescribed one, so that single case pins both — and the docblock says so, since a
reader would otherwise expect two.

**Not exercised:** the S25, and a real model-generated prescription (fixture-based unit tests
instead). This changes prescribed load, so the numbers on the workout screen during a baseline
phase in a deload week are worth a look on device.
