# 2026-09-14 — BF-160: the Cooper run saved correctly and still went uncredited (BugFix intake)

Docs-only. The owner ran the Cooper test after the pre-flight check and asked whether it saved. It
did, cleanly: `cooper12`, **1,975 m**, **720 s** exactly, VO₂max **32.9** via `cooper_1968`, avg HR
156, peak 175, synced to Postgres. The formula reproduces independently —
`(1975 − 504.9) / 44.73 = 32.9`.

## What the check turned up instead

No `activity_log` row exists for the day. Told that, the owner said *"Yes it should count."* Measured:

| surface | credited? | evidence |
|---|---|---|
| Zone minutes | **yes, already** | 581 strap samples ≥80% of max ≈ **9.7 min** in the top zone |
| Calorie budget | **no** | not a workout, not an activity; `computeActiveEnergy` has no third source |
| Cardio history | **no** | `activity_logs` for 2026-09-14: **0 rows** |

**The steps path does not rescue it.** `body_metrics.steps` reads **894** for the day — fewer than a
1,975 m run produces by itself. So the hardest twelve minutes of his week contribute essentially
nothing to earned calories, on the very screen BF-152 and BF-154 have just made anchor to measured
movement.

The underlying split: HR-derived credit flows automatically (the strap reaches the zone quota with no
activity row), event-derived credit does not. A test therefore looks partly credited, and the missing
half is invisible until the budget is checked.

## What the baseline actually changed, measured

The run's 794 strap samples moved the **corroborated observed max from 167 to 175** (the 5th-highest
reading over 90 days, `computeObservedHr`'s order statistic).

That moves `targetAnchorMax` — the anchor for *reachable* targets in guided-walk blocks and
fitness-test protocols — up 8 bpm. It does **not** move `maxHr`: that adopts an observed max only
when it is at least the age-predicted value, and 175 < 187, so the zone ceiling is unchanged. The
resolver's own comment explains why, and it is right — a low observed max must not drag the ceiling
down and make ordinary efforts read as maximal.

## What VO₂max does not do, recorded so it is not assumed

`grep` for consumers of `vo2max_est` returns three display surfaces and nothing else: the Cardio
Baselines card, the test picker's previous-result line, and the More → performance overview. No
scoring, no recommendation, no AI tool reads it. The value of this baseline is a trend line against
the next Cooper, not changed app behaviour.

## Not exercised

Docs only. Every figure is a production read; no code changed.
