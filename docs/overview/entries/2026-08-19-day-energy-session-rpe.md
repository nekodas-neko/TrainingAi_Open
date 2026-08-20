# 2026-08-19 — the day's burn now honours your RPE (Q-419; Q-330 filed)

**Branch:** `fix/day-energy-ignores-session-rpe` · **Lane:** Implementation A

## The defect

Two live paths called the same estimator with different intensities for the same session:

| path | intensity |
|---|---|
| done screen → `GET /api/workout-sessions/[id]/energy` | `intensityFromRpe(rpe)` |
| day ENERGY row, Nutrition earned-kcal, Home budget | hardcoded `'moderate'` |

The done screen re-fetches on every RPE tap, keyed by the rating, precisely so a different rating
re-estimates. So an RPE 9 session read higher there — and the moment it reached the day's Energy row,
Nutrition's earned calories or the Home budget, it reverted. **The tap looked load-bearing and was
not.**

`computeActiveEnergy` never received an RPE; `ActiveEnergyInput.strengthSessions` was
`{ durationMin }[]`, so the tier could not be threaded without widening the type.

## Shipped, with the owner's sign-off

It re-scores history, so it went to the owner as a decision rather than being merged quietly. The
measurement that decision needed, taken against production first:

- **78** completed sessions; **20** carry an RPE — **3 at 7, 15 at 8, 2 at 9**.
- `intensityFromRpe` is ≤4 easy, ≥8 hard, so **17 sessions across up to 17 days move, all upward**
  (moderate → hard). The three at RPE 7 stay moderate. Unrated sessions are untouched, because
  `intensityFromRpe(null)` is `'moderate'` — which is exactly the old literal.
- **Nothing is stored.** These figures are derived on read from `workout_sessions.session_rpe`, a
  column that already exists and already syncs. Reverting is one line: no migration, no data rewrite.

That reversal cost is what made "all days" the right answer rather than a cutover date, which would
have needed a threshold threaded through the estimator and left a permanent discontinuity in the
owner's own history.

Owner's answer: **ship it for all days.**

## Verified against the running app

With the seeded 55-minute session set to RPE 9:

```
done screen        → {"kcal":107,"intensity":"hard","met":3,...}
day's breakdown    → workoutKcal 108, bySession [{id: 6a007073…, kcal: 107.927…}]
```

Both now say `hard`. **Before this change the day path scored that session `moderate`**, which under
the scrubbed fixture MET (0.6, below the estimator's 1.5 floor) is literally **0** against the done
screen's 107 — the disagreement at its most extreme.

11 unit cases, including one that asserts agreement with the done screen's own expression at **every**
RPE value (`null, 1, 4, 5, 7, 8, 9, 10`) rather than at a sampled few. Full suite **508 files, 4,313
tests, 0 failed**; `tsc` clean; `pnpm check:rules` **Ran 50 of 50**.

## What this did NOT close — filed as Q-330

The two surfaces still differ by **1 kcal**: 107 against 107.927. Same intensity, same duration, same
estimator — so the differing input is **body weight**. The done-screen route uses `baseline.weightKg`;
`energy-balance-service` uses *"last known weight, however old"* within the 14-day window ending on
that date.

**That may be correct rather than a defect**, which is why it is filed rather than fixed: weighing a
historical session against the weight the user was at the time is defensible, and the done screen is
shown when "latest" and "now" coincide anyway. The unverified part — whether a session completed
*today* agrees exactly — needs a same-day session, and the seeded ones are days old. Q-330 says so.

## Not exercised

Nothing on device; no production write. The magnitude of the moderate→hard shift **cannot be quoted
from here** — the committed fixture scrubs the MET table, so the real ratio
`(met_hard − 1.5)/(met_moderate − 1.5)` is only observable at runtime. The direction (upward) and the
count (17 sessions) are what the owner decided on, and both are exact.
