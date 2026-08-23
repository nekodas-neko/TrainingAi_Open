# 2026-08-20 — the done screen and the day were estimating the same workout with different formulas (Q-331)

**Branch:** `test/session-energy-cross-surface-parity` · **Lane A** · closes **Q-331**

## The entry asked for a test; the premise had gone stale

Q-331 was filed as *"they agree, only a measurement says so, not a test"* — a low-priority hardening
item. Re-verifying that premise against `main` before writing the test is what found the defect:
**they had stopped agreeing.**

`#255` (Q-421) gave `computeActiveEnergy` a heart-rate estimate — Keytel — with the MET path as the
fallback. It did not touch `GET /api/workout-sessions/[id]/energy`, the sibling surface the done
screen reads. So for every session carrying an `avg_bpm` the two screens ran **different formulas**
on the same session:

| surface | estimator |
|---|---|
| day screen, Nutrition earned calories, Home budget | Keytel from `avg_bpm` |
| done screen, the moment the workout ends | MET fallback |

**Coverage is not marginal.** #255's own measurement: **42 of the owner's 78** completed sessions
carry an `avg_bpm`. For the median one — 33 y, 71.5 kg, male, 58 min, 91 bpm — the HR path gives
**321 kcal**, and the done screen was showing whatever the MET tier produced for the same session.
The exact size of the gap on production data cannot be computed in the sandbox, because the MET
constants are scrubbed there (Q-312); the two formulas being different is the point, not the margin.

This re-broke the invariant Q-419 was built for and Q-330 had just re-measured at **106 = 106** —
which held only because that session had no heart rate.

## The fix: the precedence lives in one function

`estSessionKcal` in `packages/shared/src/health/workout-energy.ts` — HR first, MET fallback, and it
returns the `source` it used. `computeActiveEnergy`'s strength loop and the route both call it, so
agreement is structural rather than something the next session re-measures.

Two details worth keeping:

- **`met` is null when the HR path ran**, and deliberately not computed there. Reporting a MET
  alongside a Keytel number suggests it produced it, and not computing it keeps the HR path
  independent of the pinned activity table.
- **`intensity` is returned under both sources.** It is the RPE tier the user rated, which is true
  whichever estimator ran — and it is what the done screen renders next to the number.

## The test, and the vacuity trap it had to get past

Q-331 predicted the obstacle exactly: both surfaces estimate strength as activity **8**, the committed
fixture lists it at `met_moderate: 0.6`, and `estWorkoutKcal` floors at `met - 1.5` — so in CI both
sides are **0** and an equality assertion between two zeroes passes whatever the inputs are.

It suggested injecting the MET table into both paths, which is a testability change to production
code. **A narrower way exists:** both surfaces reach the table through one read,
`getEnergyFeatureSpec`, so the test mocks *that* and both paths see a strength MET that clears the
floor. The scrubbed fixtures are untouched.

The heart-rate regime needs none of it — Keytel is published coefficients and arithmetic, so that
half of the test is non-vacuous by construction, and it is the half that was actually broken.

Seven cases: both regimes agree; HR is what decides, on both surfaces at once; and weight, duration
and RPE each move the two together. **Mutation-verified in both directions** — reverting either
surface to MET-only turns 4 of the 7 red.

## The second divergence, which only the live run could show

The route computed the user's age itself, in fractional years, with a private `yearsSince` helper.
Every other surface — `energy-balance-service`, `body-metadata`, ten more — uses the shared
`ageFromDob`, which returns **whole** years. Keytel weights age at 0.2017 kJ/min per year, so
33 against 33.18 moved a 55-minute session by **1 kcal**: enough for the two screens to print
different numbers after the formulas had been unified. The route now uses `ageFromDob` and the
private helper is gone — one duplicate formula fewer, which is what let this hide.

**And one divergence that is left in place deliberately.** The day path takes the latest weight
*within the window it is computing*, so a six-month-old workout is re-estimated at the weight the
user was then, while this route always uses today's (Q-330). For the case where both are on screen at
once — a session that just finished, whose day window ends today — they agree. Differing on history
is the better reading, not a drift to close; the test says so rather than asserting it away.

## Measured against the running app

`pnpm dev`, real login, one seeded session, both surfaces called for the same session:

| regime | done screen (route) | day screen (`workoutKcalBySession`) |
|---|---|---|
| heart rate present (91 bpm, 55 min) | **334** | **334** (333.52 exact) |
| no heart rate, MET fallback | **108** | **108** (108.00 exact) |

Before the fix, the same session read **334 on one screen and 108 on the other**.

## The gate

`tsc` clean · `pnpm lint` **0 errors** · **Ran 50 of 50** Custom Rules steps · `pnpm build` clean ·
full suite **536 files, 4,431 tests, 0 failed**. `getAvgBpmBySession` was exercised against the real
local Postgres through the repository, since the route is its third caller.

## Not exercised

The S25 APK. This is a server route plus shared math with no Capacitor, safe-area or gesture surface,
but the owner will see a **different number** on the done screen for any session with a strap
reading — the day screen's number, which is the correct one. The done screen's cache key
(`workout-energy:<id>:<activityId>:<rpe>`) does not include the heart rate, so a session whose HR
stats land after the first fetch shows the MET number until the next revalidation; `cachedFetch`
always revalidates over the network, so that is a first-paint lag rather than a stuck value.
