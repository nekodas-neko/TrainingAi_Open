# TN-78 — the moderate floor moves to 40% HRR, and the entry's impact figure was a different quantity

**Branch:** `lane-a/tn78-moderate-intensity-floor` · **Lane A**.

## What shipped

A dedicated `MODERATE_INTENSITY_FRAC = 0.4` with `moderateIntensityBpm()`, consumed by a new
`activeMinutesFromReadings`. **`ZONE_DEFS` is untouched** — and that is the whole story below.

The defect is a taxonomy splice. `DEFAULT_ZONE_MINUTES_GOAL = 22` cites WHO's ≥150 min/wk of
**moderate** activity, and `activeMinutesFromZoneSeconds` scores that goal off the Light band —
whose floor sat at 60% of heart-rate reserve, where ACSM puts **vigorous**. The target was
moderate and the bar was vigorous, so brisk walking could not earn a single minute.

## The re-score, and the correction that came with it

The Tuning rule says a proposal is incomplete without stating how many days move, so I measured
it by replicating `accumulateZoneSeconds` in SQL — 120-second gap cap included — over
`oura_heartrate`, the table `getHrForWindow` actually reads.

| | old floor (134 bpm) | new floor (108 bpm) |
|---|---:|---:|
| days **meeting** the 22-minute goal | **1** of 32 | **3** of 32 |
| mean active minutes/day | **0.9** | **4.9** |
| days with **any** time above the floor | 3 | 24 |

The entry said *"the owner hit the old floor on 3 of 31 days and hits the new one on 24"*. That
pair reproduces **exactly** — and it is the bottom row. Days with any qualifying time, not goal
attainment. A correct measurement labelled as a different thing, which is the same failure mode
four other entries have shown this week.

## What that retracts

The entry's second warning said `DEFAULT_ZONE_MINUTES_GOAL = 22` "will be met most days and is
probably too low" at 40%, and instructed the implementer to measure it and file a re-size. **It is
met on 3 of 32 days, mean 4.9 minutes.** The prediction is inverted, so the re-size entry is
deliberately **not** filed — acting on it would have moved the goal the wrong way. Whether 22 is
the right number is a separate question needing its own measurement.

## The implementation the entry named is a regression, and CI caught it

The entry says to change `ZONE_DEFS` Light `lowerFrac` to 0.4. I did that first, ran
`packages/shared/src/health`, got 1070 green, and pushed.

`hr-targets.test.ts` failed: **expected 134, got 106**. `targetsForRunType` builds run
prescriptions from the same zone map, so widening Light takes a **recovery run's ceiling from
134 bpm down to 106** with it. The owner approved a change to how active minutes are *counted*,
not to what a recovery run is — and nothing in the entry mentions the coupling.

One map, two uses that want different edges: an activity-guideline definition and a training
prescription. So the moderate floor is its own constant, the zone map is left alone, and a test
now pins that the Light band still reads 134 — with the reverted mutant (`Light → 0.4`) in the
mutation pass, because that is the mistake a future reader is most likely to repeat.

**What let it through locally:** I ran the suite for the directory I edited. The consumer was one
directory over. `packages/shared/src/running` was never in the command.

## Why ship it anyway, given the small effect

The day count was never the defect. A WHO moderate target scored where ACSM starts vigorous is
wrong as a definition, and it made a whole class of real activity invisible. The effect being
small is a fact about how much the owner walks, not evidence the threshold was fine.

## Verification

- `packages/shared/src/health` + `packages/shared/src/running` + `lib/health`: **1272 passed / 27 skipped (129 files)** — the running suite is in the command now, deliberately.
- New test pins the band **between** the two floors (120 bpm); that it counts **once** rather
  than doubling like zones 3+; the floor inclusive at 106 and excluding 105; the 120-second gap
  cap; **that the Light band still reads 134**; and **that a recovery run's ceiling is unmoved**.
  The two pre-existing zone tests use readings clear of the boundary and passed either way — worth
  saying, because a green suite was not evidence here.
- **Mutation pass: baseline survives, 4 killed, 1 equivalent control survives.** Killed: the
  moderate fraction back to 0.6; **moving the Light band to 0.4 (the regression above)**; counting
  vigorous once instead of double; an exclusive floor. Control: `vigorousFloor <= bpm` reordered.
- `tsc` clean; Custom Rules **82 of 82**; v1.477.8 with a changelog line (user-visible: every past day's zone minutes change).

## Not exercised

**No device run.** Zone minutes appear on the Activity surfaces and this changes what every past
day reads there, which is exactly the kind of change the phone should confirm. TN-78 keeps that.
