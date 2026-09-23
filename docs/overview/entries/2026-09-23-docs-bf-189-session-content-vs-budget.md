# BF-189 — the sessions are the right length and half the volume

**Branch:** `docs/bf-189-session-content-vs-budget` · docs-only · BugFix intake

The owner asked two things about a 52-minute Push session: whether the duration was right, and how
much of it was actual working time rather than warm-up and bar-loading. Then the real question —
*"Id like to know if sessions have enough content. Time wise its pretty good."*

`DURATION` is wall clock, `workoutEndMs - workoutStartMs`, so 52:00 is correct and counts
everything. Decomposed from the timers:

| band | min | |
|---|---|---|
| warm-up | 10.5 | |
| setup / bar-load | 14.9 | Σ `inter_exercise_rest_sec` |
| **work** | **9.8** | Σ `set_time_sec` |
| rest | 12.0 | |
| unaccounted | 4.3 | |

Across the last 14 completed sessions, work is a median of **8.6 min — 19% of wall clock** — and
setup is consistently larger than work.

On content, the app's own numbers answer it. All five exercises ran **2 sets**, which is the floor
`fitToBudget` never goes below; the program's stored styles prescribe 14 sets for Push and 10 were
logged. Against `program_volume_targets` over 35 days, **13 of 16 muscle groups are under target and
the total is 102.2 sets against 154 — 66%**. Chest 48%, lats 52%, quads 48%, calves 27%. The three
groups at or above target are all ones that accumulate as secondary work.

The obvious suspect was cleared rather than assumed: `resolveTransitionSec` prefers a measured
per-exercise transition over the 240 s equipment default, and the owner has months of measurements,
so the budget is computed against his real transition times. The model is right and the time
genuinely goes there.

What is left is a conflict between two correct numbers that no screen compares — a 60-minute budget
and a 154-set weekly target. Filed `Lane: O` with three levers and a recommendation: fewer exercises
at more sets each, which spends the same time on fewer transitions. That is the position the repo
already argues in its own code (*"two token sets each is worse training than doing fewer exercises
properly"*), and `dropToBudget` exists to do it — it just only runs when the duration preset is
shorter than the session, so at the normal budget the engine trims to a floor instead of dropping an
exercise, which is the wrong half of its own rule.
