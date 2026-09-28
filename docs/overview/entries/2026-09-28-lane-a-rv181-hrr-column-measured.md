# 2026-09-28 — RV-181's HRR half measured and refuted; ring workout HR found thinning (LA-168)

## The column is a different number

RV-181's second open half proposed that `/api/health/trends` read `workout_hr_stats.hrr1_best`
instead of re-deriving HR recovery from raw HR, "after a per-day agreement check against
production". That check was run against the owner's 32 completed sessions in the last 45 days,
using the production rows through the read-only endpoint and the real `preferStrapBuckets` and
`analyseHrRecovery`.

The trend plots each session's **median** set HRR1, and `hrr1_best` is the session's **max**. They
disagree on 32 of 32 days, with the column higher by 3 to 36 bpm/min. Swapping would redraw the
chart as another metric. That half is struck in the backlog with the numbers, and nothing was built.

**Measurement caveat:** `/api/admin/db-query` returns at most 1,000 rows, so 22 of the 32 raw-HR
windows were truncated. The median-against-max result does not depend on those windows, because it
follows from how the two values are defined. The per-session live-against-stored comparisons below
use only the uncapped windows, plus a separate `count(*)` query that no cap touches.

## What it turned up

`readings_count` in the snapshot compared with today's `oura_heartrate` count shows that **ring-only
workouts have lost most of their stored HR since their recap rendered**: 08-21 103 → 12, 09-06
180 → 13, 09-20 164 → 99. Strap sessions are intact. This is filed as LA-168, with the rollup's
`deleteBleHeartrateNotIn` as the lead. The lead is not yet established.
