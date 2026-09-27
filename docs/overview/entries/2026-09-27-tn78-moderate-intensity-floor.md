# TN-78 — the moderate floor moves to 40% HRR, and the entry's impact figure was a different quantity

**Branch:** `lane-a/tn78-moderate-intensity-floor` · **Lane A**.

## What shipped

`ZONE_DEFS` Light `lowerFrac` 0.6 → 0.4, on the owner's 2026-09-27 answer. One number; the bands
above it are untouched.

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

## Why ship it anyway, given the small effect

The day count was never the defect. A WHO moderate target scored where ACSM starts vigorous is
wrong as a definition, and it made a whole class of real activity invisible. The effect being
small is a fact about how much the owner walks, not evidence the threshold was fine.

## Verification

- `packages/shared/src/health`: **1070 passed / 11 skipped (100 files)**.
- New test pins the band **between** the two floors (120 bpm), that it counts **once** rather than
  doubling like zones 3+, and that the floor is inclusive at 106 and excludes 105. The two
  pre-existing zone tests use readings clear of the boundary and passed either way — worth saying,
  because a green suite was not evidence here.
- **Mutation pass: baseline survives, 3 killed, 1 equivalent control survives.** Killed: reverting
  to 0.6; 0.5; moving the Aerobic floor instead. Control: `0.40`.
- `tsc` clean; Custom Rules **82 of 82**; v1.477.8 with a changelog line (user-visible: every past day's zone minutes change).

## Not exercised

**No device run.** Zone minutes appear on the Activity surfaces and this changes what every past
day reads there, which is exactly the kind of change the phone should confirm. TN-78 keeps that.
